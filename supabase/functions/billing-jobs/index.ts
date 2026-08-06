import { adminClient } from '../_shared/supabase.ts'
import { errorJson, json, requestId } from '../_shared/http.ts'

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
    const { data: pending, error: pendingError } = await admin.from('saas_billing_events').select('id, event_name, barberia_id, suscripcion_id, payload').eq('estado', 'pending').order('occurred_at').limit(100)
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
    return json({ ok: true, expired_trials: expired || 0, outbox_pending: pending?.length || 0, outbox_published: published, failed_webhooks_available: failedWebhooks?.length || 0, correlation_id: correlationId })
  } catch (error) {
    console.error(JSON.stringify({ correlation_id: correlationId, code: error?.code || 'billing_jobs_error' }))
    return errorJson(error?.message || 'Error temporal en tareas billing.', error?.status || 500, error?.code || 'billing_jobs_error')
  }
})
