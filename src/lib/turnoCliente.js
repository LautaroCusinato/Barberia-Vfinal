// Identidad del cliente de un turno. Supabase usa cliente_id; los fixtures
// antiguos de demo, paciente_id, y los turnos locales del panel, clienteId.
// Si cliente_id está presente (aunque sea null) manda: al reasignar un turno
// demo a alguien sin ficha queda cliente_id null y paciente_id viejo.
// Nunca se deduce por el nombre: puede ser un alias o un homónimo.
export function clienteIdDelTurno(turno) {
  if (!turno) return null
  if (turno.cliente_id !== undefined) return turno.cliente_id
  return turno.paciente_id ?? turno.clienteId ?? null
}

export function mismoId(a, b) {
  return a != null && b != null && String(a) === String(b)
}
