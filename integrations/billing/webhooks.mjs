// Handler agnóstico para Cloudflare Pages Functions/Supabase Edge Functions.
// Se entrega como plantilla inactiva: no hay ruta desplegada ni webhook activo.

const MAX_BODY_BYTES = 1024 * 1024

export function minimizeWebhookPayload(payload) {
  const source = payload && typeof payload === 'object' ? payload : {}
  return {
    id: source.id || source.event_id || source.resource?.id || null,
    type: source.type || source.event_type || source.event || 'unknown',
    action: source.action || null,
    status: source.status || source.resource?.status || null,
    external_reference: source.external_reference || source.resource?.external_reference || null,
    updated_at: source.updated_at || source.date_created || null,
  }
}

export function createBillingWebhookHandler({ provider, adapter, supabaseAdmin }) {
  return async function handle(request) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return new Response('Payload Too Large', { status: 413 })
    let payload
    try { payload = JSON.parse(rawBody) } catch { return new Response('Invalid JSON', { status: 400 }) }
    const incoming = Object.fromEntries(request.headers.entries())
    const signatureValid = await adapter.verifyWebhook({ rawBody, payload, headers: incoming })
    if (!signatureValid) return new Response('Invalid signature', { status: 401 })
    const minimized = minimizeWebhookPayload(payload)
    const { error } = await supabaseAdmin.rpc('record_billing_webhook_event', {
      p_proveedor_codigo: provider,
      p_external_event_id: String(minimized.id || crypto.randomUUID()),
      p_event_type: minimized.type,
      p_signature_valid: true,
      p_payload_min: minimized,
      p_external_updated_at: minimized.updated_at || null,
    })
    if (error) return new Response('Could not persist event', { status: 500 })
    return new Response(JSON.stringify({ received: true }), { status: 202, headers: { 'Content-Type': 'application/json' } })
  }
}
