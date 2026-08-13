import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getBillingReturnState } from '../src/lib/billingReturnState.js'
import { evaluateProductionDryRun, PROTECTED_TENANTS, PRODUCTION_PROJECT_REF } from './billing-production-dry-run.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')

for (const value of ['success', 'pending', 'failure', 'cancel']) {
  assert.equal(getBillingReturnState(`?billing=${value}`)?.kind, value)
}
assert.equal(getBillingReturnState('?billing=unknown'), null)
assert.deepEqual(getBillingReturnState('?billing=success&subscription=active'), getBillingReturnState('?billing=success'))

const billingPage = read('src/pages/Billing.jsx')
assert.match(billingPage, /getBillingReturnState/)
assert.match(billingPage, /data-billing-return=/)
assert.match(billingPage, /role="status"/)
assert.doesNotMatch(billingPage, /subscription.*active.*billing/i)

const billingApi = read('supabase/functions/billing-api/index.ts')
assert.match(billingApi, /facturacion\?billing=success/)
assert.match(billingApi, /facturacion\?billing=cancel/)
assert.doesNotMatch(billingApi, /billing=success[^\n]*(?:update|activate|transition)/i)

const webhook = read('supabase/functions/billing-webhooks/index.ts')
const providers = read('supabase/functions/_shared/providers.ts')
for (const pattern of [/verifyMercadoPago/, /record_billing_webhook_event/, /saas_suscripciones_externas/, /transition_saas_subscription/]) assert.match(webhook, pattern)
for (const pattern of [/x-signature/i, /x-request-id/i, /MERCADOPAGO_WEBHOOK_SECRET/, /crypto\.subtle\.verify/, /dataIdFromUrl/, /authorized_payments/, /preapproval_plan/, /preapproval_plan\/search\?q=/]) assert.match(providers, pattern)
assert.match(providers, /resourcePath = input\.kind === 'subscription' \? `\/\$\{resource\}`/)
assert.doesNotMatch(providers, /\/v1\/\$\{resource\}\/\$\{encodeURIComponent\(input\.externalId\)\}/)
assert.match(webhook, /searchParams\.get\('data\.id'\)/)
assert.match(webhook, /plan_event_not_subscription/)
assert.ok(webhook.indexOf('plan_event_not_subscription') < webhook.indexOf('transition_saas_subscription'), 'los eventos de plan deben ignorarse antes de transicionar')
assert.match(webhook, /subscription_identity_mismatch/)
assert.match(webhook, /EXPECTED_MERCADO_PAGO_SANDBOX_APPLICATION_ID/)
assert.match(webhook, /provider === 'paypal' \|\| resourceType === 'preapproval'/, 'los pagos de Mercado Pago no deben transicionar suscripciones')

const rollout = read('docs/BILLING-PRODUCTION-ROLLOUT.md')
for (const phrase of ['NO ACTIVAR', 'MERCADOPAGO_ENVIRONMENT=production', 'BILLING_PRODUCTION_ENABLED', 'No activar por URL de retorno']) {
  assert.match(rollout, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))
}

const readyCandidate = evaluateProductionDryRun({
  BILLING_DRY_RUN: '1',
  BILLING_ENVIRONMENT: 'production',
  BILLING_PROJECT_REF: PRODUCTION_PROJECT_REF,
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
  BILLING_WEBHOOK_URL: `https://${PRODUCTION_PROJECT_REF}.supabase.co/functions/v1/billing-webhooks/mercadopago`,
  BILLING_WEBHOOK_VERIFIED: '1',
  BILLING_JOBS_CONFIGURED: '1',
  BILLING_ALERTING_CONFIGURED: '1',
  BILLING_BACKUP_VERIFIED: '1',
  BILLING_ROLLBACK_VERIFIED: '1',
  BILLING_PAYPAL_ENABLED: '0',
  BILLING_GLOBAL_PROVIDER_ENABLED: '0',
})
assert.equal(readyCandidate.ready, true)
assert.equal(readyCandidate.activation_performed, false)
assert.equal(readyCandidate.checkout_created, false)
assert.ok([...PROTECTED_TENANTS].includes(6))

const noConfig = evaluateProductionDryRun({})
assert.equal(noConfig.ready, false)
assert.equal(noConfig.activation_performed, false)
assert.equal(noConfig.checkout_created, false)

console.log(JSON.stringify({
  return_states: 'success,pending,failure,cancel',
  return_url_is_ux_only: true,
  webhook_signature_and_reconciliation: true,
  production_activation: 'blocked',
  checkout_created: false,
  protected_tenants: [1, 5, 6],
}, null, 2))
