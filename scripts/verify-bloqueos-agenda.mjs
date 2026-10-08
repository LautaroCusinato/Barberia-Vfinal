// Contrato (tarea 41): la cabecera de Agenda ofrece «Bloquear» en lugar de
// «Nuevo turno», los accesos Agendar del calendario siguen, y la gestión
// reutiliza bloqueos_agenda sin tabla ni RPC nuevas. Los canales (panel,
// reserva web y WhatsApp) siguen validando bloqueos en el servidor.
// Verificación offline de texto; el comportamiento SQL se prueba aparte con
// scripts/sql/bloqueos-agenda/run.sh contra un Postgres local.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const read = (file) => fs.readFileSync(file, 'utf8')
const app = read('src/App.jsx')
const calendar = read('src/components/Calendar.jsx')
const modal = read('src/components/BloqueosModal.jsx')
const lib = read('src/lib/bloqueosAgenda.js')

// 1. Cabecera: Exportar + Bloquear; ya no hay «Nuevo turno» allí.
const headerStart = app.indexOf('agenda-page-header')
// Hasta el calendario de esa vista (onMoverTurno sólo lo recibe Calendar).
const header = app.slice(headerStart, app.indexOf('onMoverTurno', headerStart))
assert.ok(header.includes('agenda-export-btn'), 'Exportar sigue en la cabecera')
assert.match(header, /className="btn agenda-block-btn"[^>]*onClick=\{\(\) => setBloqueosOpen\(true\)\}/)
assert.match(header, />\s*Bloquear\s*</)
assert.doesNotMatch(header, /Nuevo turno/, 'la cabecera de Agenda ya no ofrece Nuevo turno')
assert.match(app, /onNewTurno=\{openNewTurnoConFecha\}/, 'el calendario conserva Agendar')
assert.match(calendar, /Agendar/, 'el detalle del día conserva Agendar')

// 2. Color rojizo sólo con tokens del diseño.
const css = read('src/components/bloqueos.css')
const btn = css.slice(css.indexOf('.agenda-block-btn'), css.indexOf('.bloqueos-modal'))
assert.match(btn, /var\(--rose-soft\)/)
assert.match(btn, /var\(--rose-text\)/)
assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'sin colores literales')

