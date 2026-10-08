// Reglas de la gestión de fechas bloqueadas de la Agenda (tarea 41).
//
// Se reutiliza la tabla bloqueos_agenda: una fila por fecha, con
// barbero_id null para todo el negocio. El panel sólo crea bloqueos de día
// completo (00:00–23:59, el mismo rango que ya usaba addBloqueo); los
// parciales existentes se muestran como tales y nunca se reescriben.
//
// Esto sólo decide qué mostrar y qué filas enviar. La autorización (dueño o
// administrador del negocio) y el rechazo de turnos en horarios bloqueados
// ocurren en PostgreSQL: RLS de bloqueos_agenda y el trigger
// validate_turno_business_rules, que cubre panel, reserva web y WhatsApp.

export const BLOQUEO_INICIO_DIA = '00:00'
export const BLOQUEO_FIN_DIA = '23:59'
export const MAX_FECHAS_POR_BLOQUEO = 62

// Valores permitidos por el CHECK de la tabla. 'bloqueo' cubre "Otro motivo".
export const TIPOS_BLOQUEO = [
  { value: 'cierre', label: 'Cierre del negocio' },
  { value: 'feriado', label: 'Feriado' },
  { value: 'vacaciones', label: 'Vacaciones' },
  { value: 'bloqueo', label: 'Otro motivo' },
]
const TIPOS_VALIDOS = new Set(TIPOS_BLOQUEO.map((t) => t.value))

// Estados que ya no ocupan el horario: no se avisan como afectados.
const ESTADOS_LIBERADOS = new Set(['cancelado', 'no_asistio'])

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/

function minutos(value, fallback) {
  const [h, m] = String(value || fallback).slice(0, 5).split(':').map(Number)
  return (Number(h) || 0) * 60 + (Number(m) || 0)
}

export function esBloqueoDiaCompleto(bloqueo) {
  if (!bloqueo) return false
  return minutos(bloqueo.start_time, BLOQUEO_INICIO_DIA) <= 0
    && minutos(bloqueo.end_time, BLOQUEO_FIN_DIA) >= 23 * 60 + 59
}

