import { describe, expect, it, vi } from 'vitest'
import { crearCargaPagos, fechaPago, resumenCobros } from './paymentStats'

describe('cobros frente a estimaciones', () => {
  it('un atendido sin pago no genera dinero cobrado', () => {
    expect(resumenCobros([], [{ id: 1, estado: 'atendido', precio: 10000 }])).toMatchObject({
      cobrado: 0, ticketPorCobro: 0, estimadoSinCobro: 10000, atendidosSinCobro: 1,
    })
  })
  it('conserva pagos de turnos ausentes o cuyo estado cambió y usa el monto real', () => {
    const resultado = resumenCobros([{ turno_id: 1, monto: 8000 }, { turno_id: 99, monto: 3000 }],
      [{ id: 1, estado: 'cancelado', precio: 10000, barbero_id: 2 }], [{ id: 2, nombre: 'Ana' }])
    expect(resultado.cobrado).toBe(11000)
    expect(resultado.ticketPorCobro).toBe(5500)
    expect(resultado.porProfesional.map((g) => g.total)).toEqual([8000, 3000])
  })
  it('promedia registros de cobro, no turnos, y separa profesionales homónimos', () => {
    const resultado = resumenCobros([{ turno_id: 1, monto: 0 }, { turno_id: 1, monto: 2000 }, { turno_id: 2, monto: 4000 }],
      [{ id: 1, estado: 'atendido', barbero_id: 1, precio: 5000 }, { id: 2, estado: 'atendido', barbero_id: 2 }],
      [{ id: 1, nombre: 'Juan' }, { id: 2, nombre: 'Juan' }])
    expect(resultado.ticketPorCobro).toBe(2000)
    expect(resultado.atendidosSinCobro).toBe(0)
    expect(new Set(resultado.porProfesional.map((g) => g.id)).size).toBe(2)
  })
  it('la fecha de caja usa la zona del negocio y tolera fecha ausente o inválida', () => {
    expect(fechaPago('2026-10-08T01:30:00Z')).toBe('2026-10-07')
    expect(fechaPago('2026-10-08T01:30:00Z', 'Europe/Madrid')).toBe('2026-10-08')
    expect(fechaPago(null)).toBeNull()
    expect(fechaPago('no-fecha')).toBeNull()
  })
})

function fixture(respuestas) {
  const order = vi.fn().mockImplementation(() => respuestas.shift())
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order }
  const client = { from: vi.fn(() => query) }
  const onData = vi.fn(), onStatus = vi.fn(), onError = vi.fn()
  return { query, onData, onStatus, onError, cargar: crearCargaPagos({ client, barberiaId: 7, onData, onStatus, onError }) }
}

describe('carga de pagos', () => {
  it('confirma un cero únicamente tras leer correctamente una colección completa', async () => {
    const f = fixture([Promise.resolve({ data: [], count: 0 })])
    await f.cargar()
    expect(f.query.eq).toHaveBeenCalledWith('barberia_id', 7)
    expect(f.query.select).toHaveBeenCalledWith('*', { count: 'exact' })
    expect(f.onData).toHaveBeenCalledWith([])
    expect(f.onStatus.mock.calls.flat()).toEqual(['cargando', 'listo'])
  })
  it.each([
    { data: [], error: new Error('offline') },
    { data: null, error: new Error('excepción') },
  ])('no sustituye los datos previos por cero ante errores', async (respuesta) => {
    const f = fixture([Promise.resolve(respuesta)])
    await f.cargar()
    expect(f.onData).not.toHaveBeenCalled()
    expect(f.onStatus).toHaveBeenLastCalledWith('error')
  })
  it('detecta el límite del servidor y no presenta una suma parcial como total', async () => {
    const f = fixture([Promise.resolve({ data: [{ monto: 100 }], count: 1001 })])
    await f.cargar()
    expect(f.onData).not.toHaveBeenCalled()
    expect(f.onStatus).toHaveBeenLastCalledWith('incompleto')
  })
  it('una respuesta vieja no sobrescribe la lectura más reciente', async () => {
    let completar
    const primera = new Promise((resolve) => { completar = resolve })
    const f = fixture([primera, Promise.resolve({ data: [{ id: 2 }], count: 1 })])
    const pendiente = f.cargar()
    await f.cargar()
    completar({ data: [{ id: 1 }], count: 1 })
    await pendiente
    expect(f.onData.mock.calls).toEqual([[[{ id: 2 }]]])
  })
})
