import { describe, expect, it, vi } from 'vitest'
import { crearColaMovimientos, mismaVersionTurno, persistirMovimiento, TURNO_CAMBIO } from './turnoMoves.js'

const fecha = '2026-10-12'
const turno = { id: 7, barberia_id: 927, barbero_id: 3, fecha, hora: '09:00', updated_at: '2026-10-05T12:00:00Z' }
const destino = (hora) => ({ fecha, hora })
function diferido() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function preparar() {
  const filas = new Map([[7, { ...turno }], [8, { ...turno, id: 8 }]])
  const peticiones = []
  const onError = vi.fn(), onObsoleto = vi.fn(), onMovido = vi.fn()
  const guardar = vi.fn((id, origen, posicion) => {
    const pendiente = diferido()
    peticiones.push({ id, origen, posicion, ...pendiente })
    return pendiente.promise
  })
  const confirmar = vi.fn((id, origen, guardado) => {
    const actual = filas.get(id)
    if (!mismaVersionTurno(actual, origen) && !mismaVersionTurno(actual, guardado)) return false
    filas.set(id, { ...actual, ...guardado })
    return true
  })
  const cola = crearColaMovimientos({ leer: (id) => filas.get(id), guardar, confirmar, onError, onObsoleto, onMovido })
  const exito = (indice) => {
    const p = peticiones[indice]
    p.resolve({ ...p.origen, ...p.posicion, updated_at: `2026-10-05T12:00:0${indice + 1}Z` })
  }
  return { cola, filas, peticiones, guardar, confirmar, exito, onError, onObsoleto, onMovido }
}

describe('movimientos confirmados por turno', () => {
  it('no envía dos escrituras simultáneas del mismo turno, aunque ambas estén pedidas', async () => {
    const h = preparar()
    const primero = h.cola.mover(7, destino('10:00'))
    const segundo = h.cola.mover(7, destino('11:00'))
    expect(h.cola.pendiente(7)).toBe(true)
    await Promise.resolve()
    expect(h.guardar).toHaveBeenCalledTimes(1)
    expect(h.filas.get(7).hora).toBe('09:00')
    h.exito(0)
    expect(await primero).toBe(true)
    await Promise.resolve()
    expect(h.guardar).toHaveBeenCalledTimes(2)
    expect(h.peticiones[1].origen.hora).toBe('10:00')
    expect(h.peticiones[1].origen.updated_at).toBe('2026-10-05T12:00:01Z')
    h.exito(1)
    expect(await segundo).toBe(true)
    expect(h.filas.get(7).hora).toBe('11:00')
    expect(h.onMovido).toHaveBeenCalledTimes(1)
    expect(h.cola.pendiente(7)).toBe(false)
  })

  it('el primero puede fallar y el segundo se guarda desde la última posición confirmada', async () => {
    const h = preparar()
    const primero = h.cola.mover(7, destino('10:00'))
    const segundo = h.cola.mover(7, destino('11:00'))
    await Promise.resolve()
    h.peticiones[0].reject(new Error('red'))
    expect(await primero).toBe(false)
    await Promise.resolve()
    expect(h.peticiones[1].origen.hora).toBe('09:00')
    h.exito(1)
    expect(await segundo).toBe(true)
    expect(h.filas.get(7).hora).toBe('11:00')
    expect(h.onError).toHaveBeenCalledTimes(1)
  })

  it('si falla el segundo, conserva el primer movimiento confirmado', async () => {
    const h = preparar()
    const primero = h.cola.mover(7, destino('10:00'))
    const segundo = h.cola.mover(7, destino('11:00'))
    await Promise.resolve()
    h.exito(0)
    await primero
    await Promise.resolve()
    h.peticiones[1].reject({ code: '23P01' })
    expect(await segundo).toBe(false)
    expect(h.filas.get(7).hora).toBe('10:00')
    expect(h.onMovido).not.toHaveBeenCalled()
  })

  it('permite respuestas invertidas de turnos distintos sin mezclarlos', async () => {
    const h = preparar()
    const primero = h.cola.mover(7, destino('10:00'))
    const segundo = h.cola.mover(8, destino('11:00'))
    await Promise.resolve()
    expect(h.guardar).toHaveBeenCalledTimes(2)
    h.exito(1)
    await segundo
    h.peticiones[0].reject(new Error('red'))
    await primero
    expect(h.filas.get(7).hora).toBe('09:00')
    expect(h.filas.get(8).hora).toBe('11:00')
  })

  it('Deshacer guarda la vuelta, no repite el toast y no permite ejecutarse dos veces', async () => {
    const h = preparar()
    const movimiento = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    h.exito(0)
    await movimiento
    const { onUndo } = h.onMovido.mock.calls[0][0]
    const vuelta = onUndo()
    expect(await onUndo()).toBe(false)
    expect(h.onObsoleto).toHaveBeenCalledTimes(1)
    expect(h.peticiones[1].posicion.hora).toBe('09:00')
    h.exito(1)
    expect(await vuelta).toBe(true)
    expect(h.filas.get(7).hora).toBe('09:00')
    expect(h.onMovido).toHaveBeenCalledTimes(1)
  })

  it('un Deshacer viejo no escribe después de otro movimiento, aunque se vuelva al mismo horario', async () => {
    const h = preparar()
    const primero = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    h.exito(0)
    await primero
    const { onUndo } = h.onMovido.mock.calls[0][0]
    const segundo = h.cola.mover(7, destino('11:00'))
    expect(await onUndo()).toBe(false)
    h.exito(1)
    await segundo
    const tercero = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    h.exito(2)
    await tercero
    expect(await onUndo()).toBe(false)
    expect(h.guardar).toHaveBeenCalledTimes(3)
    expect(h.filas.get(7).hora).toBe('10:00')
  })

  it.each(['edicion', 'eliminacion', 'version'])('invalida Deshacer por %s sin nuevas escrituras', async (tipo) => {
    const h = preparar()
    const movimiento = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    h.exito(0)
    await movimiento
    const { onUndo } = h.onMovido.mock.calls[0][0]
    if (tipo === 'edicion') h.cola.invalidar(7)
    if (tipo === 'eliminacion') h.filas.delete(7)
    if (tipo === 'version') h.filas.set(7, { ...h.filas.get(7), updated_at: 'otra-version' })
    expect(await onUndo()).toBe(false)
    expect(h.guardar).toHaveBeenCalledTimes(1)
    expect(h.onObsoleto).toHaveBeenCalledTimes(1)
  })

  it('un fallo al deshacer conserva el movimiento guardado y se informa', async () => {
    const h = preparar()
    const movimiento = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    h.exito(0)
    await movimiento
    const vuelta = h.onMovido.mock.calls[0][0].onUndo()
    await Promise.resolve()
    h.peticiones[1].reject(new Error('sin conexión'))
    expect(await vuelta).toBe(false)
    expect(h.filas.get(7).hora).toBe('10:00')
    expect(h.onError).toHaveBeenCalledTimes(1)
  })

  it('una respuesta anterior no pisa una versión más nueva que llegó por Realtime', async () => {
    const h = preparar()
    const movimiento = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    h.filas.set(7, { ...turno, hora: '12:00', updated_at: 'version-posterior' })
    h.exito(0)
    expect(await movimiento).toBe(false)
    expect(h.filas.get(7).hora).toBe('12:00')
    expect(h.onMovido).not.toHaveBeenCalled()
  })

  it('cerrar el contexto descarta callbacks y escrituras todavía en cola', async () => {
    const h = preparar()
    const primero = h.cola.mover(7, destino('10:00'))
    const segundo = h.cola.mover(7, destino('11:00'))
    await Promise.resolve()
    h.cola.cerrar()
    h.exito(0)
    expect(await primero).toBe(false)
    expect(await segundo).toBe(false)
    expect(await h.cola.mover(8, destino('12:00'))).toBe(false)
    expect(h.guardar).toHaveBeenCalledTimes(1)
    expect(h.confirmar).not.toHaveBeenCalled()
    expect(h.onMovido).not.toHaveBeenCalled()
  })

  it('normaliza HH:mm:ss al comparar posiciones, sin ignorar cambios de versión', () => {
    expect(mismaVersionTurno(turno, { ...turno, hora: '09:00:00' })).toBe(true)
    expect(mismaVersionTurno(turno, { ...turno, updated_at: 'otra' })).toBe(false)
  })
})

