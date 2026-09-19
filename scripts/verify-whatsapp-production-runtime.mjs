import assert from 'node:assert/strict'
import {
  CONNECTION_STATES,
  managedInstanceName,
  normalizeEvolutionState,
  publicConnection,
  runtimeLog,
  sanitizeRuntimeCode,
} from '../supabase/functions/_shared/whatsappProductionRuntime.mjs'

assert.deepEqual(CONNECTION_STATES, [
  'NOT_CONFIGURED', 'CREATING_INSTANCE', 'QR_READY', 'CONNECTING',
  'CONNECTED', 'DISCONNECTED', 'ERROR',
])

assert.equal(managedInstanceName(42), 'austral-prod-tenant-42')
for (const invalid of [0, -1, 1.2, 'x', null, undefined, Number.MAX_SAFE_INTEGER + 1]) {
  assert.equal(managedInstanceName(invalid), '')
}

for (const [input, expected] of [
  [{ instance: { state: 'open' } }, 'CONNECTED'],
  [{ state: 'connected' }, 'CONNECTED'],
  [{ instance: { state: 'connecting' } }, 'CONNECTING'],
  [{ state: 'close' }, 'DISCONNECTED'],
  [{ state: 'disconnected' }, 'DISCONNECTED'],
  [{ state: 'unknown' }, null],
  [null, null],
]) assert.equal(normalizeEvolutionState(input), expected)

assert.equal(sanitizeRuntimeCode(Object.assign(new Error('request aborted'), { name: 'AbortError' })), 'evolution_timeout')
assert.equal(sanitizeRuntimeCode(new Error('fetch failed: ECONNREFUSED')), 'evolution_unreachable')
assert.equal(sanitizeRuntimeCode(new Error('provider leaked https://secret.example?q=token')), 'providerleakedhttps:secretexampleqtoken')
assert.ok(sanitizeRuntimeCode(new Error('x'.repeat(200))).length <= 80)

assert.deepEqual(publicConnection(null), {
  state: 'NOT_CONFIGURED',
  provisioning_mode: null,
  last_verified_at: null,
  qr_expires_at: null,
  last_error_code: null,
  automation_enabled: false,
  outbound_enabled: false,
  booking_enabled: false,
})
assert.deepEqual(publicConnection({
  state: 'CONNECTED', provisioning_mode: 'live', automation_enabled: false,
  outbound_enabled: false, booking_enabled: false, last_error_code: 'bad code!',
}), {
  state: 'CONNECTED',
  provisioning_mode: 'live',
  last_verified_at: null,
  qr_expires_at: null,
  last_error_code: 'badcode',
  automation_enabled: false,
  outbound_enabled: false,
  booking_enabled: false,
})
assert.equal(publicConnection({ state: 'CONNECTED', automation_enabled: true, outbound_enabled: true, booking_enabled: true }).state, 'CONNECTED')
assert.equal(publicConnection({ state: 'IMPOSSIBLE', automation_enabled: true }).state, 'NOT_CONFIGURED')

const log = runtimeLog({
  event: 'whatsapp_provision_request', requestId: '12345678-1234-1234-1234-123456789abc',
  action: 'prepare', tenantId: 42, outcome: 'failed', code: 'provider secret=abc',
  state: 'ERROR', durationMs: 123.7,
})
assert.deepEqual(log, {
  event: 'whatsapp_provision_request', request_id: '12345678-1234-1234-1234-123456789abc',
  action: 'prepare', outcome: 'failed', duration_ms: 124, tenant_id: 42,
  connection_state: 'ERROR', code: 'providersecretabc',
})
assert.doesNotMatch(JSON.stringify(log), /authorization|bearer|jwt|cookie|password|api[_-]?key/i)

console.log(JSON.stringify({
  suite: 'whatsapp-production-runtime',
  states: CONNECTION_STATES.length,
  provider_state_normalization: 'PASS',
  error_sanitization: 'PASS',
  structured_logs: 'ALLOWLISTED',
  secrets_logged: false,
  result: 'PASS',
}))
