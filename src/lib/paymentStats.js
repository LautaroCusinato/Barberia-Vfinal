// Indicadores de los datos cargados, sin convertir precios de lista en pagos.
export function resumenCobros(pagos = [], turnos = [], barberos = []) {
  const porProfesional = new Map()
  const turnosPorId = new Map(turnos.map((t) => [String(t.id), t]))
  let cobrado = 0
  let estimadoSinCobro = 0
  const idsConPago = new Set()
  for (const pago of pagos) {
    const monto = Number(pago.monto)
    if (!Number.isFinite(monto)) continue
    cobrado += monto
    if (pago.turno_id != null) idsConPago.add(String(pago.turno_id))
    // pagos no tiene barbero_id: sólo asignar si el turno está cargado.
    const turno = turnosPorId.get(String(pago.turno_id))
    const id = turno?.barbero_id == null ? null : String(turno.barbero_id)
    const key = id ?? '__sin_asignar__'
    const profesional = barberos.find((b) => String(b.id) === id)
    if (!porProfesional.has(key)) porProfesional.set(key, {
      id: key, label: profesional?.nombre || 'Sin profesional identificado',
      color: profesional?.color || 'var(--accent)', total: 0, cobros: 0,
    })
    const grupo = porProfesional.get(key)
    grupo.total += monto
    grupo.cobros += 1
  }
  let atendidosSinCobro = 0
  for (const turno of turnos) {
    if (turno.estado !== 'atendido' || idsConPago.has(String(turno.id))) continue
    atendidosSinCobro += 1
    const precio = Number(turno.precio)
    if (Number.isFinite(precio)) estimadoSinCobro += precio
  }
  const cantidadCobros = [...porProfesional.values()].reduce((sum, p) => sum + p.cobros, 0)
  return {
    cobrado, cantidadCobros, ticketPorCobro: cantidadCobros ? cobrado / cantidadCobros : 0,
    estimadoSinCobro, atendidosSinCobro,
    porProfesional: [...porProfesional.values()].sort((a, b) => b.total - a.total),
  }
}

export function fechaPago(iso, timezone = 'America/Argentina/Buenos_Aires') {
  if (!iso) return null
  const fecha = new Date(iso)
  if (!Number.isFinite(fecha.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(fecha)
}

// Última lectura gana. Una carga fallida/incompleta nunca confirma un cero.
// Una recarga (Realtime, reintento) después de una lectura completa queda
// "actualizando": los totales ya confirmados siguen visibles mientras tanto.
export function crearCargaPagos({ client, barberiaId, onData, onStatus, onError, isCancelled = () => false }) {
  let secuencia = 0
  let confirmado = false
  return async () => {
    const actual = ++secuencia
    onStatus(confirmado ? 'actualizando' : 'cargando')
    try {
      const { data, error, count } = await client.from('pagos')
        .select('*', { count: 'exact' }).eq('barberia_id', barberiaId)
        .order('created_at', { ascending: false })
      if (isCancelled() || actual !== secuencia) return
      if (error) throw error
      if (!Array.isArray(data) || !Number.isInteger(count) || count !== data.length) {
        confirmado = false
        onStatus('incompleto')
        return
      }
      onData(data)
      confirmado = true
      onStatus('listo')
    } catch (error) {
      if (isCancelled() || actual !== secuencia) return
      confirmado = false
      onStatus('error')
      onError(error)
    }
  }
}
