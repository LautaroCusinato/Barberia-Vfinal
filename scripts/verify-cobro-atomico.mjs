// Contrato (tarea 05): el cobro de un turno atendido es una sola operación
// del servidor, idempotente, que respeta RLS; el panel no vuelve a escribir
// estado y pago por separado. Verificación offline de texto; el
// comportamiento SQL se prueba aparte contra un Postgres local.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const dir = 'supabase/migrations'
const file = '20261004090000_registrar_cobro_turno.sql'
const sql = fs.readFileSync(path.join(dir, file), 'utf8')
const code = sql.replace(/--.*$/gm, '')

assert.match(sql, /\nbegin;/, 'debe abrir transacción')
assert.match(sql, /\ncommit;\s*$/, 'debe cerrar transacción')

// Aditiva: no borra ni reescribe pagos históricos.
assert.match(code, /alter table public\.pagos add column if not exists idempotency_key uuid;/)
assert.match(code, /create unique index if not exists uq_pagos_idempotency_key\s+on public\.pagos \(barberia_id, idempotency_key\)\s+where idempotency_key is not null;/)
for (const forbidden of [/delete\s+from\s+public\.pagos/i, /update\s+public\.pagos/i, /drop\s+(table|column)/i, /truncate/i, /unique\s*\(\s*turno_id\s*\)/i]) {
  assert.doesNotMatch(code, forbidden, `la migración no debe contener ${forbidden}`)
}

// Firma, privilegios y frontera de seguridad.
assert.match(code, /create or replace function public\.registrar_cobro_turno\(\s*p_turno_id bigint,\s*p_monto numeric,\s*p_metodo text,\s*p_idempotency_key uuid\s*\)/)
assert.match(code, /security invoker/, 'debe ejecutarse con los permisos del usuario (RLS)')
assert.doesNotMatch(code, /security definer/i)
assert.match(code, /set search_path = public, pg_temp/)
assert.match(code, /revoke all on function public\.registrar_cobro_turno\(bigint, numeric, text, uuid\) from public, anon;/)
assert.match(code, /grant execute on function public\.registrar_cobro_turno\(bigint, numeric, text, uuid\) to authenticated;/)
assert.doesNotMatch(code, /to (anon|service_role)\b/)

// Validaciones en servidor.
for (const hint of ['sin_sesion', 'clave_invalida', 'monto_invalido', 'metodo_invalido', 'turno_no_encontrado', 'sin_permiso', 'sin_acceso_operativo', 'clave_reutilizada', 'turno_ya_atendido']) {
  assert.match(code, new RegExp(`hint = '${hint}'`), `falta el rechazo ${hint}`)
}
assert.match(code, /auth\.uid\(\) is null/)
assert.match(code, /is_barberia_role\(v_turno\.barberia_id, array\['owner', 'admin', 'recepcionista', 'barbero', 'empleado'\]\)/, 'mismos roles que pagos_write_staff')
assert.match(code, /barberia_operational_access\(v_turno\.barberia_id\)/)
assert.match(code, /from public\.turnos where id = p_turno_id for update/, 'debe bloquear el turno')

// Orden: lock → idempotencia → ya atendido → update + insert.
const idx = (re) => { const m = code.search(re); assert.ok(m >= 0, `falta ${re}`); return m }
const lock = idx(/for update/)
const replay = idx(/idempotency_key = p_idempotency_key/)
const yaAtendido = idx(/v_turno\.estado = 'atendido'/)
const update = idx(/update public\.turnos set estado = 'atendido'/)
const insert = idx(/insert into public\.pagos/)
assert.ok(lock < replay && replay < yaAtendido && yaAtendido < update && update < insert, 'orden de pasos de la RPC')

// Ninguna migración posterior redefine la RPC sin actualizar este contrato.
for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.sql') && n > file)) {
  assert.doesNotMatch(fs.readFileSync(path.join(dir, name), 'utf8'), /function public\.registrar_cobro_turno/, `${name} redefine registrar_cobro_turno`)
}

// Panel: un solo camino al servidor y error visible en el modal.
const app = fs.readFileSync('src/App.jsx', 'utf8')
const confirmar = app.slice(app.indexOf('const confirmarCobro'), app.indexOf('const deleteTurno'))
assert.ok(confirmar.length > 0, 'falta confirmarCobro')
assert.match(confirmar, /registrarCobroTurno\(supabase, \{ turnoId: turno\.id, monto, metodo, clave: cobroClaveRef\.current \}\)/)
assert.doesNotMatch(confirmar, /from\('pagos'\)|updateTurnoEstado/, 'el cobro no debe escribir estado y pago por separado')
assert.match(confirmar, /throw error/, 'el error debe llegar al modal')
assert.match(confirmar, /cobroEnCursoRef\.current/)
assert.match(app, /cobroClaveRef\.current = nuevaClaveCobro\(\)\s*setCobroTurno\(turno\)/, 'una clave por apertura del modal')
assert.doesNotMatch(app, /from\('pagos'\)\.insert/, 'no quedan INSERT directos de pagos en el panel')

const modal = fs.readFileSync('src/components/CobroModal.jsx', 'utf8')
assert.match(modal, /error\?\.name === 'CobroError'/)

console.log(JSON.stringify({ suite: 'cobro-atomico', migration: file, rpc: 'registrar_cobro_turno', result: 'PASS' }))
