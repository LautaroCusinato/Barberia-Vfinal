import { adminClient } from '../_shared/supabase.ts'
import { errorJson, json, requestId } from '../_shared/http.ts'
import { mercadoPagoExternalStatus, paypalExternalStatus, providerConfigured } from '../_shared/providers.ts'

function providerStatus(provider: string, externalId: string) {
  if (provider === 'mercadopago') return mercadoPagoExternalStatus({ externalId, kind: 'subscription' })
  if (provider === 'paypal') return paypalExternalStatus({ externalId, kind: 'subscription' })
  throw Object.assign(new Error('Proveedor no soportado.'), { status: 422, code: 'unsupported_provider' })
}

function authorized(request: Request) {
  const configured = Deno.env.get('BILLING_CRON_SECRET')
  if (!configured) throw Object.assign(new Error('Falta BILLING_CRON_SECRET.'), { status: 503, code: 'cron_not_configured' })
  if (request.headers.get('x-billing-cron-secret') !== configured) throw Object.assign(new Error('Cron no autorizado.'), { status: 401, code: 'cron_unauthorized' })
}

Deno.serve(async (request) => {
  const correlationId = requestId(request)
  try {
    if (request.method !== 'POST') return errorJson('Sólo POST.', 405, 'method_not_allowed')
    authorized(request)
    const admin = adminClient()
    const { data: expired, error: expiredError } = await admin.rpc('expire_saas_trials', { p_limit: 100 })
    if (expiredError) throw Object.assign(new Error('No se pudieron vencer trials.'), { status: 502, code: 'trial_expiry_failed' })

    // El outbox no se marca como publicado si todavía no existe un consumidor
    // configurado. Así una instalación nueva no pierde eventos por accidente.
    const { data: pending, error: pendingError } = await admin.from('saas_billing_events').select('id, event_name, barberia_id, suscripcion_id, payload, retry_count').eq('estado', 'pending').order('occurred_at').limit(100)
    if (pendingError) throw Object.assign(new Error('No se pudo leer el outbox.'), { status: 502, code: 'outbox_read_failed' })
    const sink = Deno.env.get('BILLING_OUTBOX_SINK_URL')
    let published = 0
    if (sink) for (const event of pending || []) {
      const response = await fetch(sink, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-billing-outbox-secret': Deno.env.get('BILLING_OUTBOX_SINK_SECRET') || '' }, body: JSON.stringify({ event, correlation_id: correlationId }) })
      if (response.ok) {
        await admin.from('saas_billing_events').update({ estado: 'published', published_at: new Date().toISOString(), retry_count: 0 }).eq('id', event.id).eq('estado', 'pending')
        published += 1
      } else {
        await admin.from('saas_billing_events').update({ retry_count: (event.retry_count || 0) + 1, last_error: `sink_${response.status}` }).eq('id', event.id).eq('estado', 'pending')
      }
    }
    const { data: failedWebhooks } = await admin.from('saas_billing_webhook_events').select('id').eq('estado', 'failed').lt('retry_count', 5).limit(100)
    const { data: externalLinks } = await admin.from('saas_suscripciones_externas').select('id, suscripcion_id, proveedor_codigo, external_subscription_id').limit(100)
    const reconciliation = { checked: 0, transitioned: 0, unchanged: 0, skipped: 0, failed: 0 }
    for (const link of externalLinks || []) {
      const provider = String(link.proveedor_codigo) as 'mercadopago' | 'paypal'
      const { data: providerRow } = await admin.from('saas_proveedores_pago').select('activo').eq('codigo', provider).maybeSingle()
      if (!providerRow?.activo || !providerConfigured(provider).configured) { reconciliation.skipped += 1; continue }
      try {
        const result = await providerStatus(provider, String(link.external_subscription_id))
        await admin.from('saas_suscripciones_externas').update({ estado_externo: result.normalizedStatus, current_period_start: result.currentPeriodStart, current_period_end: result.currentPeriodEnd, cancel_at_period_end: result.cancelAtPeriodEnd, last_synced_at: new Date().toISOString(), metadata: { last_reconciliation_status: result.status, correlation_id: correlationId } }).eq('id', link.id)
        const eventId = `reconcile:${provider}:${link.external_subscription_id}:${result.normalizedStatus}`
        const { data: transition, error: transitionError } = await admin.rpc('transition_saas_subscription', { p_subscription_id: link.suscripcion_id, p_to_state: result.normalizedStatus, p_reason: 'scheduled_reconciliation', p_source: 'reconciliation', p_provider_event_id: eventId, p_provider_event_at: result.updatedAt || null })
        if (transitionError) throw transitionError
        reconciliation.checked += 1
        if (transition?.idempotent) reconciliation.unchanged += 1
        else reconciliation.transitioned += 1
      } catch {
        reconciliation.failed += 1
      }
    }
    return json({ ok: true, expired_trials: expired || 0, outbox_pending: pending?.length || 0, outbox_published: published, failed_webhooks_available: failedWebhooks?.length || 0, reconciliation, correlation_id: correlationId })
  } catch (error) {
    console.error(JSON.stringify({ correlation_id: correlationId, code: error?.code || 'billing_jobs_error' }))
    return errorJson(error?.message || 'Error temporal en tareas billing.', error?.status || 500, error?.code || 'billing_jobs_error')
  }
})
