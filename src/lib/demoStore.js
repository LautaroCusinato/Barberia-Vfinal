const SESSION_KEY = 'austral-demo-session-v2'
const SNAPSHOT_PREFIX = 'austral-demo-snapshot-v2:'
const DEMO_TTL_MS = 8 * 60 * 60 * 1000

const clone = (value) => JSON.parse(JSON.stringify(value))

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function dateOffset(offset) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return dateKey(date)
}

function makeSeed() {
  const services = [
    { id: 1001, nombre: 'Corte clásico', descripcion: 'Corte con tijera y máquina, terminación prolija.', precio: 8500, duracion: 35, activo: true },
    { id: 1002, nombre: 'Degradé', descripcion: 'Fade personalizado con detalle de contornos.', precio: 10500, duracion: 45, activo: true },
    { id: 1003, nombre: 'Corte + barba', descripcion: 'Corte completo y perfilado de barba.', precio: 14500, duracion: 60, activo: true },
    { id: 1004, nombre: 'Barba', descripcion: 'Perfilado y afeitado de barba.', precio: 7000, duracion: 30, activo: true },
    { id: 1005, nombre: 'Perfilado', descripcion: 'Contornos y mantenimiento express.', precio: 5500, duracion: 20, activo: true },
    { id: 1006, nombre: 'Corte infantil', descripcion: 'Una experiencia tranquila para los más chicos.', precio: 7500, duracion: 30, activo: true },
  ]
  const barbers = [
    // Demo fixtures cover every weekday so the relative-to-today appointments
    // remain valid when the suite runs on a Sunday as well.
    { id: 1101, nombre: 'Mateo', rol: 'Barbero senior', especialidad: 'Barbero senior', color: '#9B6A2F', horario: 'Lun, Mar, Mié, Jue, Vie, Sáb y Dom 09:00-18:00 break 13:00-14:00', horario_texto: 'Lun, Mar, Mié, Jue, Vie, Sáb y Dom 09:00-18:00 break 13:00-14:00', activo: true, habilidades: ['corte_clasico', 'degrade', 'corte_barba', 'barba', 'perfilado', 'corte_infantil'] },
    { id: 1102, nombre: 'Lucas', rol: 'Especialista en fades', especialidad: 'Especialista en fades', color: '#3E6F87', horario: 'Mar, Mié, Jue, Vie, Sáb y Dom 10:00-19:00 break 14:00-15:00', horario_texto: 'Mar, Mié, Jue, Vie, Sáb y Dom 10:00-19:00 break 14:00-15:00', activo: true, habilidades: ['corte_clasico', 'degrade', 'corte_barba', 'perfilado'] },
    { id: 1103, nombre: 'Tomás', rol: 'Barbero y barba', especialidad: 'Barbero y barba', color: '#756080', horario: 'Lun, Mar, Mié, Jue, Vie y Dom 12:00-20:00 break 16:00-16:30', horario_texto: 'Lun, Mar, Mié, Jue, Vie y Dom 12:00-20:00 break 16:00-16:30', activo: true, habilidades: ['degrade', 'corte_barba', 'barba', 'perfilado'] },
  ]
  const names = ['Agustín Molina', 'Bruno Acosta', 'Carla Benítez', 'Damián Ríos', 'Elena Sosa', 'Facundo Vera', 'Gabriela Núñez', 'Hernán Luna', 'Ivana Costa', 'Joaquín Paz', 'Karen Silva', 'Leandro Ortiz', 'Malena Duarte', 'Nicolás Gil', 'Olivia Suárez', 'Pablo Arias', 'Rocío Méndez', 'Santiago Vidal', 'Tamara Funes', 'Ulises Ferreyra', 'Valeria Castro', 'Walter Peralta', 'Ximena Lagos', 'Yamil Gómez', 'Zoe Navarro']
  const pacientes = names.map((nombre, index) => ({
    id: 1200 + index,
    nombre,
    telefono: `+54 9 11 0000 ${String(1000 + index).slice(-4)}`,
    ultima_visita: index % 5 === 0 ? null : dateOffset(-(index % 28 + 2)),
    proximo_turno: index < 12 ? dateOffset(index % 7) : null,
    notas: index % 4 === 0 ? 'Prefiere turnos por la tarde.' : '',
  }))
  const serviceAt = (serviceId) => services.find((item) => item.id === serviceId)
  const turnsSeed = [
    [0, '09:00', 1200, 1001, 1101, 'atendido'], [0, '10:00', 1201, 1002, 1102, 'confirmado'], [0, '11:15', 1202, 1004, 1101, 'confirmado'], [0, '14:30', 1203, 1003, 1103, 'confirmado'], [0, '17:00', 1204, 1001, 1102, 'pendiente'],
    [1, '09:30', 1205, 1006, 1101, 'confirmado'], [1, '11:00', 1206, 1005, 1101, 'confirmado'], [1, '15:00', 1207, 1004, 1103, 'confirmado'],
    [2, '10:30', 1208, 1003, 1102, 'confirmado'], [3, '09:00', 1209, 1001, 1101, 'confirmado'], [3, '16:00', 1210, 1002, 1103, 'confirmado'],
    [5, '10:00', 1211, 1004, 1102, 'confirmado'], [7, '14:00', 1212, 1003, 1101, 'confirmado'], [-2, '10:00', 1213, 1001, 1101, 'atendido'], [-1, '17:00', 1214, 1002, 1102, 'no_asistio'],
  ]
  const turnos = turnsSeed.map(([offset, hora, patientId, serviceId, barberId, estado], index) => {
    const service = serviceAt(serviceId)
    const patient = pacientes.find((item) => item.id === patientId)
    return { id: 1300 + index, fecha: dateOffset(offset), hora, paciente: patient.nombre, paciente_id: patient.id, motivo: service.nombre, estado, servicio_id: service.id, barbero_id: barberId, precio: service.precio, duracion: service.duracion, notas: index % 3 === 0 ? 'Cliente de demostración · preferencia guardada' : '' }
  })
  const conversaciones = [
    { id: 1401, paciente: 'Agustín Molina', clienteId: 1200, ultimaHora: '10:42', noLeido: true, mensajes: [{ de: 'paciente', texto: 'Hola, ¿tienen turno hoy?', hora: '10:40' }, { de: 'bot', texto: 'Ejemplo de respuesta preparada: podés reservar desde la página pública de Austral.', hora: '10:41' }, { de: 'paciente', texto: 'Perfecto, gracias.', hora: '10:42' }] },
    { id: 1402, paciente: 'Bruno Acosta', clienteId: 1201, ultimaHora: '09:15', noLeido: true, mensajes: [{ de: 'paciente', texto: '¿Hay disponibilidad para mañana por la tarde?', hora: '09:14' }, { de: 'bot', texto: 'Ejemplo de respuesta preparada: la página pública muestra las opciones disponibles.', hora: '09:15' }] },
    { id: 1403, paciente: 'Carla Benítez', clienteId: 1202, ultimaHora: 'ayer', noLeido: false, mensajes: [{ de: 'bot', texto: 'Ejemplo de recordatorio preparado: tu turno está confirmado.', hora: 'ayer' }, { de: 'paciente', texto: 'Gracias, ahí estaré.', hora: 'ayer' }] },
    { id: 1404, paciente: 'Damián Ríos', clienteId: 1203, ultimaHora: 'lunes', noLeido: false, mensajes: [{ de: 'paciente', texto: 'Quisiera sacar un turno para corte y barba.', hora: 'lunes' }, { de: 'bot', texto: 'Ejemplo de respuesta preparada: elegí el día y el horario desde el enlace público.', hora: 'lunes' }] },
  ]
  const notas = pacientes.slice(0, 6).map((patient, index) => ({ id: 1500 + index, paciente: patient.nombre, cliente_id: patient.id, texto: index % 2 ? 'Suele pedir terminación natural y turnos cada 30 días.' : 'Prefiere atención por la tarde.', fecha: dateOffset(-(index + 1)) }))
  const bloqueos = [{ id: 1601, barberia_id: 0, barbero_id: 1102, fecha: dateOffset(3), motivo: 'Capacitación del equipo', tipo: 'parcial', start_time: '13:00', end_time: '15:00' }, { id: 1602, barberia_id: 0, barbero_id: null, fecha: dateOffset(6), motivo: 'Feriado', tipo: 'total', start_time: '00:00', end_time: '23:59' }]
  return {
    turnos, conversaciones, pacientes, notas, servicios: services, barberos: barbers, bloqueos, pagos: [],
    tenantBranding: { nombre: 'Barbería Demo Austral', logo_url: '', color_principal: '#9B6A2F', color_secundario: '#EDE6D8', zona_horaria: 'America/Argentina/Buenos_Aires' },
    horariosDefault: { dias: [1, 2, 3, 4, 5, 6], inicio: '09:00', fin: '20:00', breaks: [{ inicio: '13:00', fin: '14:00' }] },
    zonaHoraria: 'America/Argentina/Buenos_Aires',
  }
}

