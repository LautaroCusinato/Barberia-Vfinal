import { adminClient } from '../_shared/supabase.ts'
import { errorJson, json, requestId } from '../_shared/http.ts'
import { mercadoPagoResource, normalizeStatus, paypalResource, verifyMercadoPago, verifyPayPal } from '../_shared/providers.ts'

function minimized(payload: Record<string, unknown>) {
  const resource = payload.resource as Record<string, unknown> | undefined
  return { id: payload.id || payload.event_id || resource?.id || null, type: payload.type || payload.event_type || payload.event || 'unknown', action: payload.action || null, status: payload.status || resource?.status || null, external_reference: payload.external_reference || resource?.custom_id || resource?.reference_id || null, updated_at: payload.updated_at || payload.date_created || null }
}

async function body(request: Request) {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > 1024 * 1024) throw Object.assign(new Error('Payload demasiado grande.'), { status: 413, code: 'payload_too_large' })
  try { return JSON.parse(raw) as Record<string, unknown> } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400, code: 'invalid_json' }) }
}

Deno.serve(async (request) => {
  const correlationId = requestId(request)
  let recordedEventId: number | null = null
  let recordedProvider = ''
  let recordedExternalId = ''
  try {
    if (request.method !== 'POST') return errorJson('Sólo POST.', 405, 'method_not_allowed')
    const webhookUrl = new URL(request.url)
    const provider = webhookUrl.pathname.split('/').filter(Boolean).pop() || ''
    if (!['mercadopago', 'paypal'].includes(provider)) return errorJson('Proveedor inválido.', 404, 'provider_not_found')
    const payload = await body(request)
    const admin = adminClient()
    const dataIdFromUrl = webhookUrl.searchParams.get('data.id') || webhookUrl.searchParams.get('data_id') || ''
    const signatureValid = provider === 'mercadopago' ? await verifyMercadoPago(payload, request.headers, dataIdFromUrl) : await verifyPayPal(payload, request.headers)
    if (!signatureValid) return errorJson('Firma inválida.', 401, 'invalid_signature')
    const resource = provider === 'mercadopago' ? await mercadoPagoResource(payload, dataIdFromUrl) : await paypalResource(payload)
    const minimal = minimized(payload)
    const externalEventId = String(minimal.id || `${provider}-${crypto.randomUUID()}`)
    recordedProvider = provider
    recordedExternalId = externalEventId
    const { data: recorded, error: recordError } = await admin.rpc('record_billing_webhook_event', { p_proveedor_codigo: provider, p_external_event_id: externalEventId, p_event_type: String(minimal.type), p_signature_valid: true, p_payload_min: { ...minimal, verified_status: resource.status, verified_normalized_status: resource.normalizedStatus }, p_external_updated_at: minimal.updated_at || null })
    if (recordError) throw Object.assign(new Error('No se pudo registrar el webhook.'), { status: 500, code: 'webhook_record_failed' })
    recordedEventId = Number(recorded?.webhook_event_id || 0) || null
    if (recorded?.idempotent) {
      const { data: previous } = await admin.from('saas_billing_webhook_events').select('estado').eq('id', recordedEventId).maybeSingle()
      if (previous?.estado === 'processed' || previous?.estado === 'ignored') return json({ received: true, duplicate: true })
    }

    const resourceId = resource.id
    const { data: externalSubscription } = await admin.from('saas_suscripciones_externas').select('suscripcion_id, barberia_id, external_subscription_id').eq('proveedor_codigo', provider).eq('external_subscription_id', resourceId).maybeSingle()
    let { data: checkoutAttempt } = await admin.from('saas_billing_checkout_attempts').select('id, barberia_id, suscripcion_id, amount, currency, metadata').eq('proveedor_codigo', provider).eq('external_checkout_id', resourceId).maybeSingle()
    // En una notificación de pago, Mercado Pago entrega el ID del pago, no el
    // ID de la preferencia. El external_reference estable permite recuperar el
    // intento original sin confiar en datos enviados por el navegador.
    if (!checkoutAttempt) {
      const reference = String((resource as Record<string, unknown>).externalReference || '')
      const match = /^billing:(\d+)$/.exec(reference)
      if (match) {
        checkoutAttempt = (await admin.from('saas_billing_checkout_attempts').select('id, barberia_id, suscripcion_id, amount, currency, metadata').eq('id', Number(match[1])).eq('proveedor_codigo', provider).maybeSingle()).data
      }
    }
    // A Mercado Pago hosted subscription checkout is generated from the
    // external plan URL, so the provider resource may not echo the per-attempt
    // billing reference. In the isolated sandbox we can safely resolve the
    // plan back to the single technical tenant without trusting webhook input
    // as a tenant selector. Production tenants never use this fallback.
    if (!checkoutAttempt && provider === 'mercadopago') {
      const verifiedResource = (resource as Record<string, unknown>).resource as Record<string, unknown> | undefined
      const planId = String(verifiedResource?.preapproval_plan_id || payload.preapproval_plan_id || '')
      if (planId) {
        const { data: price } = await admin.from('saas_plan_precios').select('id, plan_codigo, external_plan_id').eq('external_plan_id', planId).eq('proveedor_codigo', 'mercadopago').eq('entorno', 'sandbox').eq('activo', true).maybeSingle()
        if (price) {
          const candidate = (await admin.from('saas_billing_checkout_attempts').select('id, barberia_id, suscripcion_id, amount, currency, metadata').eq('barberia_id', 6).eq('plan_codigo', price.plan_codigo).eq('proveedor_codigo', provider).in('estado', ['ready', 'pending_provider', 'created']).order('created_at', { ascending: false }).limit(1).maybeSingle()).data
          const candidatePlanId = String(candidate?.metadata?.external_plan_id || '')
          // Never let a historical checkout from an obsolete plan become the
          // context for a current subscription event. Amount/currency alone
          // are insufficient because the old and new sandbox plans share them.
          if (candidate && candidatePlanId === String(price.external_plan_id)) checkoutAttempt = candidate
        }
      }
    }
    if (checkoutAttempt && provider === 'mercadopago' && (resource as Record<string, unknown>).resourceType === 'preapproval') {
      const verifiedResource = (resource as Record<string, unknown>).resource as Record<string, unknown> | undefined
      const verifiedPlanId = String(verifiedResource?.preapproval_plan_id || payload.preapproval_plan_id || '')
      const attemptPlanId = String(checkoutAttempt.metadata?.external_plan_id || '')
      if (!verifiedPlanId || !attemptPlanId || verifiedPlanId !== attemptPlanId) checkoutAttempt = null
    }
    const context = externalSubscription || checkoutAttempt
    if (!context?.suscripcion_id || !context?.barberia_id) {
      await admin.from('saas_billing_webhook_events').update({ estado: 'ignored', error_code: 'external_subscription_unlinked', processed_at: new Date().toISOString() }).eq('proveedor_codigo', provider).eq('external_event_id', externalEventId)
      return json({ received: true, processed: false, reason: 'external_subscription_unlinked' }, 202)
    }
    const { error: contextLinkError } = await admin.from('saas_billing_webhook_events').update({ barberia_id: context.barberia_id, suscripcion_id: context.suscripcion_id }).eq('proveedor_codigo', provider).eq('external_event_id', externalEventId)
    if (contextLinkError) throw Object.assign(new Error('No se pudo vincular el contexto del webhook.'), { status: 500, code: 'webhook_context_link_failed' })
    const expected = checkoutAttempt ? { amount: Number(checkoutAttempt.amount), currency: checkoutAttempt.currency } : null
    if (expected && resource.amount && (Math.abs(expected.amount - resource.amount) > 0.01 || expected.currency !== resource.currency)) {
      await admin.from('saas_billing_webhook_events').update({ estado: 'failed', error_code: 'amount_or_currency_mismatch', processed_at: new Date().toISOString() }).eq('proveedor_codigo', provider).eq('external_event_id', externalEventId)
      return errorJson('El importe o la moneda no coinciden con el plan interno.', 422, 'amount_or_currency_mismatch')
    }
    const resourceType = String((resource as Record<string, unknown>).resourceType || (provider === 'paypal' ? 'payment' : 'preapproval'))
    if (provider === 'mercadopago' && resourceType === 'preapproval_plan') {
      await admin.from('saas_billing_webhook_events').update({ estado: 'ignored', error_code: 'plan_event_not_subscription', processed_at: new Date().toISOString() }).eq('proveedor_codigo', provider).eq('external_event_id', externalEventId)
      return json({ received: true, processed: false, reason: 'plan_event_not_subscription' }, 202)
    }
    const { error: transitionError } = await admin.rpc('transition_saas_subscription', { p_subscription_id: context.suscripcion_id, p_to_state: resource.normalizedStatus || normalizeStatus(provider as 'mercadopago' | 'paypal', resource.status), p_reason: `provider_event:${externalEventId}`, p_source: 'provider', p_provider_event_id: externalEventId, p_provider_event_at: minimal.updated_at || null })
    if (transitionError) throw Object.assign(new Error('No se pudo actualizar la suscripción.'), { status: 502, code: 'subscription_transition_failed' })
    if (provider === 'mercadopago' && resourceType === 'preapproval' && checkoutAttempt?.suscripcion_id && resourceId) {
      const { error: externalLinkError } = await admin.from('saas_suscripciones_externas').upsert({
        suscripcion_id: checkoutAttempt.suscripcion_id,
        barberia_id: checkoutAttempt.barberia_id,
        proveedor_codigo: provider,
        external_subscription_id: resourceId,
        external_plan_id: checkoutAttempt.metadata?.external_plan_id || null,
        estado_externo: resource.normalizedStatus || 'payment_review',
        metadata: { source: 'verified_webhook', checkout_attempt_id: checkoutAttempt.id, environment: checkoutAttempt.metadata?.environment || 'sandbox' },
      }, { onConflict: 'suscripcion_id,proveedor_codigo' })
      if (externalLinkError) throw Object.assign(new Error('No se pudo vincular la suscripción externa.'), { status: 502, code: 'subscription_registration_failed' })
      const { error: subscriptionLinkError } = await admin.from('saas_suscripciones').update({ provider, provider_subscription_id: resourceId }).eq('id', checkoutAttempt.suscripcion_id)
      if (subscriptionLinkError) throw Object.assign(new Error('No se pudo vincular la suscripción interna.'), { status: 502, code: 'subscription_registration_failed' })
    }
    if (resourceType === 'payment' && resourceId && resource.amount && resource.currency) {
      await admin.from('saas_billing_payments').upsert({ barberia_id: context.barberia_id, suscripcion_id: context.suscripcion_id, checkout_attempt_id: checkoutAttempt?.id || null, proveedor_codigo: provider, external_payment_id: resourceId, estado: resource.normalizedStatus === 'active' ? 'approved' : resource.normalizedStatus === 'past_due' ? 'failed' : 'review', amount: resource.amount, currency: resource.currency, paid_at: resource.normalizedStatus === 'active' ? new Date().toISOString() : null, metadata: { event_id: externalEventId, correlation_id: correlationId } }, { onConflict: 'proveedor_codigo,external_payment_id' })
    }
    await admin.from('saas_billing_webhook_events').update({ estado: 'processed', processed_at: new Date().toISOString() }).eq('proveedor_codigo', provider).eq('external_event_id', externalEventId)
    return json({ received: true, processed: true })
  } catch (error) {
    if (recordedEventId && recordedProvider && recordedExternalId) {
      await adminClient().from('saas_billing_webhook_events').update({ estado: 'failed', error_code: error?.code || 'billing_webhook_error', processed_at: new Date().toISOString() }).eq('id', recordedEventId).eq('proveedor_codigo', recordedProvider).eq('external_event_id', recordedExternalId)
    }
    console.error(JSON.stringify({ correlation_id: correlationId, code: error?.code || 'billing_webhook_error' }))
    return errorJson(error?.message || 'Error temporal procesando webhook.', error?.status || 500, error?.code || 'billing_webhook_error')
  }
})