export function esFechaValida(fecha) {
  if (!FECHA_RE.test(String(fecha || ''))) return false
  const [y, m, d] = fecha.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

// Fechas 'yyyy-MM-dd' entre desde y hasta (inclusive), calculadas en UTC
// para que un cambio de horario local no salte ni repita días.
export function fechasEnRango(desde, hasta, max = MAX_FECHAS_POR_BLOQUEO) {
  if (!esFechaValida(desde)) return { fechas: [], error: 'Elegí una fecha válida.' }
  const fin = hasta ? hasta : desde
  if (!esFechaValida(fin)) return { fechas: [], error: 'La fecha final no es válida.' }
  if (fin < desde) return { fechas: [], error: 'La fecha final no puede ser anterior a la inicial.' }
  const [y, m, d] = desde.split('-').map(Number)
  const cursor = new Date(Date.UTC(y, m - 1, d))
  const fechas = []
  while (true) {
    const key = cursor.toISOString().slice(0, 10)
    if (key > fin) break
    fechas.push(key)
    if (fechas.length > max) return { fechas: [], error: `Podés bloquear hasta ${max} días por vez.` }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return { fechas, error: '' }
}

const mismoBarbero = (a, b) => (a == null && b == null) || (a != null && b != null && String(a) === String(b))

// Un día ya está cubierto si existe un bloqueo de día completo del mismo
// alcance o, para un profesional, uno de todo el negocio.
export function fechaYaBloqueada(bloqueos, fecha, barberoId) {
  return (bloqueos || []).some((b) => b.fecha === fecha
    && esBloqueoDiaCompleto(b)
    && (b.barbero_id == null || mismoBarbero(b.barbero_id, barberoId)))
}

export function planificarBloqueo({ desde, hasta, barberoId = null, bloqueos = [], todayKey }) {
  const { fechas, error } = fechasEnRango(desde, hasta)
  if (error) return { error, nuevas: [], yaBloqueadas: [] }
  if (todayKey && fechas[0] < todayKey) return { error: 'No se pueden bloquear fechas que ya pasaron.', nuevas: [], yaBloqueadas: [] }
  const nuevas = []
  const yaBloqueadas = []
  for (const fecha of fechas) (fechaYaBloqueada(bloqueos, fecha, barberoId) ? yaBloqueadas : nuevas).push(fecha)
  return { error: '', nuevas, yaBloqueadas }
}

// Turnos que siguen ocupando un horario en las fechas a bloquear. Se
// muestran para confirmar; nunca se cancelan ni se mueven.
export function turnosAfectados(turnos, fechas, barberoId = null) {
  const set = new Set(fechas)
  return (turnos || [])
    .filter((t) => set.has(t.fecha)
      && !ESTADOS_LIBERADOS.has(t.estado)
      && (barberoId == null || String(t.barbero_id) === String(barberoId)))
    .sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`))
}

export function normalizarMotivo(tipo, detalle) {
  const tipoValido = TIPOS_VALIDOS.has(tipo) ? tipo : 'bloqueo'
  const texto = String(detalle || '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const label = TIPOS_BLOQUEO.find((t) => t.value === tipoValido).label
  return { tipo: tipoValido, motivo: texto || label }
}

export function filasBloqueo({ fechas, barberoId = null, tipo, detalle, barberiaId }) {
  const { tipo: tipoFinal, motivo } = normalizarMotivo(tipo, detalle)
  return fechas.map((fecha) => ({
    barberia_id: barberiaId,
    barbero_id: barberoId == null || barberoId === '' ? null : barberoId,
    fecha,
    motivo,
    tipo: tipoFinal,
    start_time: BLOQUEO_INICIO_DIA,
    end_time: BLOQUEO_FIN_DIA,
  }))
}

// Bloqueos vigentes (hoy en adelante), ordenados por fecha, alcance y hora.
export function bloqueosVigentes(bloqueos, todayKey) {
  return (bloqueos || [])
    .filter((b) => !todayKey || b.fecha >= todayKey)
    .sort((a, b) => a.fecha.localeCompare(b.fecha)
      || (a.barbero_id == null ? -1 : 0) - (b.barbero_id == null ? -1 : 0)
      || String(a.start_time || '').localeCompare(String(b.start_time || '')))
}

export function rangoBloqueo(bloqueo) {
  if (esBloqueoDiaCompleto(bloqueo)) return 'Todo el día'
  return `${String(bloqueo.start_time || '').slice(0, 5)}–${String(bloqueo.end_time || '').slice(0, 5)}`
}

// Datos reenviables al deshacer un desbloqueo: la fila vuelve con otro id.
export function copiaParaRestaurar(bloqueo) {
  const { barberia_id, barbero_id, fecha, motivo, tipo, start_time, end_time } = bloqueo
  return { barberia_id, barbero_id: barbero_id ?? null, fecha, motivo, tipo: TIPOS_VALIDOS.has(tipo) ? tipo : 'bloqueo', start_time, end_time }
}

export function esErrorPermiso(error) {
  return Boolean(error) && (error.code === '42501' || /row-level security|permission denied/i.test(String(error.message || '')))
}

// Acceso a datos. Reciben el cliente de Supabase para poder probarse sin red.
// Un único INSERT con todas las fechas: PostgREST lo ejecuta en una sola
// sentencia, así que se guardan todas o ninguna.
export async function insertarBloqueos(client, filas) {
  try {
    const { data, error } = await client.from('bloqueos_agenda').insert(filas).select()
    if (error) return { ok: false, motivo: esErrorPermiso(error) ? 'permiso' : 'error', error }
    return { ok: true, data: data ?? [] }
  } catch (error) {
    return { ok: false, motivo: 'error', error }
  }
}

// Con RLS, un DELETE no autorizado no falla: afecta 0 filas. Por eso se pide
// la fila borrada y, si no vuelve, se distingue "ya no existía" de "sin permiso".
export async function eliminarBloqueo(client, id, barberiaId) {
  try {
    const { data, error } = await client.from('bloqueos_agenda').delete().eq('id', id).eq('barberia_id', barberiaId).select('id')
    if (error) return { ok: false, motivo: esErrorPermiso(error) ? 'permiso' : 'error', error }
    if (data?.length) return { ok: true }
    const { data: sigue, error: lecturaError } = await client.from('bloqueos_agenda').select('id').eq('id', id).maybeSingle()
    if (lecturaError) return { ok: false, motivo: 'error', error: lecturaError }
    if (sigue) return { ok: false, motivo: 'permiso' }
    return { ok: true, yaNoExistia: true }
  } catch (error) {
    return { ok: false, motivo: 'error', error }
  }
}

// Roles que la política bloqueos_write_owner deja escribir. Sólo adapta la
// interfaz: la base vuelve a autorizar cada alta y baja.
export const ROLES_GESTION_BLOQUEOS = ['owner', 'admin']

export function puedeGestionarBloqueos(rol, { conBackend = true } = {}) {
  if (!conBackend) return true
  return ROLES_GESTION_BLOQUEOS.includes(String(rol || ''))
}

// Turnos activos en esas fechas según el servidor. La lista del panel puede
// estar incompleta (PostgREST corta en 1000 filas y llega por Realtime con
// demora), así que la advertencia y el Deshacer consultan la base.
export const MAX_TURNOS_CONSULTA = 500

export async function consultarTurnosActivos(client, { barberiaId, fechas, barberoId = null }) {
  if (!fechas?.length) return { ok: true, turnos: [] }
  try {
    let query = client
      .from('turnos')
      .select('id,fecha,hora,paciente,barbero_id,estado')
      .eq('barberia_id', barberiaId)
      .in('fecha', fechas)
      .not('estado', 'in', '(cancelado,no_asistio)')
    if (barberoId != null && barberoId !== '') query = query.eq('barbero_id', barberoId)
    const { data, error } = await query.order('fecha').order('hora').limit(MAX_TURNOS_CONSULTA)
    if (error) return { ok: false, error }
    return { ok: true, turnos: turnosAfectados(data ?? [], fechas, barberoId) }
  } catch (error) {
    return { ok: false, error }
  }
}

// Turnos que aparecieron entre dos lecturas (p. ej. reservados mientras una
// fecha estuvo desbloqueada).
export function turnosNuevos(antes, despues) {
  const ids = new Set((antes || []).map((t) => String(t.id)))
  return (despues || []).filter((t) => !ids.has(String(t.id)))
}