// 3. Mismo modelo de datos: bloqueos_agenda, tipos del CHECK y día completo.
assert.match(lib, /from\('bloqueos_agenda'\)\.insert\(filas\)\.select\(\)/)
assert.match(lib, /delete\(\)\.eq\('id', id\)\.eq\('barberia_id', barberiaId\)\.select\('id'\)/, 'desbloqueo con fila devuelta (RLS → 0 filas)')
for (const tipo of ['cierre', 'feriado', 'vacaciones', 'bloqueo']) assert.match(lib, new RegExp(`value: '${tipo}'`))
assert.match(lib, /BLOQUEO_INICIO_DIA = '00:00'/)
assert.match(lib, /BLOQUEO_FIN_DIA = '23:59'/)
assert.doesNotMatch(lib + app, /\.rpc\(['"][a-z_]*bloque/i, 'sin RPC nueva de bloqueos')
const base = read('supabase/migrations/20260810171324_qa_base_schema.sql')
assert.match(base, /tipo text not null default 'cierre' check \(tipo in \('cierre', 'feriado', 'vacaciones', 'bloqueo'\)\)/)
const nuevas = fs.readdirSync('supabase/migrations').filter((f) => /bloqueo/i.test(f))
assert.deepEqual(nuevas, [], 'la tarea 41 no agrega migraciones')

// 4. El desbloqueo de Agenda confirma en servidor antes de ocultar la fila.
const desbloquear = app.slice(app.indexOf('const desbloquearFecha'), app.indexOf('const turnosHoy'))
assert.ok(desbloquear.indexOf('eliminarBloqueo(supabase') < desbloquear.indexOf('setBloqueos((prev) => prev.filter'), 'borra en servidor y después actualiza la vista')
assert.doesNotMatch(desbloquear, /eliminarConDeshacer/, 'no usa el borrado diferido')
assert.match(desbloquear, /onUndo: \(\) => \{ restaurarBloqueo\(bloqueo, turnosAntes\) \}/, 'Deshacer vuelve a crear el bloqueo')
// Revisión: la foto de turnos se toma antes de borrar, y Deshacer avisa de
// reservas que entraron mientras la fecha estuvo libre.
assert.ok(desbloquear.indexOf('leerTurnosDelBloqueo(bloqueo)') < desbloquear.indexOf('eliminarBloqueo(supabase'), 'foto de turnos antes de desbloquear')
assert.match(app, /turnosNuevos\(turnosAntes, despues\.turnos\)/, 'Deshacer compara con los turnos previos')
// Revisión: Bloquear sólo para owner/admin (la base vuelve a autorizar) y la
// advertencia de turnos consulta la base, no la lista cargada en el panel.
assert.match(app, /puedeGestionarBloqueos\(rol,/, 'el rol decide si se muestra Bloquear')
assert.match(app, /\{puedeBloquear && \(/, 'Bloquear oculto sin permiso')
assert.match(app, /consultarTurnosActivos\(supabase/, 'turnos afectados desde la base')
assert.match(read('src/main.jsx'), /rol=\{rolNegocio\}/, 'main pasa el rol del negocio')

// 5. El modal no anuncia éxito antes de guardar y evita doble envío.
assert.match(modal, /if \(guardandoRef\.current\) return/)
assert.match(modal, /const resultado = await onBloquear\([\s\S]*?if \(resultado\?\.ok\)/)
assert.match(modal, /turnosAfectados\(turnos, plan\.nuevas, barberoId\)/)
// Revisión: la librería lee turnos (advertencia y Deshacer) pero nunca escribe.
assert.doesNotMatch(modal, /from\('turnos'\)/, 'el modal no accede a turnos')
assert.match(lib, /from\('turnos'\)\s*\.select\(/, 'turnos sólo se leen')
assert.doesNotMatch(lib, /from\('turnos'\)\s*\.(insert|update|delete|upsert)\(/, 'no escribe turnos')
assert.doesNotMatch(modal + lib, /\.update\(|cancelado'\s*\}/, 'no toca turnos')

// 6. Validación en servidor para todos los canales (repo, no estado remoto).
const trigger = read('supabase/migrations/20260801030000_turno_business_rules.sql')
assert.match(trigger, /before insert or update of barberia_id, barbero_id, servicio_id, fecha, hora, duracion_min, estado\s+on public\.turnos/)
assert.match(trigger, /from public\.bloqueos_agenda ba[\s\S]*?raise exception 'El horario está bloqueado para ese día\.'/)
const publica = read('supabase/migrations/20261002092000_public_booking_hardening.sql')
assert.match(publica, /from public\.bloqueos_agenda ba[\s\S]*?Ese horario fue bloqueado/)
assert.match(publica, /horarios_disponibles_reserva_publica\(v_barberia\.slug, v_servicio\.id, p_fecha\)/, 'la web revalida la oferta al confirmar')
const whatsapp = read('supabase/migrations/20260806150000_multitenant_whatsapp_contract.sql')
assert.match(whatsapp.slice(whatsapp.indexOf('create or replace function public.crear_reserva_whatsapp')), /from public\.bloqueos_agenda ba[\s\S]*?Ese horario fue bloqueado/)
const roles = read('supabase/migrations/20261003090000_invited_roles_agenda_access.sql')
assert.match(roles, /create policy "bloqueos_write_owner" on public\.bloqueos_agenda for all\s+using \(public\.is_barberia_role\(barberia_id, array\['owner', 'admin'\]\)/)

// 7. Prueba SQL local presente y con finales LF fijados.
const run = path.join('scripts', 'sql', 'bloqueos-agenda', 'run.sh')
assert.ok(fs.existsSync(run))
assert.match(read('.gitattributes'), /^scripts\/sql\/bloqueos-agenda\/run\.sh text eol=lf$/m)
assert.doesNotMatch(read(run), /\r\n/, 'run.sh debe tener LF')

console.log('verify-bloqueos-agenda: OK')
