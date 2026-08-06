import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tenantModule = await fs.readFile(path.join(root, 'src/lib/tenant.js'), 'utf8')
const migration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806060000_saas_foundation.sql'),
  'utf8',
)
const crmSyncMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806100000_sync_crm_negocios.sql'),
  'utf8',
)
const platformCrm = await fs.readFile(path.join(root, 'src/pages/PlatformCRM.jsx'), 'utf8')
const securityMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806110000_harden_security_definer_grants.sql'),
  'utf8',
)
const accessMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806120000_enforce_booking_access.sql'),
  'utf8',
)
const rlsMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806140000_consolidate_saas_rls.sql'),
  'utf8',
)
const fkIndexesMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806143000_add_crm_saas_fk_indexes.sql'),
  'utf8',
)
const whatsappContractMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806150000_multitenant_whatsapp_contract.sql'),
  'utf8',
)
const whatsappContractFixMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806151000_fix_claim_whatsapp_event_conflict.sql'),
  'utf8',
)
const whatsappEventPolicyMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806152000_add_service_event_policy.sql'),
  'utf8',
)
const whatsappEventIndexMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806153000_add_automation_tenant_index.sql'),
  'utf8',
)
const whatsappShadowMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806160000_whatsapp_shadow_runs.sql'),
  'utf8',
)
const whatsappMutationMigration = await fs.readFile(
  path.join(root, 'supabase/migrations/20260806161000_whatsapp_booking_mutations.sql'),
  'utf8',
)
const whatsappTemplate = JSON.parse(await fs.readFile(
  path.join(root, 'integrations/templates/WhatsApp Multi Tenant - Contract Template.json'),
  'utf8',
))
const whatsappTemplateText = await fs.readFile(
  path.join(root, 'integrations/templates/WhatsApp Multi Tenant - Contract Template.json'),
  'utf8',
)
const whatsappContractDocs = await fs.readFile(
  path.join(root, 'docs/MULTITENANT_WHATSAPP_CONTRACT.md'),
  'utf8',
)

for (const exportName of ['DEFAULT_TENANT_ID', 'DEFAULT_VERTICAL', 'getRuntimeTenant', 'tenantStorageKey']) {
  assert.match(tenantModule, new RegExp(`(?:export const|export function)\\s+${exportName}`), `${exportName} missing`)
}

for (const table of ['saas_planes', 'saas_suscripciones', 'platform_members', 'crm_negocios', 'crm_leads', 'crm_interacciones', 'saas_integraciones']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`), `${table} missing`)
}

for (const required of ['trial_ends_at', 'estado_cuenta', 'is_platform_member', '14 days', 'row level security']) {
  assert.match(migration, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), `${required} missing`)
}

for (const role of ['owner', 'admin', 'sales', 'support', 'readonly', 'automation']) {
  assert.match(migration, new RegExp(`'${role}'`), `platform role ${role} missing`)
}

for (const required of ['idx_crm_negocios_barberia_id_unique', 'barberias_sync', 'sync_barberia_to_crm', 'trg_barberias_sync_crm']) {
  assert.match(crmSyncMigration, new RegExp(required), `${required} missing`)
}

assert.match(platformCrm, /setView\('businesses'\)/, 'business navigation missing')
assert.match(platformCrm, /setView\('leads'\)/, 'lead navigation missing')

for (const required of ['search_path = public, pg_temp', 'revoke all on function public.get_conversacion', 'revoke all on function public.upsert_conversacion', 'service_role']) {
  assert.match(securityMigration, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), `${required} missing`)
}

for (const required of ['barberia_booking_access', 'guard_public_reservation_access', 'trg_turnos_guard_public_access', 'past_due']) {
  assert.match(accessMigration, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), `${required} missing`)
}

for (const required of ['saas_suscripciones_select_access', 'saas_integraciones_insert_owner', 'saas_integraciones_update_owner', 'saas_integraciones_delete_owner']) {
  assert.match(rlsMigration, new RegExp(required), `${required} missing`)
}

for (const required of ['idx_crm_interacciones_created_by', 'idx_crm_leads_negocio_id', 'idx_crm_leads_responsable_id', 'idx_saas_suscripciones_plan_codigo']) {
  assert.match(fkIndexesMigration, new RegExp(required), `${required} missing`)
}

for (const required of [
  'integration_type',
  'external_instance_id',
  'credential_reference',
  'saas_automation_events',
  'resolve_whatsapp_tenant_context',
  'claim_whatsapp_event',
  'finish_whatsapp_event',
  'cleanup_whatsapp_events',
  'crear_reserva_whatsapp',
  'search_path = public, pg_temp',
  'service_role',
]) {
  assert.match(whatsappContractMigration, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), `${required} missing`)
}
assert.match(whatsappContractFixMigration, /on conflict on constraint saas_automation_events_integration_id_event_id_key/i)
assert.match(whatsappEventPolicyMigration, /saas_automation_events_service_role/i)
assert.match(whatsappEventIndexMigration, /idx_saas_automation_events_tenant_id/i)
for (const required of ['saas_automation_shadow_runs', 'record_whatsapp_shadow_run', 'cleanup_whatsapp_shadow_runs', "mode = 'shadow'", "interval '30 days'"]) {
  assert.match(whatsappShadowMigration, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), `${required} missing`)
}
for (const required of ['consultar_reserva_whatsapp', 'simular_reserva_whatsapp', 'cancelar_reserva_whatsapp', 'reprogramar_reserva_whatsapp', 'search_path = public, pg_temp', 'service_role']) {
  assert.match(whatsappMutationMigration, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), `${required} missing`)
}
assert.equal(whatsappTemplate.active, false, 'WhatsApp template must remain inactive')
assert.ok(whatsappTemplate.nodes.length >= 20, 'WhatsApp template is unexpectedly incomplete')
assert.match(whatsappContractDocs, /inactiva|No activar/i)
assert.doesNotMatch(whatsappTemplateText, /PONE-ACA-TU-EVOLUTION-API-KEY|miwsp|barberia_id.?=.?.?1/i)
assert.match(whatsappTemplateText, /PILOT_MODE/)
assert.match(whatsappTemplateText, /simular_reserva_whatsapp/)
assert.match(whatsappTemplateText, /record_whatsapp_shadow_run/)

assert.doesNotMatch(tenantModule, /service_role/i, 'tenant module must not contain privileged credentials')
console.log('SaaS foundation checks passed')
