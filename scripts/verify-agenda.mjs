import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  barberoDisponible,
  parseHorarioTexto,
  parseHorarioBarbero,
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

const workflowPath = resolve('integrations', 'Barberia Central - Bot WhatsApp (Evolution + Deepseek) (5).json')
const workflow = JSON.parse(readFileSync(workflowPath, 'utf8'))
assert.ok(Array.isArray(workflow.nodes) && workflow.nodes.length > 0, 'El workflow de WhatsApp debe tener nodos')
assert.ok(workflow.nodes.some((node) => node.name === 'crear_turno1'), 'El workflow debe conservar la herramienta de alta de turnos')
assert.ok(workflow.nodes.some((node) => node.name === 'cancelar_turno1'), 'El workflow debe conservar la herramienta de cancelación')

console.log('Agenda and workflow checks passed')
