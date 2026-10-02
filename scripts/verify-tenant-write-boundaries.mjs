// Regresión: escrituras multi-tenant que no deben volver a abrirse.
// La prueba funcional (dos tenants, roles authenticated) se ejecutó contra un
// Postgres local con todas las migraciones; acá se fija el contrato declarado.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migrationsDir = path.join(root, 'supabase/migrations')
const migration = read('supabase/migrations/20261002091000_tenant_write_boundaries.sql')
const later = fs.readdirSync(migrationsDir).filter((name) => name > '20261002091000_tenant_write_boundaries.sql').map((name) => read(`supabase/migrations/${name}`)).join('\n')

assert.match(migration, /^begin;/m)
assert.match(migration, /^commit;/m)

// 1. Alta de tenants sólo por RPC/backend.
assert.match(migration, /drop policy if exists "barberias_insert_authenticated" on public\.barberias/)
assert.match(migration, /revoke insert on table public\.barberias from anon, authenticated/)

// 2. Membresías sin INSERT directo; UPDATE sólo de `role`.
assert.match(migration, /drop policy if exists "members_insert_owner" on public\.barberia_members/)
assert.match(migration, /revoke insert on table public\.barberia_members from anon, authenticated/)
assert.match(migration, /revoke update on table public\.barberia_members from anon, authenticated/)
assert.match(migration, /grant update \(role\) on table public\.barberia_members to authenticated/)

// 3. Integraciones: escritura sólo service_role.
for (const policy of ['saas_integraciones_insert_owner', 'saas_integraciones_update_owner', 'saas_integraciones_delete_owner', 'saas_integraciones_write_owner']) {
  assert.match(migration, new RegExp(`drop policy if exists "${policy}" on public\\.saas_integraciones`))
}
assert.match(migration, /revoke insert, update, delete, truncate on table public\.saas_integraciones from anon, authenticated/)

// 4. Coherencia de tenant en referencias.
const triggers = [
  ['turnos', 'enforce_cliente_same_tenant', 'cliente_id, barberia_id'],
  ['mensajes', 'enforce_cliente_same_tenant', 'cliente_id, barberia_id'],
  ['notas', 'enforce_cliente_same_tenant', 'cliente_id, barberia_id'],
  ['pagos', 'enforce_cliente_same_tenant', 'cliente_id, barberia_id'],
  ['pagos', 'enforce_pago_turno_same_tenant', 'turno_id, barberia_id'],
  ['horarios_barbero', 'enforce_barbero_same_tenant', 'barbero_id, barberia_id'],
  ['bloqueos_agenda', 'enforce_barbero_same_tenant', 'barbero_id, barberia_id'],
  ['barbero_servicios', 'enforce_barbero_servicio_same_tenant', 'barbero_id, servicio_id'],
]
for (const [table, fn, columns] of triggers) {
  assert.match(migration, new RegExp(`before insert or update of ${columns} on public\\.${table}\\s+for each row execute function public\\.${fn}\\(\\)`), `${table} debe validar ${fn}`)
}
for (const fn of ['enforce_cliente_same_tenant', 'enforce_pago_turno_same_tenant', 'enforce_barbero_same_tenant', 'enforce_barbero_servicio_same_tenant']) {
  assert.match(migration, new RegExp(`create or replace function public\\.${fn}\\(\\)[\\s\\S]{0,120}security definer[\\s\\S]{0,60}set search_path = public, pg_temp`))
  assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\(\\) from public, anon, authenticated`))
}
assert.match(migration, /c\.id = new\.cliente_id and c\.barberia_id = new\.barberia_id/)
assert.match(migration, /join public\.servicios s on s\.barberia_id = b\.barberia_id/)

// Ninguna migración posterior puede reabrir estas escrituras.
assert.doesNotMatch(later, /create policy "barberias_insert_authenticated"/)
assert.doesNotMatch(later, /create policy "members_insert_owner"/)
assert.doesNotMatch(later, /create policy "saas_integraciones_(insert|update|delete|write)_owner"/)
assert.doesNotMatch(later, /grant (all|insert|update)[^;]*on (table )?public\.(barberias|saas_integraciones)[^;]*to authenticated/)

// El panel no escribe estas tablas directamente (fuera de role/delete de miembros).
const srcFiles = []
const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(jsx?|tsx?)$/.test(entry.name)) srcFiles.push(full) } }
walk(path.join(root, 'src'))
for (const file of srcFiles) {
  const source = fs.readFileSync(file, 'utf8')
  assert.doesNotMatch(source, /from\(['"]barberias['"]\)\s*\.(insert|upsert)/, `${file} no debe insertar barberias directamente`)
  assert.doesNotMatch(source, /from\(['"]saas_integraciones['"]\)\s*\.(insert|upsert|update|delete)/, `${file} no debe escribir saas_integraciones`)
  assert.doesNotMatch(source, /from\(['"]barberia_members['"]\)\s*\.(insert|upsert)/, `${file} no debe insertar membresías`)
}

console.log(JSON.stringify({
  suite: 'tenant-write-boundaries',
  tenant_insert: 'RPC_ONLY',
  memberships: 'INVITATION_ONLY_ROLE_UPDATE',
  integrations: 'SERVICE_ROLE_ONLY',
  cross_tenant_references: triggers.length,
  result: 'PASS',
}))
