function fmt(date) {
  return date.toISOString().slice(0, 10)
}

const today = new Date()
const d = (offsetDays) => {
  const nd = new Date(today)
  nd.setDate(nd.getDate() + offsetDays)
  return fmt(nd)
}

export const mockTurnos = [
  { id: 1, fecha: d(0), hora: '09:00', paciente: 'Marcos Diaz', motivo: 'Corte clasico', estado: 'atendido', servicio_id: 1, barbero_id: 1, precio: 6500, duracion: 30 },
  { id: 2, fecha: d(0), hora: '10:00', paciente: 'Sofia Ruiz', motivo: 'Corte + barba', estado: 'confirmado', servicio_id: 2, barbero_id: 2, precio: 9500, duracion: 50 },
  { id: 3, fecha: d(0), hora: '11:30', paciente: 'Juan Perez', motivo: 'Perfilado de barba', estado: 'confirmado', servicio_id: 6, barbero_id: 1, precio: 4200, duracion: 25 },
  { id: 4, fecha: d(0), hora: '13:00', paciente: 'Lucia Gomez', motivo: 'Fade', estado: 'confirmado', servicio_id: 3, barbero_id: 3, precio: 7800, duracion: 40 },
  { id: 5, fecha: d(0), hora: '16:15', paciente: 'Nicolas Aguirre', motivo: 'Color y corte', estado: 'confirmado', servicio_id: 4, barbero_id: 2, precio: 18000, duracion: 90 },
  { id: 6, fecha: d(1), hora: '09:30', paciente: 'Camila Torres', motivo: 'Corte con tijera', estado: 'confirmado', servicio_id: 5, barbero_id: 1, precio: 7200, duracion: 35 },
  { id: 7, fecha: d(1), hora: '15:00', paciente: 'Ezequiel Sosa', motivo: 'Afeitado tradicional', estado: 'confirmado', servicio_id: 6, barbero_id: 3, precio: 4200, duracion: 25 },
  { id: 8, fecha: d(2), hora: '10:30', paciente: 'Valentina Ibanez', motivo: 'Mantenimiento de color', estado: 'confirmado', servicio_id: 4, barbero_id: 2, precio: 18000, duracion: 90 },
  { id: 9, fecha: d(4), hora: '09:00', paciente: 'Marcos Diaz', motivo: 'Repaso de nuca', estado: 'confirmado', servicio_id: 1, barbero_id: 1, precio: 6500, duracion: 30 },
  { id: 10, fecha: d(4), hora: '11:00', paciente: 'Rodrigo Peralta', motivo: 'Corte express', estado: 'confirmado', servicio_id: 1, barbero_id: 3, precio: 6500, duracion: 30 },
  { id: 11, fecha: d(7), hora: '14:00', paciente: 'Sofia Ruiz', motivo: 'Peinado para evento', estado: 'confirmado', servicio_id: 5, barbero_id: 2, precio: 7200, duracion: 35 },
  { id: 12, fecha: d(-2), hora: '10:00', paciente: 'Juan Perez', motivo: 'Perfilado de barba', estado: 'atendido', servicio_id: 6, barbero_id: 1, precio: 4200, duracion: 25 },
  { id: 13, fecha: d(-1), hora: '17:00', paciente: 'Valentina Ibanez', motivo: 'Mantenimiento de color', estado: 'no_asistio', servicio_id: 4, barbero_id: 2, precio: 18000, duracion: 90 },
]

export const mockServicios = [
  { id: 1, nombre: 'Corte clasico', precio: 6500, duracion: 30, activo: true },
  { id: 2, nombre: 'Corte + barba', precio: 9500, duracion: 50, activo: true },
  { id: 3, nombre: 'Fade', precio: 7800, duracion: 40, activo: true },
  { id: 4, nombre: 'Color', precio: 18000, duracion: 90, activo: true },
  { id: 5, nombre: 'Peinado', precio: 7200, duracion: 35, activo: true },
  { id: 6, nombre: 'Barba / perfilado', precio: 4200, duracion: 25, activo: true },
]

