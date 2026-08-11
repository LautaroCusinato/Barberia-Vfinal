import assert from 'node:assert/strict'
import { getQaConfig } from './e2e-sandbox-guards.mjs'
import { classifySignal, mockScenario, monitoringMockNames } from './monitoring-health.mjs'

const base = {
  E2E_REAL_SUPABASE: '1',
  E2E_ENVIRONMENT: 'qa',
  E2E_SUPABASE_PROJECT_REF: 'cmsymmszlzikqpvfqjre',
  E2E_ALLOWED_PROJECT_REF: 'cmsymmszlzikqpvfqjre',
  E2E_SUPABASE_URL: 'https://cmsymmszlzikqpvfqjre.supabase.co',
  E2E_SUPABASE_ANON_KEY: 'qa-anon-placeholder',
  E2E_SUPABASE_SERVICE_ROLE_KEY: 'qa-service-placeholder',
  E2E_TEST_PREFIX: 'E2E_QA_',
}

assert.doesNotThrow(() => getQaConfig({ env: base, cwd: 'C:\\does-not-exist' }))
assert.throws(() => getQaConfig({ env: { ...base, E2E_SUPABASE_URL: 'https://ssagttjdgtypxjcgdnrw.supabase.co' }, cwd: 'C:\\does-not-exist' }), /E2E sandbox guard blocked/)
assert.throws(() => getQaConfig({ env: { ...base, E2E_SUPABASE_PROJECT_REF: 'ssagttjdgtypxjcgdnrw', E2E_ALLOWED_PROJECT_REF: 'ssagttjdgtypxjcgdnrw' }, cwd: 'C:\\does-not-exist' }), /E2E sandbox guard blocked/)
assert.throws(() => getQaConfig({ env: { ...base, E2E_REAL_SUPABASE: '0' }, cwd: 'C:\\does-not-exist' }), /E2E sandbox guard blocked/)
assert.throws(() => getQaConfig({ env: { ...base, VITE_SUPABASE_URL: 'https://ssagttjdgtypxjcgdnrw.supabase.co' }, checkViteRuntime: true, cwd: 'C:\\does-not-exist' }), /E2E sandbox guard blocked/)
assert.doesNotThrow(() => getQaConfig({ env: { ...base, VITE_SUPABASE_URL: base.E2E_SUPABASE_URL }, checkViteRuntime: true, cwd: 'C:\\does-not-exist' }))

const expectedSeverity = { http_500: 'P0', timeout: 'P0', function_down: 'P0', webhook_invalid: 'P1', auth_failed: 'P1', frontend_error: 'P1', backup_failure: 'P1' }
for (const name of monitoringMockNames()) {
  const mock = mockScenario(name)
  assert.equal(classifySignal({ kind: mock.kind, status: name === 'http_500' ? 500 : null, consecutive: 3 }), expectedSeverity[name])
}
assert.equal(classifySignal({ kind: 'availability', status: 404 }), 'P2')
assert.equal(classifySignal({ kind: 'latency', latencyMs: 1100, consecutive: 1 }), 'P1')

console.log(JSON.stringify({ guard: 'passed', production_ref_rejected: true, vite_fallback_rejected: true, mocked_signals: monitoringMockNames().length }, null, 2))
