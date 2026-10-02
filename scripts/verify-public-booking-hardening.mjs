// Regresión: la RPC anónima crear_reserva_publica debe aplicar las mismas
// reglas que la página pública y no puede modificar clientes existentes.
// (Casos ejecutados contra Postgres local: grilla, horizonte, anticipación,
// reservas_publicas=false, nombre gigante, tope por teléfono, no-overwrite.)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const migrationsDir = path.join(root, 'supabase/migrations')
const file = '20261002092000_public_booking_hardening.sql'
const migration = fs.readFileSync(path.join(migrationsDir, file), 'utf8')

// Ninguna migración posterior puede volver a redefinir la RPC sin estas reglas.
const redefinitions = fs.readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .filter((name) => /create or replace function public\.crear_reserva_publica\(/i.test(fs.readFileSync(path.join(migrationsDir, name), 'utf8')))
assert.equal(redefinitions.at(-1), file, 'la última definición de crear_reserva_publica debe ser la endurecida')

assert.match(migration, /^begin;/m)
assert.match(migration, /^commit;/m)
assert.match(migration, /security definer\s+set search_path = public, pg_temp/)

// Regla autoritativa: el horario debe salir de la RPC de disponibilidad.
assert.match(migration, /from public\.horarios_disponibles_reserva_publica\(v_barberia\.slug, v_servicio\.id, p_fecha\) h[\s\S]{0,120}h\.barbero_id = p_barbero_id[\s\S]{0,40}h\.hora = p_hora/)
assert.match(migration, /coalesce\(v_barberia\.reservas_publicas, false\)/)

// Validación de entrada.
assert.match(migration, /char_length\(v_nombre\) > 120/)
assert.match(migration, /char_length\(v_email\) > 254/)
assert.match(migration, /v_telefono !~ '\^549\[1-9\]\[0-9\]\{9\}\$'/)

// Tope por teléfono, serializado.
assert.match(migration, /c_max_reservas_activas constant integer := 5/)
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('crear_reserva_publica:'/)
assert.match(migration, /t\.origen = 'reserva_web'/)

// Un cliente existente no se sobrescribe desde la web pública.
const upsert = migration.match(/on conflict \(barberia_id, telefono\) do update([\s\S]*?)returning id into v_cliente_id/)?.[1] || ''
assert.ok(upsert, 'debe existir el upsert de clientes')
assert.match(upsert, /nombre = case when nullif\(btrim\(public\.clientes\.nombre\), ''\) is null then excluded\.nombre else public\.clientes\.nombre end/)
assert.match(upsert, /email = coalesce\(public\.clientes\.email, excluded\.email\)/)
assert.doesNotMatch(upsert, /set nombre = excluded\.nombre/)
assert.doesNotMatch(upsert, /coalesce\(excluded\.email, public\.clientes\.email\)/)

// Contrato público intacto: firma, retorno y grants.
assert.match(migration, /returns table \(turno_id bigint, fecha date, hora time, duracion_min integer\)/)
assert.match(migration, /grant execute on function public\.crear_reserva_publica\(text, bigint, bigint, date, time, text, text, text\) to anon, authenticated/)
assert.match(migration, /exception when exclusion_violation then\s+raise exception 'Ese horario acaba de ocuparse\. Elegí otro\.' using errcode = '23P01'/)

// El mensaje de horario no ofrecido sigue mapeándose en la página pública
// (safeRpcError reconoce /disponible/ y el código 23P01).
assert.match(migration, /Ese horario no está disponible\. Elegí uno de los horarios ofrecidos\.' using errcode = '23P01'/)

console.log(JSON.stringify({
  suite: 'public-booking-hardening',
  authoritative_slots: 'horarios_disponibles_reserva_publica',
  customer_overwrite: 'BLOCKED',
  per_phone_cap: 5,
  result: 'PASS',
}))
