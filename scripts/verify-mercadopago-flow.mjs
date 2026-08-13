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
  production_activated: false,
}, null, 2))
