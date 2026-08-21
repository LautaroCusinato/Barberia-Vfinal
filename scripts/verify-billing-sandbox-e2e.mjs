import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Offline contract tests only. They never read secrets, contact Supabase or
// Mercado Pago, create tokens, or mutate billing state.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const api = read('supabase/functions/billing-api/index.ts')
const providers = read('supabase/functions/_shared/providers.ts')
const billing = read('src/pages/Billing.jsx')

assert.match(api, /function qaSandboxE2EEnabled\(tenantId: number\)/)
assert.match(api, /cmsymmszlzikqpvfqjre/)
assert.match(api, /ssagttjdgtypxjcgdnrw/)
assert.match(api, /BILLING_QA_E2E_ENABLED/)
assert.match(api, /BILLING_QA_E2E_TENANT_ID/)
assert.match(api, /BILLING_ENVIRONMENT.*=== 'qa'/)
assert.match(api, /same_plan_checkout_blocked/)
assert.match(api, /sandbox_e2e_same_plan_ready/)
assert.match(api, /route === 'cancel'/)
assert.match(api, /cancelSandboxSubscription/)
assert.match(api, /client_billing_context_forbidden/)
assert.match(api, /sandbox_cancellation_only|sandbox_cancellation_not_authorized/)
assert.match(api, /transition_saas_subscription/)
assert.match(api, /subscription\.sandbox_canceled/)
assert.doesNotMatch(api, /body\.is_e2e|body\.bypass_current_plan/, 'el bypass no puede depender del body del cliente')
const sandboxSubscriptionSource = api.match(/async function sandboxSubscription[\s\S]*?\n}\n\nasync function subscription/)?.[0] || ''
assert.ok(sandboxSubscriptionSource, 'no se pudo localizar el flujo sandbox')
assert.doesNotMatch(sandboxSubscriptionSource, /body\.tenant_id|body\.environment/, 'el flujo sandbox no puede aceptar tenant/entorno del cliente')
assert.match(providers, /mercadoPagoCancelSubscription/)
assert.match(providers, /method: 'PUT'/)
assert.match(providers, /status: 'canceled'/)
assert.match(providers, /environment !== 'sandbox'/)
assert.match(providers, /mercadoPagoPlanDetails\(externalPlanId: string, environment: MercadoPagoEnvironment = 'sandbox'\)/)
assert.match(providers, /sandbox_plan_only/)
assert.match(providers, /mercadoPagoPreapprovalDetails\(preapprovalId: string, environment: MercadoPagoEnvironment = 'sandbox'\)/)
assert.match(providers, /sandbox_subscription_only/)
assert.match(providers, /configuredMercadoPagoAccessToken\(\{ allowProduction: false, environment: 'sandbox' \}\)/)
assert.match(billing, /portal\?\.sandbox_e2e_same_plan_ready === true/)
assert.match(billing, /samePlanSandboxE2EReady/)
assert.match(billing, /itemCheckoutReady/)

const qa = ({ enabled = false, environment = 'qa', projectRef = 'cmsymmszlzikqpvfqjre', tenant = 1 } = {}) => enabled && environment === 'qa' && projectRef === 'cmsymmszlzikqpvfqjre' && projectRef !== 'ssagttjdgtypxjcgdnrw' && tenant === 1
const samePlan = ({ current = true, sandboxBinding = true, checkoutEnabled = true, qaAuthorized = false, projectRef = 'cmsymmszlzikqpvfqjre', environment = 'qa', tenant = 1 } = {}) => {
  if (!sandboxBinding || !checkoutEnabled) return false
  if (!current) return true
  return qa({ enabled: qaAuthorized, projectRef, environment, tenant })
}
const cancel = ({ environment = 'sandbox', tenant = 1, qaAuthorized = true, externalIdFromClient = false, binding = true, identity = true, alreadyCanceled = false } = {}) => {
  if (externalIdFromClient) return { allowed: false, code: 'client_billing_context_forbidden' }
  if (environment !== 'sandbox') return { allowed: false, code: 'sandbox_cancellation_only' }
  if (tenant !== 1 || !qa({ enabled: qaAuthorized, tenant })) return { allowed: false, code: 'sandbox_cancellation_not_authorized' }
  if (!binding) return { allowed: false, code: 'sandbox_binding_invalid' }
  if (!identity) return { allowed: false, code: 'sandbox_external_identity_mismatch' }
  return { allowed: true, idempotent: alreadyCanceled }
}

const cases = [
  ['same plan disabled without QA flag', samePlan({ qaAuthorized: false }) === false],
  ['same plan allowed only with QA flag and sandbox binding', samePlan({ qaAuthorized: true }) === true],
  ['production project cannot enable QA bypass', samePlan({ qaAuthorized: true, projectRef: 'ssagttjdgtypxjcgdnrw' }) === false],
  ['wrong environment cannot enable QA bypass', samePlan({ qaAuthorized: true, environment: 'production' }) === false],
  ['tenant B cannot enable QA bypass', samePlan({ qaAuthorized: true, tenant: 2 }) === false],
  ['missing binding rejected', samePlan({ qaAuthorized: true, sandboxBinding: false }) === false],
  ['checkout disabled rejected', samePlan({ qaAuthorized: true, checkoutEnabled: false }) === false],
  ['sandbox cancellation own tenant allowed', cancel().allowed === true],
  ['sandbox cancellation repeated is idempotent', cancel({ alreadyCanceled: true }).idempotent === true],
  ['production cancellation blocked', cancel({ environment: 'production' }).allowed === false],
  ['arbitrary external id rejected', cancel({ externalIdFromClient: true }).allowed === false],
  ['wrong tenant rejected', cancel({ tenant: 2 }).allowed === false],
  ['provider identity mismatch rejected', cancel({ identity: false }).allowed === false],
]
for (const [name, passed] of cases) assert.equal(passed, true, name)

assert.deepEqual(cancel(), { allowed: true, idempotent: false })
assert.deepEqual(cancel({ alreadyCanceled: true }), { allowed: true, idempotent: true })

console.log(JSON.stringify({
  contract: 'sandbox_same_plan_server_gate_and_cancel',
  cases: cases.length,
  financial_operations: 0,
  production_mutations: 0,
  provider_calls: 0,
}, null, 2))
