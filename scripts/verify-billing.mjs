import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeProviderStatus, BILLING_STATES, assertAdapter } from '../integrations/billing/contract.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

const migration = read('supabase/migrations/20260807030000_billing_core.sql')
const hardeningMigration = read('supabase/migrations/20260807031000_billing_outbox_and_idempotency.sql')
const raceMigration = read('supabase/migrations/20260807032000_billing_checkout_race.sql')
const uniquenessMigration = read('supabase/migrations/20260807034000_billing_plan_checkout_uniques.sql')
const authMigration = read('supabase/migrations/20260807060000_billing_authorization_hardening.sql')
const authNullMigration = read('supabase/migrations/20260807061000_billing_auth_null_safety.sql')
const authBooleanMigration = read('supabase/migrations/20260807062000_billing_auth_boolean_safety.sql')
const authPrivilegesMigration = read('supabase/migrations/20260807063000_billing_helper_privileges.sql')
for (const table of ['saas_proveedores_pago', 'saas_plan_proveedores', 'saas_billing_customers', 'saas_suscripciones_externas', 'saas_billing_checkout_attempts', 'saas_billing_payments', 'saas_billing_invoices', 'saas_billing_refunds', 'saas_billing_webhook_events', 'saas_billing_state_history', 'saas_billing_events']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `falta tabla ${table}`)
}
for (const state of ['trialing', 'active', 'past_due', 'grace_period', 'suspended', 'canceled', 'incomplete', 'payment_review', 'refunded']) assert.match(migration, new RegExp(`'${state}'`), `falta estado ${state}`)
for (const functionName of ['get_billing_catalog', 'get_billing_portal', 'create_billing_checkout_intent', 'transition_saas_subscription', 'expire_saas_trials', 'record_billing_webhook_event', 'get_platform_billing_overview']) assert.match(migration, new RegExp(`function public\\.${functionName}`), `falta RPC ${functionName}`)
assert.match(migration, /alter table public\.saas_billing_webhook_events enable row level security/)
assert.match(migration, /revoke all on public\.saas_proveedores_pago.*from anon/s)
assert.match(migration, /unique \(barberia_id, idempotency_key\)/)
assert.match(hardeningMigration, /pg_advisory_xact_lock/)
assert.match(hardeningMigration, /subscription\.trial_started/)
assert.match(hardeningMigration, /payment\.succeeded/)
assert.match(raceMigration, /pg_advisory_xact_lock/)
assert.match(uniquenessMigration, /uq_billing_active_checkout_per_plan/)
assert.match(uniquenessMigration, /uq_billing_external_plan_per_provider/)
for (const contract of ['billing_can_view_commercial', 'billing_can_manage', 'billing_can_reconcile', 'billing_can_checkout_for_tenant']) assert.match(authMigration, new RegExp(`function public\\.${contract}`), `falta autorización ${contract}`)
assert.match(authMigration, /billing_can_checkout_for_tenant\(p_barberia_id\)/)
assert.match(authMigration, /billing_can_manage\(v_sub\.barberia_id\)/)
assert.match(authMigration, /commercial_payments|payments.*case when v_full/s)
assert.match(authNullMigration, /coalesce\(public\.is_barberia_role/)
assert.match(authBooleanMigration, /coalesce\(current_setting\('request\.jwt\.claim\.role'/)
assert.match(authPrivilegesMigration, /revoke all on function public\.billing_can_view_commercial.*billing_can_manage/s)
assert.match(authPrivilegesMigration, /grant execute on function public\.billing_can_view_commercial.*billing_can_reconcile.*to service_role/s)

const billingPage = read('src/pages/Billing.jsx')
assert.match(billingPage, /billingApi\('status'\)/)
assert.match(billingPage, /billingApi\('checkout'/)
assert.match(read('src/components/Sidebar.jsx'), /facturacion/)
assert.match(read('src/App.jsx'), /<Billing barberiaId=/)

for (const file of ['integrations/billing/providers/mercadopago.mjs', 'integrations/billing/providers/paypal.mjs']) {
  const source = read(file)
  assert.match(source, /verifyWebhook/)
  assert.match(source, /MERCADOPAGO|PAYPAL/)
  assert.doesNotMatch(source, /(access_token|client_secret|webhook_secret)\s*[:=]\s*['"][^$]/i)
}
const workflows = JSON.parse(read('integrations/billing/n8n/billing-workflows.inactive.json'))
assert.equal(workflows.length, 5)
assert.ok(workflows.every((workflow) => workflow.active === false), 'hay un workflow billing activo')

assert.equal(normalizeProviderStatus('mercadopago', 'approved'), 'active')
assert.equal(normalizeProviderStatus('paypal', 'SUSPENDED'), 'suspended')
assert.ok(BILLING_STATES.includes('grace_period'))
assert.throws(() => assertAdapter({}), /Adaptador incompleto/)

console.log('Billing verification passed: schema contract, RLS guards, frontend portal, adapters y workflows inactivos.')
