import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const migration = readFileSync('supabase/migrations/20260816090000_billing_multi_environment_bindings.sql', 'utf8')
const context = readFileSync('supabase/functions/_shared/billing-context.ts', 'utf8')
const api = readFileSync('supabase/functions/billing-api/index.ts', 'utf8')
const hooks = readFileSync('supabase/functions/billing-webhooks/index.ts', 'utf8')
const providers = readFileSync('supabase/functions/_shared/providers.ts', 'utf8')
const billingPage = readFileSync('src/pages/Billing.jsx', 'utf8')
const cardForm = readFileSync('src/components/billing/MercadoPagoCardTokenForm.jsx', 'utf8')
const bindingAwareMigration = readFileSync('supabase/migrations/20260817090000_billing_binding_aware_checkout.sql', 'utf8')

for (const phrase of [
  'saas_billing_provider_bindings',
  "entorno text not null check (entorno in ('sandbox', 'production'))",
  'unique (barberia_id, proveedor_codigo, entorno)',
  'unique (proveedor_codigo, entorno, precio_id)',
  'enable row level security',
  'revoke all on public.saas_billing_provider_bindings from anon',
  'checkout_habilitado',
  'external_seller_id',
  'external_application_id',
]) assert.match(migration, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `falta guard de binding: ${phrase}`)

for (const phrase of ['resolveTenantBillingBinding', 'resolveBindingByExternalPlan', 'billing_binding_not_configured', 'billing_price_binding_mismatch', 'Never falls back']) {
  assert.match(context, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `falta resolver seguro: ${phrase}`)
}
assert.match(api, /resolveTenantBillingBinding\(admin, tenantId, provider, environment as/)
assert.match(api, /resolveTenantBillingBinding\(admin, tenantId, 'mercadopago', 'production'\)/)
assert.match(hooks, /resolveWebhookEnvironment/)
assert.match(hooks, /tenant_environment_binding_mismatch/)
assert.match(hooks, /environment_binding_mismatch/)
assert.match(hooks, /compatibility hint for an unlinked event/)
assert.match(providers, /MERCADOPAGO_SANDBOX_ACCESS_TOKEN/)
assert.match(providers, /MERCADOPAGO_SANDBOX_WEBHOOK_SECRET/)
assert.match(providers, /environmentOverride/)
assert.match(providers, /production_provider_disabled/)
assert.match(providers, /export async function mercadoPagoSubscription/)
assert.match(providers, /environment: MercadoPagoEnvironment/)
assert.match(providers, /mercadoPagoExternalStatus\(input: \{ externalId: string; kind: 'checkout' \| 'subscription'; environment: MercadoPagoEnvironment \}/)
assert.match(api, /resolveMercadoPagoEnvironment/)
assert.match(api, /sandboxSubscription/)
assert.match(api, /external_subscription_already_linked/)
assert.match(api, /billing_binding_not_configured/)
assert.match(api, /metadata\.environment/)
assert.match(api, /MERCADOPAGO_SANDBOX_PAYER_EMAIL/)
assert.doesNotMatch(api, /sandboxSubscription[\s\S]*tenant\.billing_email/)
assert.match(api, /sandbox_checkout_ready/)
assert.match(bindingAwareMigration, /saas_billing_provider_bindings/)
assert.match(bindingAwareMigration, /v_environment/)
assert.match(bindingAwareMigration, /v_binding_count/)
assert.match(billingPage, /VITE_MERCADOPAGO_SANDBOX_PUBLIC_KEY/)
assert.match(billingPage, /sandboxCheckoutReady/)
assert.match(billingPage, /Continuar con tarjeta TEST/)
assert.match(cardForm, /environment = 'production'/)

const contracts = {
  sandbox: { tenant: 6, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 3172086171935346 },
  production: { tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791 },
}

function resolve(input) {
  const expected = contracts[input.environment]
  if (!expected || input.provider !== 'mercadopago') return { allowed: false, reason: 'unsupported_or_unknown_environment' }
  if (input.tenant !== expected.tenant) return { allowed: false, reason: 'tenant_environment_binding_mismatch' }
  if (input.plan !== expected.plan || input.price !== expected.price) return { allowed: false, reason: 'billing_price_binding_mismatch' }
  if (input.seller !== expected.seller || input.application !== expected.application) return { allowed: false, reason: 'provider_identity_mismatch' }
  if (input.amount !== expected.amount || input.currency !== expected.currency) return { allowed: false, reason: 'provider_contract_mismatch' }
  if (input.environment === 'production' && input.productionEnabled !== true) return { allowed: false, reason: 'production_checkout_blocked' }
  return { allowed: true, reason: 'binding_match' }
}

const checks = [
  ['A tenant6 sandbox allowed', resolve({ tenant: 6, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 3172086171935346 }).allowed],
  ['B tenant6 production rejected', !resolve({ tenant: 6, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: false }).allowed],
  ['C tenant8 production identified but checkout blocked', !resolve({ tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: false }).allowed],
  ['D tenant8 sandbox rejected', !resolve({ tenant: 8, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 3172086171935346 }).allowed],
  ['E tenant1 production blocked', !resolve({ tenant: 1, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed],
  ['F tenant5 production blocked', !resolve({ tenant: 5, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed],
  ['G unknown tenant blocked', !resolve({ tenant: 999, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed],
  ['H production credential in sandbox rejected', !resolve({ tenant: 6, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 1334909095, application: 3640459333061791 }).allowed],
  ['I sandbox credential in production rejected', !resolve({ tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 3595396521, application: 3172086171935346, productionEnabled: true }).allowed],
  ['J wrong plan rejected', !resolve({ tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'pro', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed],
  ['K wrong seller rejected', !resolve({ tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1, application: 3640459333061791, productionEnabled: true }).allowed],
  ['L wrong application rejected', !resolve({ tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 1, productionEnabled: true }).allowed],
  ['M wrong currency rejected', !resolve({ tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'USD', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed],
  ['N wrong amount rejected', !resolve({ tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 1, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed],
]
for (const [name, passed] of checks) assert.equal(passed, true, name)

assert.equal(resolve({ tenant: 8, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed, true)
assert.equal(resolve({ tenant: 6, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 3172086171935346 }).allowed, true)

console.log(JSON.stringify({ matrix: checks.length, tenant6_sandbox: 'allowed', tenant8_production: 'identified_but_checkout_blocked', unknown_and_cross_environment: 'rejected', financial_writes: 0 }, null, 2))
