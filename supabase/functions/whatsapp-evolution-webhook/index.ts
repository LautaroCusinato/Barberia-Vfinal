import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const QA_FIXTURE_PREFIX = 'austral-qa-tenant-'
const PROTECTED_INSTANCE = 'miwsp'
const WEBHOOK_HEADER = 'X-Austral-Webhook-Secret'
const ALLOWED_EVENTS = new Set(['QRCODE_UPDATED', 'CONNECTION_UPDATE'])

function projectRef() {
  const raw = Deno.env.get('SUPABASE_URL') || ''
  try { return new URL(raw).hostname.split('.')[0].toLowerCase() } catch { return '' }
}

function assertQaRuntime() {
  const ref = projectRef()
  if (!ref || ref === PRODUCTION_PROJECT_REF || ref !== QA_PROJECT_REF) throw new Error('qa_project_required')
  if (Deno.env.get('WHATSAPP_PROVISIONING_ENV') !== 'qa' || Deno.env.get('WHATSAPP_MODE') !== 'shadow' || Deno.env.get('PILOT_MODE') !== 'shadow') throw new Error('shadow_mode_required')
  if (Deno.env.get('WHATSAPP_PROVISIONING_ADAPTER') !== 'evolution') throw new Error('evolution_adapter_required')
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('supabase_not_configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function safeString(value: unknown) { return String(value || '').trim() }

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  if (a.length === 0 || a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index]
  return mismatch === 0
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } })
}

function eventName(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  return safeString(payload.event || payload.type || data.event)
    .toUpperCase()
    .replace(/[.\s-]+/g, '_')
}

function instanceName(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  const instance = safeString(payload.instance || payload.instanceName || data.instance || data.instanceName)
  if (!instance || instance.toLowerCase() === PROTECTED_INSTANCE || !instance.startsWith(QA_FIXTURE_PREFIX)) return null
  return instance
}

function connectionState(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  const raw = safeString(data.state || payload.state).toLowerCase()
  if (raw === 'open' || raw === 'connected') return 'CONNECTED'
  if (raw === 'connecting') return 'CONNECTING'
  if (raw === 'close' || raw === 'closed') return 'DISCONNECTED'
  return null
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    assertQaRuntime()
    const expected = safeString(Deno.env.get('EVOLUTION_WEBHOOK_SECRET'))
    const received = safeString(request.headers.get(WEBHOOK_HEADER))
    if (!expected || !constantTimeEqual(received, expected)) return json({ error: 'webhook_unauthorized' }, 401)
    const payload = await request.json().catch(() => null)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'invalid_payload' }, 422)
    const event = eventName(payload as Record<string, unknown>)
    const instance = instanceName(payload as Record<string, unknown>)
    if (!instance) return json({ error: 'qa_instance_required' }, 403)
    if (!ALLOWED_EVENTS.has(event)) return json({ received: true, accepted: false, reason: 'event_not_enabled' }, 202)
    const admin = adminClient()
    const { data: connection, error: lookupError } = await admin.from('saas_whatsapp_connections').select('id, barberia_id, state').eq('provider', 'evolution').eq('environment', 'qa').eq('instance_name', instance).maybeSingle()
    if (lookupError) return json({ error: 'connection_lookup_failed' }, 502)
    if (!connection) return json({ error: 'qa_connection_not_found' }, 404)
    const state = event === 'QRCODE_UPDATED' ? 'QR_READY' : connectionState(payload as Record<string, unknown>)
    if (state) {
      const { error: updateError } = await admin.from('saas_whatsapp_connections').update({ state, last_verified_at: new Date().toISOString(), qr_expires_at: event === 'QRCODE_UPDATED' ? new Date(Date.now() + 5 * 60 * 1000).toISOString() : null, last_error_code: null, last_error_message: null }).eq('id', connection.id).eq('provider', 'evolution').eq('environment', 'qa')
      if (updateError) return json({ error: 'connection_state_update_failed' }, 502)
    }
    return json({ received: true, accepted: true, event, tenant_id: connection.barberia_id, mutation_blocked: true })
  } catch (error) {
    const code = safeString((error as { message?: string })?.message).replace(/[^a-z0-9_:-]/gi, '').slice(0, 80) || 'webhook_error'
    return json({ error: code }, 503)
  }
})
