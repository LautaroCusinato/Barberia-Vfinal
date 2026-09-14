import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const base = read('supabase/migrations/20260810171324_qa_base_schema.sql')
const legacy = read('supabase/migrations/20260806050000_harden_legacy_rls.sql')
const consolidated = read('supabase/migrations/20260806140000_consolidate_saas_rls.sql')
const automation = read('supabase/migrations/20260806150000_multitenant_whatsapp_contract.sql')
const shadow = read('supabase/migrations/20260806160000_whatsapp_shadow_runs.sql')
const connections = read('supabase/migrations/20260821090000_whatsapp_tenant_provisioning.sql')
const preflight = read('scripts/sql/whatsapp-production-preflight.sql')

const memberScoped = [
  'barberias',
  'barberia_members',
  'servicios',
  'barberos',
  'clientes',
  'turnos',
  'mensajes',
  'horarios_barbero',
  'barbero_servicios',
  'bloqueos_agenda',
]

for (const table of memberScoped) {
  assert.match(base, new RegExp('alter table public\\.' + table + ' enable row level security', 'i'))
}

for (const table of ['servicios', 'barberos', 'clientes', 'turnos', 'mensajes', 'horarios_barbero', 'bloqueos_agenda']) {
  assert.match(
    base,
    new RegExp('on public\\.' + table + '[\\s\\S]{0,220}is_barberia_member\\(barberia_id\\)', 'i'),
    table + ' must be scoped by tenant membership',
  )
}

assert.match(base, /on public\.barberias[\s\S]{0,220}is_barberia_member\(id\)/i)
assert.match(base, /on public\.barberia_members[\s\S]{0,260}is_barberia_member\(barberia_id\)/i)
assert.match(base, /on public\.barbero_servicios[\s\S]{0,300}is_barberia_member\(\(select barberia_id from public\.barberos where id = barbero_id\)\)/i)
assert.match(legacy, /on public\.mensajes[\s\S]{0,220}is_barberia_member\(barberia_id\)/i)

assert.match(consolidated, /create policy "saas_integraciones_select_member"[\s\S]{0,220}is_barberia_member\(barberia_id\)/i)
for (const operation of ['insert', 'update', 'delete']) {
  assert.match(consolidated, new RegExp("saas_integraciones_" + operation + "_owner[\\s\\S]{0,260}is_barberia_role\\(barberia_id, array\\['owner'\\]\\)", 'i'))
}

for (const [source, table] of [
  [automation, 'saas_automation_events'],
  [shadow, 'saas_automation_shadow_runs'],
  [connections, 'saas_whatsapp_connections'],
]) {
  assert.match(source, new RegExp('alter table public\\.' + table + ' enable row level security', 'i'))
  assert.match(source, new RegExp('revoke all on table public\\.' + table + ' from public, anon, authenticated', 'i'))
  assert.match(source, new RegExp('grant [^;]+ on table public\\.' + table + ' to service_role', 'i'))
}

for (const table of [
  ...memberScoped,
  'saas_integraciones',
  'saas_whatsapp_connections',
  'saas_automation_events',
  'saas_automation_shadow_runs',
]) {
  assert.match(preflight, new RegExp("'" + table + "'"))
}
assert.match(preflight, /begin transaction read only/i)
assert.match(preflight, /pg_policies|pg_policy/i)
assert.match(preflight, /relrowsecurity/i)

console.log(JSON.stringify({
  declared_repository_contract: 'PASS',
  member_scoped_tables: memberScoped.length,
  automation_tables: 'SERVICE_ROLE_ONLY',
  live_production_state: 'NOT_INFERRED_REQUIRES_AUTHORITATIVE_PREFLIGHT',
}, null, 2))
