// Duración de los avisos del panel (la misma que usan "Deshacer" y mover turno).
export const DURACION_AVISO_MS = 5000

export const MENSAJES_EXITO = {
  turnoCreado: 'Turno agendado',
  turnoEditado: 'Cambios del turno guardados',
  cobroRegistrado: 'Cobro registrado',
  clienteCreado: 'Cliente agregado',
  clienteEditado: 'Cliente actualizado',
  estadoTurno: (label) => `Turno marcado como ${label}`,
}

// Ejecuta una mutación y avisa éxito sólo si se confirmó el guardado: un
// `false` (error ya reportado o cancelación) o una excepción no avisan nada.
// Devuelve el mismo resultado para que el modal decida si cerrar o conservar
// el borrador. El aviso sale únicamente de acá, nunca también del modal.
export async function conAvisoExito(mutacion, mensaje, mostrar) {
  const resultado = await mutacion()
  if (resultado === true) mostrar({ mensaje, duracion: DURACION_AVISO_MS })
  return resultado
}
