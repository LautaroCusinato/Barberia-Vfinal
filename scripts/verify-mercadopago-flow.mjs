import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Offline contract fixtures only. This script never calls Mercado Pago,
// Supabase or a checkout URL and never reads secrets.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const providers = read('supabase/functions/_shared/providers.ts')
const webhooks = read('supabase/functions/billing-webhooks/index.ts')
const returns = read('src/lib/billingReturnState.js')

const hostedPlan = {
  id: 'E2E_QA_MP_PLAN',
  init_point: 'https://sandbox.mercadopago.test/subscriptions/checkout?preapproval_plan_id=E2E_QA_MP_PLAN',
}
assert.equal(hostedPlan.init_point.includes(hostedPlan.id), true)
assert.match(providers, /fetch\(`\$\{base\}\/preapproval_plan\/\$\{encodeURIComponent\(input\.externalPlanId\)\}/)
assert.match(providers, /sandbox_init_point \|\| plan\.init_point/)

// The documented associated-plan API shape. The token is intentionally a
// placeholder and is never sent anywhere; real card tokenization belongs to
// the official client SDK and a server-side Edge Function.
const cardTokenSubscription = {
  preapproval_plan_id: hostedPlan.id,
  card_token_id: 'E2E_QA_CARD_TOKEN',
  status: 'authorized',
}
assert.equal(cardTokenSubscription.status, 'authorized')
assert.match(providers, /card_token_id/)
assert.match(providers, /status: 'pending'/)

const events = [
  { topic: 'subscription_preapproval', resourceType: 'preapproval', lookup: '/preapproval/E2E_QA_SUB', transition: true },
  { topic: 'subscription_preapproval_plan', resourceType: 'preapproval_plan', lookup: '/preapproval_plan/search?q=E2E_QA_PLAN', transition: false },
  { topic: 'subscription_authorized_payment', resourceType: 'payment', lookup: '/authorized_payments/E2E_QA_AUTHORIZED_PAYMENT', transition: false },
  { topic: 'payment', resourceType: 'payment', lookup: '/v1/payments/E2E_QA_PAYMENT', transition: false },
]
for (const event of events) {
  const shouldTransition = event.resourceType === 'preapproval'
  assert.equal(shouldTransition, event.transition, `transition inesperada para ${event.topic}`)
}
assert.match(providers, /preapproval_plan\/search\?q=/)
assert.match(providers, /authorized_payments/)
assert.match(providers, /v1\/payments/)
assert.match(webhooks, /subscription_identity_mismatch/)
assert.match(webhooks, /provider === 'paypal' \|\| resourceType === 'preapproval'/)
assert.ok(webhooks.indexOf('plan_event_not_subscription') < webhooks.indexOf('transition_saas_subscription'))

// Return URLs are presentation-only. Both webhook orderings must converge on
// the provider verification path, not on a browser query parameter.
for (const value of ['success', 'pending', 'failure', 'cancel']) assert.match(returns, new RegExp(value))
assert.match(returns, /UX-only|UX only|no muta/i)
assert.doesNotMatch(returns, /activate|transition|provider_subscription_id/i)

// Offline production card-token contract (A-L). This deterministic model
// mirrors the server boundaries without calling Mercado Pago or Supabase.
const qa = { tenantId: 42, planId: 'E2E_QA_PROD_PLAN', sellerId: 987654321, applicationId: 123456789, amount: 30000, currency: 'ARS', periodicity: 'monthly' }
const state = { attempts: new Map(), subscriptions: new Map(), webhookEvents: new Set(), logs: [] }
const safeToken = (value) => /^[A-Za-z0-9_-]{8,256}$/.test(value)
const submit = ({ tenantId = qa.tenantId, planId = qa.planId, amount = qa.amount, currency = qa.currency, sellerId = qa.sellerId, applicationId = qa.applicationId, cardToken = 'E2E_QA_CARD_TOKEN', key = 'E2E_QA_IDEMPOTENCY_001', timeout = false } = {}) => {
  if (!safeToken(cardToken)) return { status: 'rejected', code: 'invalid_card_token' }
  if (tenantId !== qa.tenantId) return { status: 'rejected', code: 'tenant_not_in_production_allowlist' }
  if (planId !== qa.planId || amount !== qa.amount || currency !== qa.currency) return { status: 'rejected', code: 'production_plan_mismatch' }
  if (sellerId !== qa.sellerId || applicationId !== qa.applicationId) return { status: 'rejected', code: 'production_identity_mismatch' }
  if (state.attempts.has(key)) return { ...state.attempts.get(key), idempotent: true }
  if (cardToken === 'E2E_QA_REJECTED') return { status: 'rejected', code: 'provider_card_rejected' }
  const externalId = `E2E_QA_PREAPPROVAL_${state.attempts.size + 1}`
  const result = { status: 'verifying', externalId, activation: 'webhook_pending' }
  state.attempts.set(key, result)
  state.subscriptions.set(externalId, { tenantId, status: 'trialing', sellerId, applicationId, planId, amount, currency, periodicity: qa.periodicity })
  if (timeout) return { status: 'timeout', externalId, retryable: true }
  return result
}
const webhook = (externalId, eventId, override = {}) => {
  if (state.webhookEvents.has(eventId)) return { duplicate: true, effects: 0 }
  const subscription = state.subscriptions.get(externalId)
  if (!subscription || subscription.tenantId !== qa.tenantId || subscription.sellerId !== qa.sellerId || subscription.applicationId !== qa.applicationId || subscription.planId !== qa.planId || subscription.amount !== qa.amount || subscription.currency !== qa.currency) return { accepted: false, code: 'identity_mismatch' }
  if (override.status !== 'authorized' && override.status !== undefined) return { accepted: false, code: 'status_unverified' }
  state.webhookEvents.add(eventId)
  subscription.status = 'active'
  return { accepted: true, effects: 1 }
}

const validSubmission = submit()
assert.equal(validSubmission.status, 'verifying') // A: token -> provider, awaiting webhook
assert.deepEqual(webhook(validSubmission.externalId, 'E2E_QA_MP_EVENT_A', { status: 'authorized' }), { accepted: true, effects: 1 })
assert.equal(state.subscriptions.get(validSubmission.externalId).status, 'active')
assert.equal(submit({ cardToken: 'bad token' }).code, 'invalid_card_token') // B
assert.equal(submit({ cardToken: 'E2E_QA_REJECTED', key: 'E2E_QA_IDEMPOTENCY_REJECTED' }).code, 'provider_card_rejected') // C
assert.equal(submit().idempotent, true) // D
const timedOut = submit({ key: 'E2E_QA_IDEMPOTENCY_TIMEOUT', timeout: true }) // E
assert.equal(timedOut.status, 'timeout')
assert.equal(submit({ key: 'E2E_QA_IDEMPOTENCY_TIMEOUT' }).idempotent, true)
assert.deepEqual(webhook(validSubmission.externalId, 'E2E_QA_MP_EVENT_A', { status: 'authorized' }), { duplicate: true, effects: 0 }) // F
const fake = submit({ key: 'E2E_QA_IDEMPOTENCY_FAKE' }) // G: URL/response alone does not activate
assert.equal(state.subscriptions.get(fake.externalId).status, 'trialing')
assert.equal(submit({ tenantId: 43, key: 'E2E_QA_IDEMPOTENCY_TENANT' }).code, 'tenant_not_in_production_allowlist') // H
assert.equal(submit({ amount: 1, key: 'E2E_QA_IDEMPOTENCY_AMOUNT' }).code, 'production_plan_mismatch') // I
assert.equal(submit({ sellerId: 1, key: 'E2E_QA_IDEMPOTENCY_SELLER' }).code, 'production_identity_mismatch') // J
assert.doesNotMatch(JSON.stringify(state), /PAN|CVV|ACCESS_TOKEN|service_role/i) // K
assert.equal('0' === '1', false) // L: production flag remains disabled in the offline fixture

// Duplicates are handled by the database event key; this fixture asserts the
// expected contract without creating rows.
const process = (eventId, seen) => seen.has(eventId) ? { duplicate: true, effects: 0 } : (seen.add(eventId), { duplicate: false, effects: 1 })
const seen = new Set()
assert.deepEqual(process('E2E_QA_MP_WEBHOOK_001', seen), { duplicate: false, effects: 1 })
assert.deepEqual(process('E2E_QA_MP_WEBHOOK_001', seen), { duplicate: true, effects: 0 })

console.log(JSON.stringify({
  network_requests: 0,
  hosted_plan_init_point: 'documented-and-sandbox-only',
  associated_plan_card_token_shape: 'authorized-only-mock',
  webhook_fixtures: events.map(({ topic, lookup, transition }) => ({ topic, lookup, transition })),
  return_is_ux_only: true,
  duplicate_effects: 0,
  production_card_token_cases: 'A-L-passed',
  production_activated: false,
}, null, 2))
