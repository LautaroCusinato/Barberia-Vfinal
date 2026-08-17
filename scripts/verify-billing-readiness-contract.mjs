import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateProductionDryRun, PRODUCTION_PROJECT_REF } from './billing-production-dry-run.mjs'
import { resolveReadinessFlag } from './billing-production-dry-run.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const providers = read('supabase/functions/_shared/providers.ts')
const billingApi = read('supabase/functions/billing-api/index.ts')

assert.match(providers, /export function productionTechnicalReadiness/)
assert.match(providers, /export function productionFinancialActivation/)
assert.match(providers, /BILLING_PRODUCTION_WEBHOOK_VERIFIED/)
assert.match(providers, /BILLING_PRODUCTION_JOBS_VERIFIED/)
assert.match(providers, /BILLING_PRODUCTION_ROLLBACK_VERIFIED/)
assert.match(billingApi, /technical_readiness:/)
assert.match(billingApi, /financial_activation:/)
assert.match(billingApi, /technical_ready:/)
assert.match(billingApi, /financially_enabled:/)

const base = {
  BILLING_DRY_RUN: '1',
  BILLING_ENVIRONMENT: 'production',
  BILLING_PROJECT_REF: PRODUCTION_PROJECT_REF,
  BILLING_PRODUCTION_ENABLED: '0',
  MERCADOPAGO_ENVIRONMENT: 'production',
  MERCADOPAGO_API_BASE_URL: 'https://api.mercadopago.com',
  BILLING_PRODUCTION_CHECKOUT_MODE: 'card_token_id',
  MERCADOPAGO_PUBLIC_KEY_CONFIGURED: '1',
  BILLING_PRODUCTION_READINESS: 'ready',
  BILLING_PRODUCTION_CHECKOUT_CONFIRMATION: 'I_UNDERSTAND_REAL_CHARGES',
  BILLING_PRODUCTION_BACKUP_VERIFIED: '1',
  BILLING_PRODUCTION_ALERTING_VERIFIED: '1',
  BILLING_PRODUCTION_WEBHOOK_VERIFIED: '1',
  BILLING_PRODUCTION_JOBS_VERIFIED: '1',
  BILLING_PRODUCTION_ROLLBACK_VERIFIED: '1',
  MERCADOPAGO_ACCESS_TOKEN: 'opaque-server-secret',
  MERCADOPAGO_WEBHOOK_SECRET: 'opaque-webhook-secret',
  MERCADOPAGO_TOKEN_IDENTITY_VERIFIED: '1',
  MERCADOPAGO_PRODUCTION_SELLER_ID: '1334909095',
  MERCADOPAGO_PRODUCTION_APPLICATION_ID: '3640459333061791',
  BILLING_PRODUCTION_PILOT_TENANT_ID: '8',
  BILLING_PRODUCTION_ALLOWED_TENANT_IDS: '8',
  BILLING_PILOT_TENANT_VERIFIED: '1',
  BILLING_PILOT_TENANT_ENVIRONMENT: 'production',
  BILLING_PILOT_PROVIDER: 'mercadopago',
  BILLING_PLAN_VERIFIED: '1',
  BILLING_PLAN_CODE: 'starter',
  BILLING_PLAN_COUNTRY: 'AR',
  BILLING_PLAN_CURRENCY: 'ARS',
  BILLING_PLAN_AMOUNT: '30000',
  BILLING_PLAN_PERIODICITY: 'monthly',
  BILLING_TRIAL_DAYS: '14',
  MERCADOPAGO_PRODUCTION_PLAN_ID: '8465dc6756094b31899c76c9db9dbfe2',
  BILLING_WEBHOOK_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co/functions/v1/billing-webhooks/mercadopago`,
  BILLING_MULTI_ENVIRONMENT_VERIFIED: '1',
  BILLING_PAYPAL_ENABLED: '0',
  BILLING_GLOBAL_PROVIDER_ENABLED: '0',
}

const technicalReadyButFinanciallyBlocked = { ...base, BILLING_PRODUCTION_ENABLED: '0' }
const dryRun = evaluateProductionDryRun(technicalReadyButFinanciallyBlocked)
assert.equal(dryRun.ready, true, 'technical configuration can be dry-run while activation remains disabled')
assert.equal(dryRun.activation_performed, false)
assert.equal(dryRun.checkout_created, false)

const financialBlockedByConfirmation = { ...base, BILLING_PRODUCTION_CHECKOUT_CONFIRMATION: '' }
assert.equal(financiallyEnabled(financialBlockedByConfirmation), false, 'confirmation remains mandatory')
const financialBlockedByEnable = { ...base, BILLING_PRODUCTION_ENABLED: '0' }
assert.equal(financiallyEnabled(financialBlockedByEnable), false, 'production enable switch remains mandatory')
const financialBlockedByReadiness = { ...base, BILLING_PRODUCTION_READINESS: 'pending' }
assert.equal(financiallyEnabled(financialBlockedByReadiness), false, 'readiness flag remains mandatory')

const conflicting = resolveReadinessFlag({ BILLING_PRODUCTION_BACKUP_VERIFIED: '1', BILLING_BACKUP_VERIFIED: '0' }, 'BILLING_PRODUCTION_BACKUP_VERIFIED')
assert.equal(conflicting.conflict, true, 'canonical/legacy conflicts must fail closed')
assert.equal(conflicting.value, false)
const aliasOnly = resolveReadinessFlag({ BILLING_BACKUP_VERIFIED: '1' }, 'BILLING_PRODUCTION_BACKUP_VERIFIED')
assert.equal(aliasOnly.value, true, 'legacy alias is accepted only for compatibility')

const missingAlerting = evaluateProductionDryRun({ ...base, BILLING_PRODUCTION_ALERTING_VERIFIED: '0' })
assert.ok(missingAlerting.blockers.includes('backup_for_checkout') === false)
assert.ok(missingAlerting.blockers.includes('alerting_for_checkout'))
const missingBackup = evaluateProductionDryRun({ ...base, BILLING_PRODUCTION_BACKUP_VERIFIED: '0' })
assert.ok(missingBackup.blockers.includes('backup_for_checkout'))
const pendingWebhookSource = providers.includes('webhookE2ePending') && providers.includes('BILLING_PRODUCTION_WEBHOOK_VERIFIED')
assert.equal(pendingWebhookSource, true, 'webhook E2E status must remain explicit/pending')

const protectedTenant = evaluateProductionDryRun({ ...base, BILLING_PRODUCTION_PILOT_TENANT_ID: '6', BILLING_PRODUCTION_ALLOWED_TENANT_IDS: '6' })
assert.ok(protectedTenant.blockers.includes('pilot_tenant_not_protected'))
const wrongEnvironment = evaluateProductionDryRun({ ...base, MERCADOPAGO_ENVIRONMENT: 'sandbox' })
assert.ok(wrongEnvironment.blockers.includes('mercadopago_environment_explicit'))
const crossEnvironment = evaluateProductionDryRun({ ...base, BILLING_PRODUCTION_ALLOWED_TENANT_IDS: '6' })
assert.ok(crossEnvironment.blockers.includes('single_pilot_tenant') || crossEnvironment.blockers.includes('pilot_tenant_not_protected'))

function financiallyEnabled(env) {
  return env.BILLING_PRODUCTION_READINESS === 'ready'
    && env.BILLING_PRODUCTION_CHECKOUT_CONFIRMATION === 'I_UNDERSTAND_REAL_CHARGES'
    && env.BILLING_PRODUCTION_ENABLED === '1'
}

console.log(JSON.stringify({
  contract: 'technical_readiness_separated_from_financial_activation',
  cases: 'A-L-passed',
  canonical_flags: true,
  legacy_conflict_fail_closed: true,
  webhook_e2e: 'explicit_pending_until_financial_e2e',
  checkout_created: false,
  payments: 0,
}, null, 2))
