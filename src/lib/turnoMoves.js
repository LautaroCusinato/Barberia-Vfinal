export const TURNO_CAMBIO = 'TURNO_CAMBIO'
export const TURNO_SIN_PERMISO = 'TURNO_SIN_PERMISO'

const CAMPOS_MOVIMIENTO = 'id, fecha, hora, barbero_id, estado, updated_at'

function conflicto() {
  return Object.assign(new Error('El turno cambió. Actualizá la agenda antes de volver a moverlo.'), { code: TURNO_CAMBIO })
}

function sinPermiso() {
  return Object.assign(new Error('No hay permiso para mover este turno.'), { code: TURNO_SIN_PERMISO })
}

function mismaPosicion(a, b) {
  return a?.fecha === b?.fecha && String(a?.hora).slice(0, 5) === String(b?.hora).slice(0, 5)
}

// Fecha, hora y profesional: lo que un movimiento lee y escribe.
export function mismaPosicionTurno(a, b) {
  return Boolean(a && b && mismaPosicion(a, b) && String(a.barbero_id ?? '') === String(b.barbero_id ?? ''))
}

export function mismaVersionTurno(a, b) {
  return Boolean(mismaPosicionTurno(a, b) && a.updated_at === b.updated_at)
}

// timestamptz de PostgREST → microsegundos. null si no se puede interpretar.
function instanteVersion(valor) {
  const m = String(valor ?? '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/)
  if (!m) return null
  let zona = m[4] || 'Z'
  if (/^[+-]\d{2}$/.test(zona)) zona += ':00'
  else if (/^[+-]\d{4}$/.test(zona)) zona = `${zona.slice(0, 3)}:${zona.slice(3)}`
  const ms = Date.parse(`${m[1]}T${m[2]}${zona}`)
  if (Number.isNaN(ms)) return null
  return ms * 1000 + Number((m[3] || '').padEnd(6, '0').slice(0, 6))
}

function versionPosterior(a, b) {
  const ia = instanteVersion(a?.updated_at)
  const ib = instanteVersion(b?.updated_at)
  return ia != null && ib != null && ia > ib
}

// Aplica un movimiento guardado sobre la lista local. Se aplica si la fila
// local todavía muestra el origen o el destino y no es más nueva que lo
// guardado (Realtime puede haber traído otra edición mientras tanto).
export function confirmarMovimiento(turnos, id, origen, guardado) {
  const actual = turnos.find((t) => String(t.id) === String(id))
  if (!actual) return { ok: false, turnos }
  if (versionPosterior(actual, guardado)) {
    // Ya hay una versión posterior: sólo vale como éxito si conserva el destino.
    return { ok: mismaPosicionTurno(actual, guardado), turnos }
  }
  if (!mismaPosicionTurno(actual, origen) && !mismaPosicionTurno(actual, guardado)) return { ok: false, turnos }
  return {
    ok: true,
    turnos: turnos.map((t) => (String(t.id) === String(id) ? { ...t, ...guardado } : t)),
  }
}

async function actualizarPosicion(supabase, { barberiaId, turnoId, version, origen, destino }) {
  const { data, error } = await supabase.from('turnos')
    .update({ fecha: destino.fecha, hora: destino.hora })
    .eq('barberia_id', barberiaId)
    .eq('id', turnoId)
    .eq('updated_at', version)
    .eq('fecha', origen.fecha)
    .eq('hora', origen.hora)
    .select(CAMPOS_MOVIMIENTO)
    .maybeSingle()
  if (error) throw error
  return data
}

// UPDATE condicional: RLS y los triggers siguen autorizando y validando el
// horario. Cero filas no es un éxito (otro operador, borrado o sin acceso).
export async function persistirMovimiento(supabase, { barberiaId, turnoId, origen, destino }) {
  if (!barberiaId || !origen.updated_at) throw conflicto()
  let data = await actualizarPosicion(supabase, { barberiaId, turnoId, version: origen.updated_at, origen, destino })
  if (!data) {
    // Editar, cambiar el estado o cobrar no devuelven la versión nueva al
    // panel. Si la fila sigue en la misma posición, profesional y estado que
    // ve el operador, se reintenta una vez con su versión actual; si alguien
    // la movió, reasignó o cambió de estado, se rechaza.
    const { data: vigente, error } = await supabase.from('turnos')
      .select(CAMPOS_MOVIMIENTO)
      .eq('barberia_id', barberiaId)
      .eq('id', turnoId)
      .maybeSingle()
    if (error) throw error
    if (!vigente?.updated_at || !mismaPosicionTurno(vigente, origen)
      || (origen.estado != null && vigente.estado !== origen.estado)) throw conflicto()
    // Visible, sin cambios y aun así cero filas: RLS no permite escribir.
    if (vigente.updated_at === origen.updated_at) throw sinPermiso()
    data = await actualizarPosicion(supabase, { barberiaId, turnoId, version: vigente.updated_at, origen, destino })
    if (!data) throw conflicto()
  }
  if (String(data.id) !== String(turnoId) || !data.updated_at || !mismaPosicion(data, destino)) throw conflicto()
  return data
}

// Una cola por turno. La vista provisional pertenece al calendario; aquí
// sólo se confirman posiciones guardadas, sin rollbacks de snapshots viejos.
export function crearColaMovimientos({ leer, guardar, confirmar, onError, onObsoleto, onMovido }) {
  const estados = new Map()
  let cerrada = false
  const estadoDe = (id) => {
    const key = String(id)
    if (!estados.has(key)) estados.set(key, { revision: 0, pendientes: 0, cola: Promise.resolve() })
    return estados.get(key)
  }

  function mover(id, destino, deshacer = null) {
    if (cerrada) return Promise.resolve(false)
    const estado = estadoDe(id)
    if (deshacer && deshacer.revision !== estado.revision) {
      onObsoleto()
      return Promise.resolve(false)
    }
    const revision = ++estado.revision
    const posicion = { fecha: destino.fecha, hora: destino.hora }
    estado.pendientes += 1
    const operacion = estado.cola.then(async () => {
      if (cerrada) return false
      const actual = leer(id)
      // Deshacer sólo exige que nadie haya movido o reasignado el turno: un
      // cambio de estado o un cobro posterior no lo invalidan.
      if (!actual || (deshacer && !mismaPosicionTurno(actual, deshacer.esperado))) {
        onObsoleto()
        return false
      }
      if (mismaPosicion(actual, posicion)) return false
      const origen = { ...actual }
      const guardado = await guardar(id, origen, posicion)
      if (cerrada) return false
      // Realtime puede haber traído ya esta respuesta o una edición posterior.
      if (!confirmar(id, origen, guardado)) {
        onObsoleto()
        return false
      }
      if (!deshacer && revision === estado.revision) {
        onMovido({
          hora: posicion.hora,
          onUndo: () => mover(id, origen, { revision, esperado: guardado }),
        })
      }
      return true
    }).catch((error) => {
      if (!cerrada) onError(error)
      return false
    }).finally(() => { estado.pendientes -= 1 })
    estado.cola = operacion
    return operacion
  }

  return {
    mover,
    pendiente: (id) => Boolean(estados.get(String(id))?.pendientes),
    invalidar: (id) => { estadoDe(id).revision += 1 },
    cerrar: () => { cerrada = true },
  }
}
