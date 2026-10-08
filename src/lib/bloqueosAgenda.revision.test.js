import { describe, expect, it, vi } from 'vitest'
import { consultarTurnosActivos, fechasEnRango, puedeGestionarBloqueos, turnosNuevos } from './bloqueosAgenda.js'

// Revisión 41: roles de la interfaz, consulta de turnos en la base y bordes
// de fechas.

describe('puedeGestionarBloqueos', () => {
  it('con backend sólo owner y admin, igual que bloqueos_write_owner', () => {
    expect(puedeGestionarBloqueos('owner')).toBe(true)
    expect(puedeGestionarBloqueos('admin')).toBe(true)
    for (const rol of ['recepcionista', 'empleado', 'barbero', 'readonly', '', null, undefined, 'OWNER']) {
      expect(puedeGestionarBloqueos(rol)).toBe(false)
    }
  })

  it('en la demo local siempre se puede probar', () => {
    expect(puedeGestionarBloqueos(null, { conBackend: false })).toBe(true)
  })
})

function queryClient(result) {
  const calls = []
  const chain = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (resolve, reject) => Promise.resolve(result).then(resolve, reject)
      return (...args) => { calls.push([prop, ...args]); return chain }
    },
  })
  return { client: { from: (tabla) => { calls.push(['from', tabla]); return chain } }, calls }
}

describe('consultarTurnosActivos', () => {
  it('consulta el negocio, las fechas y el profesional, sin cancelados ni ausentes', async () => {
    const { client, calls } = queryClient({ data: [
      { id: 1, fecha: '2026-10-10', hora: '10:00', barbero_id: 7, estado: 'confirmado' },
      { id: 2, fecha: '2026-10-10', hora: '11:00', barbero_id: 7, estado: 'cancelado' },
    ], error: null })
    const r = await consultarTurnosActivos(client, { barberiaId: 4, fechas: ['2026-10-10'], barberoId: '7' })
    expect(r).toEqual({ ok: true, turnos: [expect.objectContaining({ id: 1 })] })
    expect(calls).toContainEqual(['from', 'turnos'])
    expect(calls).toContainEqual(['eq', 'barberia_id', 4])
    expect(calls).toContainEqual(['in', 'fecha', ['2026-10-10']])
    expect(calls).toContainEqual(['not', 'estado', 'in', '(cancelado,no_asistio)'])
    expect(calls).toContainEqual(['eq', 'barbero_id', '7'])
  })

  it('para todo el negocio no filtra por profesional', async () => {
    const { client, calls } = queryClient({ data: [], error: null })
    await consultarTurnosActivos(client, { barberiaId: 4, fechas: ['2026-10-10'], barberoId: null })
    expect(calls.some(([m, col]) => m === 'eq' && col === 'barbero_id')).toBe(false)
  })

  it('un error se informa, no se toma como "sin turnos"', async () => {
    const { client } = queryClient({ data: null, error: { message: 'timeout' } })
    expect(await consultarTurnosActivos(client, { barberiaId: 4, fechas: ['2026-10-10'] })).toMatchObject({ ok: false })
    const roto = { from: vi.fn(() => { throw new TypeError('Failed to fetch') }) }
    expect(await consultarTurnosActivos(roto, { barberiaId: 4, fechas: ['2026-10-10'] })).toMatchObject({ ok: false })
  })
})

describe('turnosNuevos', () => {
  it('devuelve sólo los que no estaban en la primera lectura', () => {
    expect(turnosNuevos([{ id: 1 }, { id: '2' }], [{ id: 2 }, { id: 3 }, { id: 1 }])).toEqual([{ id: 3 }])
  })
})

describe('fechasEnRango — bordes', () => {
  it('acepta exactamente 62 días y rechaza 63', () => {
    expect(fechasEnRango('2026-11-01', '2027-01-01').fechas).toHaveLength(62)
    expect(fechasEnRango('2026-11-01', '2027-01-02').error).toMatch(/hasta 62/)
  })

  it('cruza fin de año, febrero bisiesto y no bisiesto', () => {
    expect(fechasEnRango('2026-12-31', '2027-01-01').fechas).toEqual(['2026-12-31', '2027-01-01'])
    expect(fechasEnRango('2028-02-28', '2028-03-01').fechas).toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
    expect(fechasEnRango('2027-02-28', '2027-03-01').fechas).toEqual(['2027-02-28', '2027-03-01'])
    expect(fechasEnRango('2027-02-29').error).toBeTruthy()
  })
})
