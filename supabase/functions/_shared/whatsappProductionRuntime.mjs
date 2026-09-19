export const CONNECTION_STATES = Object.freeze([
  'NOT_CONFIGURED',
  'CREATING_INSTANCE',
  'QR_READY',
  'CONNECTING',
  'CONNECTED',
  'DISCONNECTED',
  'ERROR',
])

const STATE_SET = new Set(CONNECTION_STATES)
const INSTANCE_PREFIX = 'austral-prod-tenant-'

export function cleanValue(input) {
  return String(input ?? '').trim()
}

export function managedInstanceName(tenantId) {
  const id = Number(tenantId)
  if (!Number.isSafeInteger(id) || id < 1) return ''
  return `${INSTANCE_PREFIX}${id}`
}

export function sanitizeRuntimeCode(error, fallback = 'runtime_failed') {
  const raw = cleanValue(error?.message || error || fallback)
  if (error?.name === 'AbortError' || /abort|timeout/i.test(raw)) return 'evolution_timeout'
  if (/fetch failed|network|econn|enotfound|socket/i.test(raw)) return 'evolution_unreachable'
  return raw.replace(/[^a-z0-9_:-]/gi, '').slice(0, 80) || fallback
}

export function normalizeEvolutionState(payload) {
  const nested = payload?.instance && typeof payload.instance === 'object' ? payload.instance : {}
  const state = cleanValue(nested.state || payload?.state).toLowerCase()
  if (state === 'open' || state === 'connected') return 'CONNECTED'
  if (state === 'connecting') return 'CONNECTING'
  if (state === 'close' || state === 'closed' || state === 'disconnected') return 'DISCONNECTED'
  return null
}

export function publicConnection(row, extras = {}) {
  const state = STATE_SET.has(cleanValue(row?.state)) ? cleanValue(row.state) : 'NOT_CONFIGURED'
  return {
    state,
    provisioning_mode: row?.provisioning_mode || null,
    last_verified_at: row?.last_verified_at || null,
    qr_expires_at: row?.qr_expires_at || null,
    last_error_code: row?.last_error_code ? sanitizeRuntimeCode(row.last_error_code) : null,
    automation_enabled: row?.automation_enabled === true,
    outbound_enabled: row?.outbound_enabled === true,
    booking_enabled: row?.booking_enabled === true,
    ...extras,
  }
}

export function runtimeLog({ event, requestId, action, tenantId, outcome, code, state, durationMs }) {
  const result = {
    event: cleanValue(event).slice(0, 64) || 'whatsapp_runtime',
    request_id: /^[a-f0-9-]{16,64}$/i.test(cleanValue(requestId)) ? cleanValue(requestId) : 'invalid',
    action: ['status', 'prepare'].includes(cleanValue(action)) ? cleanValue(action) : 'invalid',
    outcome: ['success', 'rejected', 'failed'].includes(cleanValue(outcome)) ? cleanValue(outcome) : 'failed',
    duration_ms: Math.max(0, Math.min(120_000, Math.round(Number(durationMs) || 0))),
  }
  const id = Number(tenantId)
  if (Number.isSafeInteger(id) && id > 0) result.tenant_id = id
  if (STATE_SET.has(cleanValue(state))) result.connection_state = cleanValue(state)
  if (code) result.code = sanitizeRuntimeCode(code)
  return result
}
