import assert from 'node:assert/strict'
import { evaluateProductionDryRun, PRODUCTION_WEBHOOK_URL, PROTECTED_TENANTS } from './billing-production-dry-run.mjs'

const valid = {
  BILLING_DRY_RUN: '1',
  BILLING_ENVIRONMENT: 'production',
  BILLING_PROJECT_REF: 'ssagttjdgtypxjcgdnrw',
  BILLING_PRODUCTION_ENABLED: '0',
  MERCADOPAGO_ENVIRONMENT: 'production',
  MERCADOPAGO_API_BASE_URL: 'https://api.mercadopago.com',
  MERCADOPAGO_ACCESS_TOKEN: 'opaque-server-secret',
  MERCADOPAGO_WEBHOOK_SECRET: 'opaque-webhook-secret',
  MERCADOPAGO_TOKEN_IDENTITY_VERIFIED: '1',
  MERCADOPAGO_EXPECTED_SELLER_ID: '123456789',
  MERCADOPAGO_EXPECTED_APPLICATION_ID: '987654321',
  BILLING_PRODUCTION_PILOT_TENANT_ID: '42',
  BILLING_PRODUCTION_ALLOWED_TENANT_IDS: '42',
  BILLING_PILOT_TENANT_VERIFIED: '1',
  BILLING_PILOT_TENANT_ENVIRONMENT: 'production',
  BILLING_PILOT_PROVIDER: 'mercadopago',
  BILLING_PLAN_VERIFIED: '1',
  BILLING_PLAN_CODE: 'starter',
  BILLING_PLAN_COUNTRY: 'AR',
  BILLING_PLAN_CURRENCY: 'ARS',
  BILLING_PLAN_AMOUNT: '15000',
  BILLING_PLAN_PERIODICITY: 'monthly',
  BILLING_EXTERNAL_PLAN_ID: 'production-plan-1234',
  BILLING_WEBHOOK_URL: PRODUCTION_WEBHOOK_URL,
  BILLING_WEBHOOK_VERIFIED: '1',
  BILLING_JOBS_CONFIGURED: '1',
  BILLING_ALERTING_CONFIGURED: '1',
  BILLING_BACKUP_VERIFIED: '1',
  BILLING_ROLLBACK_VERIFIED: '1',
  BILLING_PAYPAL_ENABLED: '0',
  BILLING_GLOBAL_PROVIDER_ENABLED: '0',
}

const ready = evaluateProductionDryRun(valid)
assert.equal(ready.ready, true)
assert.equal(ready.dry_run, true)
assert.equal(ready.activation_performed, false)
assert.equal(ready.checkout_created, false)
assert.deepEqual(ready.secrets, { MERCADOPAGO_ACCESS_TOKEN: true, MERCADOPAGO_WEBHOOK_SECRET: true })

for (const [name, overrides] of [
  ['qa_project_rejected', { BILLING_PROJECT_REF: 'cmsymmszlzikqpvfqjre' }],
  ['sandbox_rejected', { MERCADOPAGO_ENVIRONMENT: 'sandbox' }],
  ['activation_rejected', { BILLING_PRODUCTION_ENABLED: '1' }],
  ['protected_tenant_rejected', { BILLING_PRODUCTION_PILOT_TENANT_ID: '6', BILLING_PRODUCTION_ALLOWED_TENANT_IDS: '6' }],
  ['multiple_tenants_rejected', { BILLING_PRODUCTION_ALLOWED_TENANT_IDS: '42,43' }],
  ['paypal_rejected', { BILLING_PAYPAL_ENABLED: '1' }],
  ['webhook_rejected', { BILLING_WEBHOOK_URL: 'https://example.invalid/webhook' }],
]) {
  const result = evaluateProductionDryRun({ ...valid, ...overrides })
  assert.equal(result.ready, false, `${name} debe bloquearse`)
  assert.ok(result.blockers.length > 0, `${name} debe reportar un bloqueo`)
}

assert.ok(PROTECTED_TENANTS.has(1) && PROTECTED_TENANTS.has(5) && PROTECTED_TENANTS.has(6))
console.log(JSON.stringify({ dry_run_guard: 'passed', activation: 'blocked', checkout_created: false, protected_tenants: [...PROTECTED_TENANTS] }, null, 2))
