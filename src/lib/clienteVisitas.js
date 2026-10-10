import { statusMeta } from '../components/StatusSelect'
import { clienteIdDelTurno, mismoId } from './turnoCliente'

// Última visita y próximo turno de un cliente, calculados con sus turnos
// (sólo por cliente_id; nunca por nombre). Antes la última visita era un dato
// manual que nada actualizaba al atender un turno.
//
// Visita: un turno de un día anterior que no quedó como "No asistió", o un
// turno de hoy marcado "Atendido". Una fecha cargada a mano más reciente se
// respeta (por ejemplo, visitas anteriores a usar el panel).
// Próximo turno: el turno confirmado más cercano desde hoy.
export function resumenVisitasCliente(cliente, turnos, todayKey) {
  if (!cliente) return { ultimaVisita: null, proximoTurno: null }
  if (!Array.isArray(turnos) || !todayKey) {
    return { ultimaVisita: cliente.ultima_visita || null, proximoTurno: cliente.proximo_turno || null }
  }
  let ultimaVisita = null
  let proximoTurno = null
  for (const turno of turnos) {
    if (!mismoId(clienteIdDelTurno(turno), cliente.id) || !turno.fecha) continue
    const estado = statusMeta(turno.estado).value
    const fecha = String(turno.fecha).slice(0, 10)
    const visita = (fecha < todayKey && estado !== 'no_asistio') || (fecha === todayKey && estado === 'atendido')
    if (visita && (!ultimaVisita || fecha > ultimaVisita)) ultimaVisita = fecha
    if (fecha >= todayKey && estado === 'confirmado' && (!proximoTurno || fecha < proximoTurno)) proximoTurno = fecha
  }
  const manual = cliente.ultima_visita ? String(cliente.ultima_visita).slice(0, 10) : null
  if (manual && manual <= todayKey && (!ultimaVisita || manual > ultimaVisita)) ultimaVisita = manual
  return { ultimaVisita, proximoTurno }
}
