export const TURNO_CAMBIO = 'TURNO_CAMBIO'

function conflicto() {
  return Object.assign(new Error('El turno cambió. Actualizá la agenda antes de volver a moverlo.'), { code: TURNO_CAMBIO })
}

function mismaPosicion(a, b) {
  return a?.fecha === b?.fecha && String(a?.hora).slice(0, 5) === String(b?.hora).slice(0, 5)
}

export function mismaVersionTurno(a, b) {
  return Boolean(a && b && mismaPosicion(a, b)
    && String(a.barbero_id) === String(b.barbero_id)
    && a.updated_at === b.updated_at)
}

// UPDATE condicional: RLS y los triggers siguen autorizando y validando el
// horario. Cero filas no es un éxito (otro operador, borrado o sin acceso).
export async function persistirMovimiento(supabase, { barberiaId, turnoId, origen, destino }) {
  if (!barberiaId || !origen.updated_at) throw conflicto()
  const { data, error } = await supabase.from('turnos')
    .update({ fecha: destino.fecha, hora: destino.hora })
    .eq('barberia_id', barberiaId)
    .eq('id', turnoId)
    .eq('updated_at', origen.updated_at)
    .eq('fecha', origen.fecha)
    .eq('hora', origen.hora)
    .select('id, fecha, hora, barbero_id, updated_at')
    .maybeSingle()
  if (error) throw error
  if (!data || String(data.id) !== String(turnoId) || !data.updated_at || !mismaPosicion(data, destino)) throw conflicto()
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
      if (!actual || (deshacer && !mismaVersionTurno(actual, deshacer.esperado))) {
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
