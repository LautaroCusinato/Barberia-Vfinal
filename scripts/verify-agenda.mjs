import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  barberoDisponible,
  barberoRealizaServicio,
  barberoBloqueadoFecha,
  barberoTrabajaFecha,
  duracionServicioBarbero,
  generarSlotsDisponibles,
  turnosSeSuperponen,
  parseHorarioTexto,
  parseHorarioBarbero,
  siguienteNombreServicio,
} from '../src/lib/text.js'

const horario = 'Lun, Mar, Mié, Jue y Vie 09:00-18:00 break 13:00-14:00'
const franjas = parseHorarioTexto(horario)
assert.equal(franjas.length, 10, 'El break debe dividir cada día en dos franjas')
assert.deepEqual(franjas.filter((f) => f.day_of_week === 1), [
  { day_of_week: 1, start_time: '09:00', end_time: '13:00' },
  { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
])

const barbero = { horario }
assert.equal(barberoDisponible(barbero, '2030-01-07', '12:00', 30), true)
assert.equal(barberoDisponible(barbero, '2030-01-07', '12:45', 30), false)
assert.equal(barberoDisponible(barbero, '2030-01-07', '13:00', 30), false)
assert.equal(barberoDisponible(barbero, '2030-01-07', '14:00', 30), true)
assert.equal(barberoDisponible(barbero, '2030-01-07', '17:30', 60), false)
assert.equal(parseHorarioBarbero(horario)[1].length, 2)

const corte = { id: 1, nombre: 'Corte', duracion: 30 }
const tintura = { id: 2, nombre: 'Tintura', duracion: 60 }
const profesional = {
  id: 10,
  agendaCargada: true,
  serviciosCargados: true,
  servicios: [{ barbero_id: 10, servicio_id: 1, duracion_min: 30 }],
  agenda: [
    { barbero_id: 10, day_of_week: 1, start_time: '10:00', end_time: '13:00', activo: true },
    { barbero_id: 10, day_of_week: 1, start_time: '14:00', end_time: '18:00', activo: true },
  ],
}
assert.equal(barberoRealizaServicio(profesional, corte), true, 'La relación relacional debe habilitar el servicio')
assert.equal(barberoRealizaServicio(profesional, tintura), false, 'Un servicio sin relación no debe estar disponible')
assert.equal(barberoTrabajaFecha(profesional, '2030-01-07'), true, 'El profesional debe trabajar ese día')
assert.equal(barberoTrabajaFecha(profesional, '2030-01-08'), false, 'Un día sin franja debe quedar no laboral')
assert.equal(duracionServicioBarbero(profesional, corte), 30, 'La duración específica del profesional debe prevalecer')
const expectedSlots = ['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30', '11:45', '12:00', '12:15', '12:30', '14:00', '14:15', '14:30', '14:45', '15:00', '15:15', '15:30', '15:45', '16:00', '16:15', '16:30', '16:45', '17:00', '17:15', '17:30']
assert.deepEqual(generarSlotsDisponibles(profesional, '2030-01-07', 30, [], 15, 'America/Argentina/Buenos_Aires', true), expectedSlots, 'Los slots deben respetar jornada y break')
assert.equal(barberoDisponible(profesional, '2030-01-07', '09:00', 30, [], 'America/Argentina/Buenos_Aires', true), false, 'Antes de la jornada no es válido')
assert.equal(barberoDisponible(profesional, '2030-01-07', '17:30', 30, [], 'America/Argentina/Buenos_Aires', true), true, 'El último servicio que termina al cierre es válido')
assert.equal(barberoDisponible(profesional, '2030-01-07', '17:45', 30, [], 'America/Argentina/Buenos_Aires', true), false, 'Un servicio que termina después del cierre es inválido')
assert.equal(barberoDisponible(profesional, '2030-01-07', '13:00', 30, [], 'America/Argentina/Buenos_Aires', true), false, 'El break no puede recibir turnos')
assert.equal(barberoDisponible(profesional, '2030-01-07', '12:45', 30, [], 'America/Argentina/Buenos_Aires', true), false, 'Un servicio que atraviesa el break es inválido')
assert.equal(barberoDisponible(profesional, '2030-01-07', '14:00', 30, [{ fecha: '2030-01-07', barbero_id: 10, start_time: '14:00', end_time: '15:00' }], 'America/Argentina/Buenos_Aires', true), false, 'Un bloqueo parcial debe excluir sólo su franja')
assert.equal(barberoBloqueadoFecha([{ fecha: '2030-01-07', barbero_id: 10, start_time: '00:00', end_time: '23:59' }], 10, '2030-01-07'), true, 'Un bloqueo total debe excluir el día completo')
assert.equal(barberoBloqueadoFecha([{ fecha: '2030-01-07', barbero_id: 10, start_time: '14:00', end_time: '15:00' }], 10, '2030-01-07'), false, 'Un bloqueo parcial no debe ocultar al profesional todo el día')
assert.equal(turnosSeSuperponen('10:15', 30, '10:00', 40), true, 'Los turnos superpuestos deben bloquearse')
assert.equal(turnosSeSuperponen('10:40', 30, '10:00', 40), false, 'Los turnos contiguos no se solapan')
assert.equal(siguienteNombreServicio([{ nombre: 'Nuevo servicio 1' }, { nombre: 'Nuevo servicio 3' }]), 'Nuevo servicio 2', 'Los servicios nuevos deben usar el primer nombre temporal libre')
assert.equal(siguienteNombreServicio([{ nombre: ' nuevo SERVICIO 1 ' }]), 'Nuevo servicio 2', 'La unicidad temporal debe ignorar mayúsculas y espacios')

const appSource = readFileSync(resolve('src', 'App.jsx'), 'utf8')
const modalSource = readFileSync(resolve('src', 'components', 'NewTurnoModal.jsx'), 'utf8')
const sidebarSource = readFileSync(resolve('src', 'components', 'Sidebar.jsx'), 'utf8')
const checklistSource = readFileSync(resolve('src', 'components', 'OnboardingChecklist.jsx'), 'utf8')
const settingsSource = readFileSync(resolve('src', 'components', 'TenantSettings.jsx'), 'utf8')
assert.match(appSource, /turno\.id === existingId/, 'La validación de carrera debe excluir el turno que se está editando')
assert.match(appSource, /error\.code === '23P01'/, 'El conflicto de exclusión debe convertirse en error de horario ocupado')
assert.match(modalSource, /t\.id !== turnoExistente\?\.id/, 'La edición debe excluir su propio turno de la grilla de ocupación')
assert.match(modalSource, /saved !== false/, 'El modal no debe cerrarse si el backend rechaza el guardado')
assert.match(appSource, /saas_integraciones/, 'WhatsApp debe resolver la integración propia del tenant')
assert.match(appSource, /siguienteNombreServicio/, 'El alta de servicios debe generar nombres únicos')
assert.match(sidebarSource, /whatsappReady/, 'El sidebar no debe mostrar WhatsApp conectado sin integración')
assert.match(checklistSource, /austral:onboarding-checklist/, 'El checklist debe persistir preferencias por usuario y tenant')
assert.match(settingsSource, /onBrandingChange/, 'El branding guardado debe actualizar el shell del tenant')

const publicBookingSql = readFileSync(resolve('supabase', 'migrations', '20260807041000_public_catalog_and_checklist.sql'), 'utf8')
assert.match(publicBookingSql, /p_servicio_id/, 'La reserva pública debe validar el servicio solicitado')
assert.match(publicBookingSql, /barbero_servicios/, 'La reserva pública debe usar la relación profesional-servicio')
assert.match(publicBookingSql, /bloqueos_agenda/, 'La reserva pública debe respetar bloqueos')
assert.match(publicBookingSql, /turnos/, 'La reserva pública debe respetar turnos existentes')

const workflowPath = resolve('integrations', 'Barberia Central - Bot WhatsApp (Evolution + Deepseek) (5).json')
const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'))
assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0, 'El workflow de WhatsApp debe tener nodos')
assert.ok(workflow.nodes.some((node) => node.name === 'crear_turno1'), 'El workflow debe conservar la herramienta de alta de turnos')
assert.ok(workflow.nodes.some((node) => node.name === 'cancelar_turno1'), 'El workflow debe conservar la herramienta de cancelación')

console.log('Agenda and workflow checks passed')