export const mockBarberos = [
  { id: 1, nombre: 'Tomas Vega', rol: 'Barbero senior', color: '#9B6A2F', horario: 'Lun, Mar, Mié, Jue, Vie y Sáb 09:00-17:00', activo: true },
  { id: 2, nombre: 'Mauro Silva', rol: 'Color y tijera', color: '#3E6F87', horario: 'Mar, Mié, Jue, Vie y Sáb 10:00-19:00', activo: true },
  { id: 3, nombre: 'Diego Ramos', rol: 'Fade specialist', color: '#756080', horario: 'Lun, Mar, Mié, Jue y Vie 12:00-20:00', activo: true },
]

export const mockBarberiaConfig = {
  nombre: 'Barberia Central',
  slug: 'barberia-central',
  whatsapp: '+54 9 11 5522-8080',
  horario: 'Lun a Sab de 09:00 a 20:00',
  direccion: 'Av. Corrientes 1450, CABA',
  recordatorioHoras: 24,
  colorPrincipal: '#9B6A2F',
  linkReserva: 'https://demo.tubarberia.app/barberia-central',
}

export const mockConversaciones = [
  {
    id: 1,
    paciente: 'Marcos Diaz',
    ultimaHora: '10:42',
    noLeido: true,
    mensajes: [
      { de: 'paciente', texto: 'Hola, queria confirmar mi turno de manana a las 9', hora: '10:40' },
      { de: 'bot', texto: 'Confirmado, Marcos. Te esperamos manana a las 9:00 para tu corte clasico.', hora: '10:41' },
      { de: 'paciente', texto: 'Perfecto, gracias!', hora: '10:42' },
    ],
  },
  {
    id: 2,
    paciente: 'Sofia Ruiz',
    ultimaHora: '09:15',
    noLeido: true,
    mensajes: [
      { de: 'paciente', texto: 'Tienen turno disponible para el jueves por la tarde?', hora: '09:14' },
      { de: 'bot', texto: 'Si, tenemos 15:30 y 17:00 disponibles el jueves. Cual preferis?', hora: '09:15' },
    ],
  },
  {
    id: 3,
    paciente: 'Juan Perez',
    ultimaHora: 'ayer',
    noLeido: false,
    mensajes: [
      { de: 'bot', texto: 'Recorda venir con el pelo seco para que el corte quede mas prolijo.', hora: 'ayer' },
      { de: 'paciente', texto: 'Gracias, ahi estare', hora: 'ayer' },
    ],
  },
  {
    id: 4,
    paciente: 'Lucia Gomez',
    ultimaHora: 'lunes',
    noLeido: false,
    mensajes: [
      { de: 'paciente', texto: 'Buenas, quisiera sacar un turno para corte y barba', hora: 'lunes' },
      { de: 'bot', texto: 'Claro, que dia te queda mejor?', hora: 'lunes' },
    ],
  },
]

export const mockPacientes = [
  { id: 1, nombre: 'Marcos Diaz', telefono: '+54 9 11 5522-1234', ultima_visita: '2026-05-12', proximo_turno: d(0) },
  { id: 2, nombre: 'Sofia Ruiz', telefono: '+54 9 11 4433-9087', ultima_visita: '2026-06-01', proximo_turno: d(0) },
  { id: 3, nombre: 'Juan Perez', telefono: '+54 9 11 3321-7765', ultima_visita: '2026-04-20', proximo_turno: d(0) },
  { id: 4, nombre: 'Lucia Gomez', telefono: '+54 9 11 6690-4432', ultima_visita: null, proximo_turno: d(0) },
  { id: 5, nombre: 'Nicolas Aguirre', telefono: '+54 9 11 2298-1120', ultima_visita: '2026-03-15', proximo_turno: d(0) },
]

export const mockNotas = [
  { id: 1, paciente: 'Juan Perez', texto: 'Prefiere barba corta, marcar contorno sin bajar demasiado la linea.', fecha: '2026-06-28' },
  { id: 2, paciente: 'Sofia Ruiz', texto: 'Usar navaja solo para terminaciones. Suele pedir corte + barba cada 30 dias.', fecha: '2026-06-20' },
  { id: 3, paciente: 'Marcos Diaz', texto: 'Prefiere turnos por la manana, trabaja de tarde.', fecha: '2026-06-15' },
]
