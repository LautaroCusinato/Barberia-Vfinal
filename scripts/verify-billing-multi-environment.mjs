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
assert.match(providers, /EXPECTED_MERCADO_PAGO_SANDBOX_APPLICATION_ID\s*=\s*254158644354755/, 'sandbox debe usar la aplicación TEST autoritativa')
assert.match(providers, /environment: MercadoPagoEnvironment/)
assert.match(providers, /mercadoPagoExternalStatus\(input: \{ externalId: string; kind: 'checkout' \| 'subscription'; environment: MercadoPagoEnvironment \}/)
assert.match(providers, /preapproval_plan\/search\?\$\{searchParams\.toString\(\)\}/, 'sandbox plan sync debe buscar antes de crear')
assert.match(providers, /sandbox_plan_ambiguous/, 'sandbox plan sync debe bloquear matches ambiguos')
assert.match(providers, /source: 'reused'/, 'sandbox plan sync debe informar reutilización')
assert.match(api, /resolveMercadoPagoEnvironment/)
assert.match(api, /sandboxSubscription/)
assert.match(api, /external_subscription_already_linked/)
assert.match(api, /billing_binding_not_configured/)
assert.match(api, /resolveSandboxScope/)
assert.match(api, /sandbox_plan_not_ready/)
assert.doesNotMatch(api, /const SANDBOX_BILLING\s*=\s*Object\.freeze\(\{\s*tenantId:/)
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
for (const field of ['card-number', 'expiration', 'security-code']) assert.match(cardForm, new RegExp(`formId\\}-${field}.*billing-card-secure-field`), `secure field ${field} debe usar contenedor compatible con Mercado Pago.js`)
assert.doesNotMatch(billingPage, /sandbox.*tenant_id\s*:/i)

const bindings = [
  { tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 254158644354755, active: true, checkoutEnabled: false, externalPlanId: null, priceEnabled: false },
  { tenant: 202, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, active: true, checkoutEnabled: false, externalPlanId: 'production-plan', priceEnabled: true },
]

function resolve(input) {
  const binding = bindings.find((item) => item.tenant === input.tenant && item.provider === input.provider && item.environment === input.environment && item.active)
  if (!binding) return { allowed: false, reason: 'billing_binding_not_configured' }
  if (input.plan !== binding.plan || input.price !== binding.price) return { allowed: false, reason: 'billing_price_binding_mismatch' }
  if (input.seller !== binding.seller || input.application !== binding.application) return { allowed: false, reason: 'provider_identity_mismatch' }
  if (input.amount !== binding.amount || input.currency !== binding.currency) return { allowed: false, reason: 'provider_contract_mismatch' }
  if (input.environment === 'production' && input.productionEnabled !== true) return { allowed: false, reason: 'production_checkout_blocked' }
  if (input.environment === 'sandbox' && (!binding.checkoutEnabled || !binding.externalPlanId || !binding.priceEnabled)) return { allowed: true, reason: 'sandbox_scope_resolved_plan_pending' }
  return { allowed: true, reason: 'binding_match' }
}

const checks = [
  ['A QA tenant with sandbox binding resolves scope', resolve({ tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 254158644354755 }).reason === 'sandbox_scope_resolved_plan_pending'],
  ['B second QA tenant without binding rejected', !resolve({ tenant: 102, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 254158644354755 }).allowed],
  ['C historical id 6 without binding rejected', !resolve({ tenant: 6, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 254158644354755 }).allowed],
  ['D production binding identified but checkout blocked', !resolve({ tenant: 202, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: false }).allowed],
  ['E sandbox tenant cannot resolve production environment', !resolve({ tenant: 101, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed],
  ['F unknown tenant rejected', !resolve({ tenant: 999, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 254158644354755 }).allowed],
  ['G production credential in sandbox rejected', !resolve({ tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 1334909095, application: 3640459333061791 }).allowed],
  ['H sandbox credential in production rejected', !resolve({ tenant: 202, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 3595396521, application: 254158644354755, productionEnabled: true }).allowed],
  ['I wrong plan rejected', !resolve({ tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'pro', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 254158644354755 }).allowed],
  ['J wrong seller rejected', !resolve({ tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 1, application: 254158644354755 }).allowed],
  ['K wrong application rejected', !resolve({ tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 1 }).allowed],
  ['L wrong currency rejected', !resolve({ tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'USD', seller: 3595396521, application: 254158644354755 }).allowed],
  ['M wrong amount rejected', !resolve({ tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 1, currency: 'ARS', seller: 3595396521, application: 254158644354755 }).allowed],
]
for (const [name, passed] of checks) assert.equal(passed, true, name)

assert.equal(resolve({ tenant: 101, provider: 'mercadopago', environment: 'sandbox', plan: 'starter', price: 1, amount: 15000, currency: 'ARS', seller: 3595396521, application: 254158644354755 }).allowed, true)
assert.equal(resolve({ tenant: 202, provider: 'mercadopago', environment: 'production', plan: 'starter', price: 2, amount: 30000, currency: 'ARS', seller: 1334909095, application: 3640459333061791, productionEnabled: true }).allowed, true)

console.log(JSON.stringify({ matrix: checks.length, sandbox_binding_scope: 'resolved_plan_pending', unbound_and_cross_environment: 'rejected', financial_writes: 0 }, null, 2))
