import assert from 'node:assert/strict'
import { finalizeProductionDiagnostics } from './lib/whatsappProductionDiagnostics.mjs'

const ready = {
  mode: 'PRODUCTION_READ_ONLY',
  project_target: 'MATCH',
  tenant_resolution: 'PASS',
  tenant_id: 42,
  integration_id: 10,
  connection: { state: 'CONNECTED', instance_name: 'austral-prod-tenant-42', last_error_code: null },
  capabilities: { automation_enabled: false, outbound_enabled: false, booking_enabled: false },
  evolution_state: 'CONNECTED',
  evolution_webhook: { enabled: true, messages_upsert: true, has_url: true },
  n8n_workflow: { found: true, active: false, name_matches: true },
  event_window: { total_15m: 0, failed_15m: 0, processing: 0, stale_processing: 0 },
  binding_consistent: true,
  errors: [],
}

const now = new Date('2030-01-01T00:00:00.000Z')
assert.equal(finalizeProductionDiagnostics(ready, { now }).status, 'PASS')

const degraded = structuredClone(ready)
degraded.evolution_state = 'NOT_CONNECTED'
const degradedReport = finalizeProductionDiagnostics(degraded, { now })
assert.equal(degradedReport.status, 'FAIL')
assert.ok(degradedReport.checks.some((check) => check.code === 'CONNECTION_STATE_DRIFT'))

const unsafeFlags = structuredClone(ready)
unsafeFlags.capabilities.outbound_enabled = true
const unsafeFlagsReport = finalizeProductionDiagnostics(unsafeFlags, { now })
assert.ok(unsafeFlagsReport.checks.some((check) => check.code === 'CAPABILITY_FLAGS_INVALID'))

const repeatedFailures = structuredClone(ready)
repeatedFailures.event_window.failed_15m = 3
repeatedFailures.event_window.stale_processing = 1
const failureReport = finalizeProductionDiagnostics(repeatedFailures, { now })
assert.ok(failureReport.checks.some((check) => check.code === 'REPEATED_EVENT_FAILURES'))
assert.ok(failureReport.checks.some((check) => check.code === 'STALE_PROCESSING_EVENTS'))

const provisioningFailure = structuredClone(ready)
provisioningFailure.connection = { state: 'ERROR', last_error_code: 'evolution_timeout' }
assert.ok(finalizeProductionDiagnostics(provisioningFailure, { now }).checks.some((check) => check.code === 'PROVISIONING_FAILED'))

const automationWithoutWorkflow = structuredClone(ready)
automationWithoutWorkflow.capabilities.automation_enabled = true
assert.ok(finalizeProductionDiagnostics(automationWithoutWorkflow, { now }).checks.some((check) => check.code === 'N8N_INACTIVE_WITH_AUTOMATION_ENABLED'))

const sensitive = structuredClone(ready)
sensitive.authorization = 'Bearer secret-sentinel'
sensitive.phone = '+5491100000000'
sensitive.connection.phone = '+5491100000000'
sensitive.evolution_webhook.url = 'https://secret.invalid/webhook-secret-sentinel'
const serialized = JSON.stringify(finalizeProductionDiagnostics(sensitive, { now }))
assert.doesNotMatch(serialized, /secret-sentinel|5491100000000|authorization|phone/i)

console.log(JSON.stringify({
  suite: 'whatsapp-production-diagnostics',
  healthy: 'PASS',
  degraded_connection: 'DETECTED',
  unsafe_flags: 'DETECTED',
  repeated_failures: 'DETECTED',
  stale_processing: 'DETECTED',
  sensitive_input_echoed: false,
  result: 'PASS',
}))
