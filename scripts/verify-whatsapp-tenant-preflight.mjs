import assert from 'node:assert/strict'
import { evaluateTenantPreflight } from './lib/whatsappTenantPreflight.mjs'

const ready = {
  tenant: {
    id: 42,
    name: 'Tenant de prueba',
    slug: 'tenant-de-prueba',
    timezone: 'America/Argentina/Buenos_Aires',
    currency: 'ARS',
    access_state: 'active',
    onboarding_completed: true,
  },
  counts: {
    owner_or_admin_members: 1,
    active_services: 2,
    valid_active_services: 2,
    active_staff: 2,
    active_staff_with_active_service: 2,
    active_staff_with_schedule: 2,
  },
  connections: [],
}

function codes(report) {
  return new Set(report.checks.filter((check) => check.status === 'FAIL').map((check) => check.code))
}

assert.equal(evaluateTenantPreflight(ready).status, 'PASS')
assert.equal(evaluateTenantPreflight(ready).provisioning_allowed, true)

const missingTenant = evaluateTenantPreflight({ counts: {}, connections: [] })
assert.equal(missingTenant.status, 'FAIL')
assert.ok(codes(missingTenant).has('TENANT_NOT_FOUND'))

for (const [patch, expectedCode] of [
  [{ tenant: { currency: 'peso' } }, 'CURRENCY_INVALID'],
  [{ tenant: { slug: 'Tenant inválido' } }, 'SLUG_INVALID'],
  [{ tenant: { timezone: 'Mars/Olympus' } }, 'TIMEZONE_INVALID'],
  [{ counts: { active_services: 0, valid_active_services: 0 } }, 'SERVICES_MISSING'],
  [{ counts: { active_staff: 0, active_staff_with_active_service: 0, active_staff_with_schedule: 0 } }, 'STAFF_MISSING'],
  [{ counts: { active_staff_with_schedule: 1 } }, 'SCHEDULES_MISSING'],
]) {
  const candidate = structuredClone(ready)
  if (patch.tenant) Object.assign(candidate.tenant, patch.tenant)
  if (patch.counts) Object.assign(candidate.counts, patch.counts)
  const report = evaluateTenantPreflight(candidate)
  assert.equal(report.status, 'FAIL')
  assert.ok(codes(report).has(expectedCode))
}

const conflicted = structuredClone(ready)
conflicted.connections = [
  { environment: 'production', instance_name: 'austral-prod-tenant-42', provisioning_mode: 'live', state: 'ERROR', tenant_binding_valid: true },
  { environment: 'production', instance_name: 'austral-prod-tenant-99', provisioning_mode: 'live', state: 'CONNECTED', tenant_binding_valid: false },
]
assert.ok(codes(evaluateTenantPreflight(conflicted)).has('CONNECTION_CONFLICT'))

const enabled = structuredClone(ready)
enabled.connections = [{ environment: 'production', instance_name: 'austral-prod-tenant-42', provisioning_mode: 'live', state: 'CONNECTED', tenant_binding_valid: true, automation_enabled: true }]
assert.ok(codes(evaluateTenantPreflight(enabled)).has('FLAGS_UNEXPECTEDLY_ENABLED'))

const pastDue = structuredClone(ready)
pastDue.tenant.access_state = 'past_due'
assert.equal(evaluateTenantPreflight(pastDue).status, 'WARN')
assert.equal(evaluateTenantPreflight(pastDue).provisioning_allowed, true)

const sensitive = structuredClone(ready)
sensitive.phone = '+5491100000000'
sensitive.authorization = 'Bearer secret-sentinel'
const serialized = JSON.stringify(evaluateTenantPreflight(sensitive))
assert.doesNotMatch(serialized, /5491100000000|secret-sentinel|authorization|phone/i)

console.log(JSON.stringify({
  suite: 'whatsapp-tenant-preflight',
  ready: 'PASS',
  missing_configuration: 'FAIL_CLOSED',
  connection_conflict: 'DETECTED',
  unexpected_flags: 'DETECTED',
  sensitive_input_echoed: false,
  result: 'PASS',
}))
