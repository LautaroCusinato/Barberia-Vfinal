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

for (const exportName of ['DEFAULT_TENANT_ID', 'DEFAULT_VERTICAL', 'getRuntimeTenant', 'tenantStorageKey']) {
  assert.match(tenantModule, new RegExp(`(?:export const|export function)\\s+${exportName}`), `${exportName} missing`)
}

for (const table of ['saas_planes', 'saas_suscripciones', 'platform_members', 'crm_negocios', 'crm_leads', 'crm_interacciones', 'saas_integraciones']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`), `${table} missing`)
}

for (const required of ['trial_ends_at', 'estado_cuenta', 'is_platform_member', '14 days', 'row level security']) {
  assert.match(migration, new RegExp(required.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&'), 'i'), `${required} missing`)
}

assert.doesNotMatch(tenantModule, /service_role/i, 'tenant module must not contain privileged credentials')
console.log('SaaS foundation checks passed')
