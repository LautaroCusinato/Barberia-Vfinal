import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const QA_FIXTURE_PREFIX = 'austral-qa-tenant-'
const PROTECTED_INSTANCE = 'miwsp'
const WEBHOOK_HEADER = 'X-Austral-Webhook-Secret'
const ALLOWED_EVENTS = new Set(['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'])
const INBOUND_EVENT = 'MESSAGES_UPSERT'

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

function messageData(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  const key = data.key && typeof data.key === 'object' ? data.key as Record<string, unknown> : {}
  const message = data.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : {}
  const eventId = safeString(key.id || data.messageId || payload.message_id || payload.event_id || payload.id).slice(0, 200)
  const remoteJid = safeString(key.remoteJid || key.participant || data.remoteJid || payload.sender)
  const fromMe = key.fromMe === true || data.fromMe === true || payload.fromMe === true
  const messageType = safeString(data.messageType || payload.messageType || Object.keys(message)[0]).slice(0, 80) || null
  return { eventId, remoteJid, fromMe, messageType }
}

async function senderHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const bytes = new Uint8Array(digest)
  return `sha256:${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12)}`
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
    const { data: connection, error: lookupError } = await admin.from('saas_whatsapp_connections').select('id, barberia_id, integration_id, state').eq('provider', 'evolution').eq('environment', 'qa').eq('instance_name', instance).maybeSingle()
    if (lookupError) return json({ error: 'connection_lookup_failed' }, 502)
    if (!connection) return json({ error: 'qa_connection_not_found' }, 404)
    if (event === INBOUND_EVENT) {
      if (connection.state !== 'CONNECTED') return json({ error: 'connection_not_connected', mutation_blocked: true }, 409)
      if (!connection.integration_id) return json({ error: 'integration_not_configured', mutation_blocked: true }, 409)
      const inbound = messageData(payload as Record<string, unknown>)
      if (!inbound.eventId || !inbound.remoteJid) return json({ error: 'message_identity_required', mutation_blocked: true }, 422)
      if (inbound.fromMe) return json({ received: true, accepted: false, event, reason: 'from_me_ignored', mutation_blocked: true }, 202)
      const { data: existing, error: existingError } = await admin.from('saas_automation_shadow_runs').select('id').eq('integration_id', connection.integration_id).eq('event_id', inbound.eventId).maybeSingle()
      if (existingError) return json({ error: 'shadow_lookup_failed', mutation_blocked: true }, 502)
      const { data: recorded, error: recordError } = await admin.rpc('record_whatsapp_shadow_run', {
        p_integration_id: connection.integration_id,
        p_event_id: inbound.eventId,
        p_intent: null,
        p_proposed_result: 'inbound_received_shadow_only',
        p_proposed_response_length: 0,
        p_proposed_latency_ms: null,
        p_proposed_tokens_input: null,
        p_proposed_tokens_output: null,
        p_metadata: {
          source: 'evolution',
          event: INBOUND_EVENT,
          environment: 'qa',
          message_type: inbound.messageType,
          sender_hash: await senderHash(inbound.remoteJid),
          from_me: false,
          mutation_blocked: true,
          outbound_send: false,
          observed_at: new Date().toISOString(),
        },
      })
      if (recordError) return json({ error: 'shadow_record_failed', mutation_blocked: true }, 502)
      const shadowRun = Array.isArray(recorded) ? recorded[0] : recorded
      return json({ received: true, accepted: true, event, tenant_id: connection.barberia_id, shadow_run_id: shadowRun?.shadow_run_id || null, duplicate: Boolean(existing), mutation_blocked: true, outbound_send: false })
    }
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
