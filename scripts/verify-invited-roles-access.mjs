// Contrato: los roles invitables "admin" y "empleado" pueden operar la agenda.
// admin = owner en agenda/clientes/notas/pagos/horarios; empleado = barbero.
// Billing, config, barberias, membresías e integraciones no se amplían.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const dir = 'supabase/migrations'
const file = '20261003090000_invited_roles_agenda_access.sql'
const sql = fs.readFileSync(path.join(dir, file), 'utf8')

// Debe ser la última migración que redefine estas políticas.
const later = fs.readdirSync(dir).filter((name) => name.endsWith('.sql') && name > file)
const policyNames = [
  'clientes_write_staff', 'turnos_write_staff', 'mensajes_write_staff', 'conversaciones_write_staff',
  'pagos_write_staff', 'notas_write_staff', 'servicios_write_owner', 'barberos_write_owner',
  'horarios_write_owner', 'bloqueos_write_owner', 'barbero_servicios_write_owner',
]
for (const name of later) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8')
  for (const policy of policyNames) {
    assert.ok(!new RegExp(`create policy "${policy}"`).test(text), `${name} redefine ${policy}; actualizar este contrato`)
  }
}

assert.match(sql, /^[\s\S]*?\nbegin;/, 'debe abrir transacción')
assert.match(sql, /\ncommit;\s*$/, 'debe cerrar transacción')

const policyBlock = (policy) => {
  const match = sql.match(new RegExp(`drop policy if exists "${policy}" on public\\.(\\w+);\\s*create policy "${policy}" on public\\.(\\w+) for all([^\\n]*)\\n([\\s\\S]*?);\\n`))
  assert.ok(match, `falta drop/create idempotente de ${policy}`)
  assert.equal(match[1], match[2], `${policy}: drop y create sobre la misma tabla`)
  return { table: match[1], header: match[3], body: match[4] }
}
const rolesIn = (body) => [...body.matchAll(/array\[([^\]]+)\]/g)].map((m) => m[1].split(',').map((r) => r.trim().replace(/'/g, '')).sort())

const staff = { clientes_write_staff: 'clientes', turnos_write_staff: 'turnos', mensajes_write_staff: 'mensajes', conversaciones_write_staff: 'conversaciones', pagos_write_staff: 'pagos', notas_write_staff: 'notas' }
const staffRoles = ['admin', 'barbero', 'empleado', 'owner', 'recepcionista']
for (const [policy, table] of Object.entries(staff)) {
  const block = policyBlock(policy)
  assert.equal(block.table, table)
  const roles = rolesIn(block.body)
  assert.equal(roles.length, 2, `${policy}: using y with check`)
  for (const list of roles) assert.deepEqual(list, staffRoles, `${policy}: roles de staff`)
  assert.equal((block.body.match(/barberia_operational_access\(barberia_id\)/g) || []).length, 2, `${policy}: conserva el chequeo de acceso operativo`)
}
// Estructura previa conservada (roles de Postgres).
for (const policy of ['mensajes_write_staff', 'conversaciones_write_staff', 'pagos_write_staff']) {
  assert.match(policyBlock(policy).header, /to authenticated/, `${policy}: sigue limitada a authenticated`)
}
assert.match(policyBlock('conversaciones_write_staff').body, /barberia_id is not null/)

const ownerOps = { servicios_write_owner: 'servicios', barberos_write_owner: 'barberos', horarios_write_owner: 'horarios_barbero', bloqueos_write_owner: 'bloqueos_agenda', barbero_servicios_write_owner: 'barbero_servicios' }
for (const [policy, table] of Object.entries(ownerOps)) {
  const block = policyBlock(policy)
  assert.equal(block.table, table)
  const roles = rolesIn(block.body)
  assert.equal(roles.length, 2, `${policy}: using y with check`)
  for (const list of roles) assert.deepEqual(list, ['admin', 'owner'], `${policy}: sólo owner y admin`)
  assert.equal((block.body.match(/barberia_operational_access\(/g) || []).length, 2, `${policy}: conserva el chequeo de acceso operativo`)
}

// Guardas negativas: no se amplían superficies sensibles.
for (const forbidden of [/on public\.config\b/, /on public\.barberias\b/, /on public\.barberia_members\b/, /on public\.saas_\w+/, /\bgrant\b/i, /security definer/i]) {
  assert.doesNotMatch(sql, forbidden, `la migración no debe tocar ${forbidden}`)
}
// readonly nunca escribe.
assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /'readonly'/)

console.log(JSON.stringify({
  suite: 'invited-roles-access',
  staff_policies: Object.keys(staff).length,
  admin_owner_policies: Object.keys(ownerOps).length,
  untouched: ['config', 'barberias', 'barberia_members', 'saas_*'],
  result: 'PASS',
}))
