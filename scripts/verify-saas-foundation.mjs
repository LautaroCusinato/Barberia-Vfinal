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

assert.doesNotMatch(tenantModule, /service_role/i, 'tenant module must not contain privileged credentials')
console.log('SaaS foundation checks passed')