describe('persistencia condicional con Supabase simulado', () => {
  function baseSimulada(fila = { ...turno }) {
    const filtros = new Map()
    let valores
    const query = {
      update: vi.fn((payload) => { valores = payload; return query }),
      eq: vi.fn((key, value) => { filtros.set(key, value); return query }),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: fila && [...filtros].every(([key, value]) => fila[key] === value)
        ? { ...fila, ...valores, updated_at: 'version-nueva' } : null, error: null })),
    }
    return { supabase: { from: vi.fn(() => query) }, query, filtros }
  }
  const peticion = { barberiaId: 927, turnoId: 7, origen: turno, destino: destino('10:00') }

  it('confirma la fila devuelta y limita el cambio a fecha/hora dentro del tenant y versión', async () => {
    const h = baseSimulada()
    const resultado = await persistirMovimiento(h.supabase, peticion)
    expect(resultado.hora).toBe('10:00')
    expect(resultado.updated_at).toBe('version-nueva')
    expect(h.supabase.from).toHaveBeenCalledWith('turnos')
    expect(h.query.update).toHaveBeenCalledWith({ fecha, hora: '10:00' })
    expect(h.filtros.get('barberia_id')).toBe(927)
    expect(h.filtros.get('updated_at')).toBe(turno.updated_at)
  })

  it.each([
    ['otro tenant', { ...turno, barberia_id: 819 }],
    ['otro operador, incluso mismo horario', { ...turno, updated_at: 'otra-version' }],
    ['turno eliminado o invisible', null],
  ])('no interpreta cero filas como éxito: %s', async (_nombre, fila) => {
    const h = baseSimulada(fila)
    await expect(persistirMovimiento(h.supabase, peticion)).rejects.toMatchObject({ code: TURNO_CAMBIO })
  })

  it.each([{ ...peticion, barberiaId: null }, { ...peticion, origen: { ...turno, updated_at: null } }])('no escribe sin tenant o versión', async (pedido) => {
    const h = baseSimulada()
    await expect(persistirMovimiento(h.supabase, pedido)).rejects.toMatchObject({ code: TURNO_CAMBIO })
    expect(h.supabase.from).not.toHaveBeenCalled()
  })

  it.each([{ code: '42501' }, { code: '23P01' }, new Error('red')])('propaga rechazos para informar sin cambiar el estado confirmado: %j', async (error) => {
    const h = baseSimulada()
    h.query.maybeSingle.mockResolvedValue({ data: null, error })
    await expect(persistirMovimiento(h.supabase, peticion)).rejects.toBe(error)
  })
})