function readStored(sessionId) {
  try {
    const raw = localStorage.getItem(SNAPSHOT_PREFIX + sessionId)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > DEMO_TTL_MS) {
      localStorage.removeItem(SNAPSHOT_PREFIX + sessionId)
      return null
    }
    return parsed.snapshot || null
  } catch {
    return null
  }
}

export function getDemoSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    if (parsed?.id && parsed.createdAt && Date.now() - parsed.createdAt <= DEMO_TTL_MS) return parsed.id
    const id = globalThis.crypto?.randomUUID?.() || `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, createdAt: Date.now() }))
    return id
  } catch {
    return 'demo-session-memory'
  }
}

export function getDemoSnapshot(sessionId) {
  return clone(readStored(sessionId) || makeSeed())
}

export function saveDemoSnapshot(sessionId, snapshot) {
  try {
    localStorage.setItem(SNAPSHOT_PREFIX + sessionId, JSON.stringify({ savedAt: Date.now(), snapshot }))
  } catch {
    // La demo sigue funcionando en memoria aunque el navegador bloquee storage.
  }
}

export function resetDemoSession(sessionId) {
  try { localStorage.removeItem(SNAPSHOT_PREFIX + sessionId) } catch { /* memoria */ }
  window.dispatchEvent(new CustomEvent('austral:demo-reset', { detail: { sessionId } }))
}

export const DEMO_TTL_HOURS = DEMO_TTL_MS / 60 / 60 / 1000
