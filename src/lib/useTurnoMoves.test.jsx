import { StrictMode, useState } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useTurnoMoves } from './useTurnoMoves.js'

const turno = { id: 1, barbero_id: 3, fecha: '2026-10-12', hora: '09:00', updated_at: 'v1' }
const destino = { fecha: turno.fecha, hora: '10:00' }
function diferido() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function montar(guardar) {
  const onError = vi.fn(), onObsoleto = vi.fn(), onMovido = vi.fn()
  const hook = renderHook(({ contexto }) => {
    const [turnos, setTurnos] = useState([turno])
    const movimientos = useTurnoMoves({ contexto, turnos, setTurnos, guardar, onError, onObsoleto, onMovido })
    return { turnos, setTurnos, ...movimientos }
  }, { initialProps: { contexto: '927' }, wrapper: StrictMode })
  return { ...hook, onError, onObsoleto, onMovido }
}

describe('cola de movimientos conectada al estado React', () => {
  it('sólo publica posiciones confirmadas y usa la última versión en una segunda operación', async () => {
    const primero = diferido(), segundo = diferido()
    const guardar = vi.fn().mockReturnValueOnce(primero.promise).mockReturnValueOnce(segundo.promise)
    const h = montar(guardar)
    let a, b
    await act(async () => {
      a = h.result.current.mover(turno, destino)
      b = h.result.current.mover(turno, { ...destino, hora: '11:00' })
    })
    expect(h.result.current.turnos[0].hora).toBe('09:00')
    expect(guardar).toHaveBeenCalledTimes(1)
    await act(async () => { primero.resolve({ ...turno, ...destino, updated_at: 'v2' }); await a })
    expect(guardar.mock.calls[1][1]).toMatchObject({ hora: '10:00', updated_at: 'v2' })
    await act(async () => { segundo.resolve({ ...turno, ...destino, hora: '11:00', updated_at: 'v3' }); await b })
    expect(h.result.current.turnos[0]).toMatchObject({ hora: '11:00', updated_at: 'v3' })
    expect(h.onMovido).toHaveBeenCalledTimes(1)
  })

  it('un rechazo inesperado se convierte en false y conserva el turno visible', async () => {
    const h = montar(vi.fn().mockRejectedValue(new Error('red interrumpida')))
    await act(async () => { expect(await h.result.current.mover(turno, destino)).toBe(false) })
    expect(h.result.current.turnos[0]).toEqual(turno)
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onMovido).not.toHaveBeenCalled()
  })

  it('no sobrescribe una actualización posterior llegada por otra vía', async () => {
    const respuesta = diferido()
    const h = montar(vi.fn().mockReturnValue(respuesta.promise))
    let pendiente
    await act(async () => { pendiente = h.result.current.mover(turno, destino) })
    act(() => h.result.current.setTurnos([{ ...turno, hora: '12:00', updated_at: 'v3' }]))
    await act(async () => {
      respuesta.resolve({ ...turno, ...destino, updated_at: 'v2' })
      expect(await pendiente).toBe(false)
    })
    expect(h.result.current.turnos[0].hora).toBe('12:00')
    expect(h.onObsoleto).toHaveBeenCalledTimes(1)
  })

  it('cambiar de negocio descarta respuestas, cola y callbacks del negocio anterior', async () => {
    const respuesta = diferido()
    const guardar = vi.fn().mockReturnValue(respuesta.promise)
    const h = montar(guardar)
    const moverAnterior = h.result.current.mover
    let a, b
    await act(async () => {
      a = moverAnterior(turno, destino)
      b = moverAnterior(turno, { ...destino, hora: '11:00' })
    })
    h.rerender({ contexto: '819' })
    act(() => h.result.current.setTurnos([{ ...turno, hora: '14:00', updated_at: 'otro-negocio' }]))
    await act(async () => {
      respuesta.resolve({ ...turno, ...destino, updated_at: 'v2' })
      expect(await a).toBe(false)
      expect(await b).toBe(false)
      expect(await moverAnterior(turno, destino)).toBe(false)
    })
    expect(h.result.current.turnos[0].hora).toBe('14:00')
    expect(guardar).toHaveBeenCalledTimes(1)
    expect(h.onMovido).not.toHaveBeenCalled()
  })

  it('un Deshacer guardado antes de desmontar ya no puede escribir', async () => {
    const guardar = vi.fn().mockResolvedValue({ ...turno, ...destino, updated_at: 'v2' })
    const h = montar(guardar)
    await act(async () => { await h.result.current.mover(turno, destino) })
    const { onUndo } = h.onMovido.mock.calls[0][0]
    h.unmount()
    expect(await onUndo()).toBe(false)
    expect(guardar).toHaveBeenCalledTimes(1)
  })
})
