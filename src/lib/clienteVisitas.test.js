import { describe, expect, it } from 'vitest'
import { resumenVisitasCliente } from './clienteVisitas'

const HOY = '2026-10-11'
const cliente = { id: 5, nombre: 'Ana', ultima_visita: null, proximo_turno: null }
const turno = (fecha, estado, extra = {}) => ({ id: fecha + estado, cliente_id: 5, fecha, hora: '10:00', estado, ...extra })

describe('resumenVisitasCliente', () => {
  it('la última visita sale del turno pasado más reciente, sin contar ausencias', () => {
    const turnos = [turno('2026-09-01', 'atendido'), turno('2026-10-05', 'confirmado'), turno('2026-10-08', 'no_asistio'), turno('2026-10-08', 'cancelado')]
    expect(resumenVisitasCliente(cliente, turnos, HOY).ultimaVisita).toBe('2026-10-05')
  })

  it('un turno de hoy cuenta como visita recién cuando se marca atendido', () => {
    expect(resumenVisitasCliente(cliente, [turno(HOY, 'confirmado')], HOY)).toEqual({ ultimaVisita: null, proximoTurno: HOY })
    expect(resumenVisitasCliente(cliente, [turno(HOY, 'atendido')], HOY)).toEqual({ ultimaVisita: HOY, proximoTurno: null })
  })

  it('el próximo turno es el confirmado más cercano desde hoy', () => {
    const turnos = [turno('2026-10-20', 'confirmado'), turno('2026-10-13', 'confirmado'), turno('2026-10-12', 'no_asistio')]
    expect(resumenVisitasCliente(cliente, turnos, HOY).proximoTurno).toBe('2026-10-13')
  })

  it('sólo usa los turnos de ese cliente por ID, nunca por nombre', () => {
    const ajeno = turno('2026-10-09', 'atendido', { cliente_id: 6, paciente: 'Ana' })
    expect(resumenVisitasCliente(cliente, [ajeno], HOY).ultimaVisita).toBeNull()
  })

  it('respeta una visita cargada a mano más reciente y no una fecha futura', () => {
    expect(resumenVisitasCliente({ ...cliente, ultima_visita: '2026-10-10' }, [turno('2026-08-01', 'atendido')], HOY).ultimaVisita).toBe('2026-10-10')
    expect(resumenVisitasCliente({ ...cliente, ultima_visita: '2026-12-01' }, [turno('2026-08-01', 'atendido')], HOY).ultimaVisita).toBe('2026-08-01')
  })

  it('sin turnos cargados conserva los datos de la ficha', () => {
    expect(resumenVisitasCliente({ ...cliente, ultima_visita: '2026-01-02', proximo_turno: '2026-11-01' }, undefined, HOY)).toEqual({ ultimaVisita: '2026-01-02', proximoTurno: '2026-11-01' })
  })
})
