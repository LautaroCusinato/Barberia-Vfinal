// Regresión: el backend con service key debe poder operar billing y los
// procesos de reconciliación no deben destruir el entorno de los vínculos.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const migration = read('supabase/migrations/20261002090000_billing_service_role_claims.sql')
const billingApi = read('supabase/functions/billing-api/index.ts')
const billingJobs = read('supabase/functions/billing-jobs/index.ts')
const webhooks = read('supabase/functions/billing-webhooks/index.ts')

// 1. PostgREST v10+ sólo publica request.jwt.claims (JSON). El helper debe
//    leerlo; la GUC heredada queda sólo como compatibilidad.
assert.match(migration, /create or replace function public\.request_is_service_role\(\)/)
assert.match(migration, /current_setting\('request\.jwt\.claims', true\)[\s\S]{0,40}->> 'role'/)
assert.match(migration, /is not distinct from 'service_role'/)
for (const fn of ['billing_can_view', 'billing_can_view_commercial', 'billing_can_manage', 'billing_can_reconcile', 'billing_can_checkout_for_tenant', 'barberia_operational_access']) {
  const body = migration.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`))?.[0]
  assert.ok(body, `${fn} debe redefinirse`)
  assert.match(body, /public\.request_is_service_role\(\)/, `${fn} debe usar request_is_service_role()`)
  assert.doesNotMatch(body, /current_setting\('request\.jwt\.claim\.role'/, `${fn} no debe depender sólo de la GUC heredada`)
}
assert.match(migration, /revoke all on function public\.request_is_service_role\(\) from public, anon, authenticated/)
assert.doesNotMatch(migration, /grant execute on function public\.request_is_service_role\(\) to (anon|authenticated)/)
assert.match(migration, /^begin;/m)
assert.match(migration, /^commit;/m)

// Simulación de la expresión SQL: sólo un claim service_role habilita.
const isServiceRole = (legacy, claims) => {
  const legacyRole = legacy || null
  const claimRole = claims ? JSON.parse(claims).role ?? null : null
  return (legacyRole ?? claimRole) === 'service_role'
}
assert.equal(isServiceRole('', '{"role":"service_role"}'), true)
assert.equal(isServiceRole('', '{"role":"authenticated","sub":"x"}'), false)
assert.equal(isServiceRole('', ''), false)
assert.equal(isServiceRole('', '{"role":"anon"}'), false)

// 2. La reconciliación fusiona metadata: `environment` es la única fuente
//    server-side del entorno del vínculo.
assert.match(billingApi, /metadata: \{ \.\.\.linkMetadata, last_reconciliation_status: result\.status \}/)
assert.match(billingJobs, /metadata: \{ \.\.\.linkMetadata, last_reconciliation_status: result\.status, correlation_id: correlationId \}/)
for (const [name, source] of [['billing-api', billingApi], ['billing-jobs', billingJobs]]) {
  assert.doesNotMatch(source, /metadata: \{ last_reconciliation_status/, `${name} no debe reemplazar metadata del vínculo externo`)
}
const merged = { ...{ environment: 'sandbox', flow: 'x' }, last_reconciliation_status: 'authorized' }
assert.equal(merged.environment, 'sandbox')

// 3. Secreto del cron comparado en tiempo constante.
assert.match(billingJobs, /function constantTimeEqual/)
assert.match(billingJobs, /constantTimeEqual\(request\.headers\.get\('x-billing-cron-secret'\) \|\| '', configured\)/)
assert.doesNotMatch(billingJobs, /request\.headers\.get\('x-billing-cron-secret'\) !== configured/)

// 4. El cuerpo del webhook de Mercado Pago no está firmado: plan y orden del
//    evento salen del recurso verificado.
const afterVerification = webhooks.slice(webhooks.indexOf('const signatureValid'))
assert.doesNotMatch(afterVerification, /payload\.preapproval_plan_id/, 'el plan no puede tomarse del cuerpo sin firmar')
assert.match(webhooks, /const verifiedEventAt = /)
assert.match(webhooks, /p_provider_event_at: verifiedEventAt/)
assert.doesNotMatch(webhooks, /p_provider_event_at: minimal\.updated_at/)

console.log(JSON.stringify({
  suite: 'billing-service-role',
  service_role_detection: 'request.jwt.claims',
  reconciliation_metadata: 'MERGED',
  cron_secret: 'CONSTANT_TIME',
  webhook_context: 'VERIFIED_RESOURCE_ONLY',
  result: 'PASS',
}))
