const TABLAS = new Set(['turnos', 'notas', 'bloqueos_agenda'])
const keyOf = (tabla, id) => `${tabla}:${String(id)}`

export async function persistirBorrado(supabase, { tabla, barberiaId, fila }) {
  if (!TABLAS.has(tabla) || !barberiaId || fila?.id == null) throw new Error('Contexto de borrado inválido')
  // Sin filtro por updated_at: las ediciones locales (estado, texto, cobro)
  // no actualizan esa columna en memoria y el trigger sí la cambia en la base,
  // así que exigirla rechazaba borrados válidos hasta la siguiente recarga.
  const { data, error } = await supabase.from(tabla).delete().eq('barberia_id', barberiaId).eq('id', fila.id).select('id')
  if (error) throw error
  // RLS o un borrado ajeno pueden devolver cero filas.
  // No hay evidencia para anunciar éxito ni para reintentar automáticamente.
  if (!Array.isArray(data) || data.length !== 1 || String(data[0]?.id) !== String(fila.id)) {
    throw new Error('No se confirmó el borrado. Actualizá los datos antes de volver a intentarlo.')
  }
}

// La lista original se conserva durante los cinco segundos. Deshacer sólo
// retira la marca: nunca reinserta una copia vieja sobre una recarga reciente.
export function crearBorradosDiferidos({ onChange = () => {} } = {}) {
  const operaciones = new Map()
  let cerrada = false

  function programar({ tabla, id, guardar, onConfirmado, onError, retener = true }) {
    const key = keyOf(tabla, id)
    if (cerrada || !TABLAS.has(tabla) || id == null || operaciones.has(key)) return null
    const op = { estado: 'esperando' }
    operaciones.set(key, op)
    onChange()
    const vigente = () => !cerrada && operaciones.get(key) === op
    return {
      deshacer() {
        if (!vigente() || op.estado !== 'esperando') return false
        operaciones.delete(key)
        onChange()
        return true
      },
      async confirmar() {
        if (!vigente() || op.estado !== 'esperando') return false
        op.estado = 'guardando'
        onChange()
        try {
          await guardar()
        } catch (error) {
          if (vigente()) {
            operaciones.delete(key)
            onChange()
            onError(error)
          }
          return false
        }
        if (!vigente()) return false
        op.estado = 'confirmado'
        // En remoto se conserva la marca durante este contexto, incluso si
        // una consulta iniciada antes del DELETE devuelve después la fila.
        // En demo no hay consultas remotas y los ids locales se pueden reusar.
        if (!retener) operaciones.delete(key)
        onConfirmado()
        onChange()
        return true
      },
    }
  }

  return {
    programar,
    filtrar: (tabla, filas) => cerrada || operaciones.size === 0 ? filas : filas.filter((fila) => !operaciones.has(keyOf(tabla, fila.id))),
    pendiente: () => !cerrada && [...operaciones.values()].some((op) => op.estado !== 'confirmado'),
    cerrar() { cerrada = true; operaciones.clear() },
  }
}
