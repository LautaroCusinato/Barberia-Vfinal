import { StrictMode, useState } from 'react'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDeferredDeletes } from './useDeferredDeletes.js'
import { useToasts } from './useToasts.js'
import Toaster from '../components/Toaster.jsx'

const filas = [{ id: 1, texto: 'Primera' }, { id: 2, texto: 'Segunda' }, { id: 3, texto: 'Tercera' }]
const diferido = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function montar(guardar = vi.fn().mockResolvedValue()) {
  const onError = vi.fn(), onConfirmado = vi.fn()
  const h = renderHook(({ contexto }) => {
    const [base, setBase] = useState(filas)
    const toasts = useToasts({ contexto })
    const cola = useDeferredDeletes(contexto)
    const eliminar = (id) => {
      const op = cola.programar({
        tabla: 'notas', id,
        guardar: () => guardar({ id, contexto }),
        onError,
        onConfirmado: () => {
          setBase((prev) => prev.filter((fila) => fila.id !== id))
          onConfirmado()
          toasts.mostrar({ mensaje: 'Nota eliminada' })
        },
      })
      if (!op) return false
      return toasts.mostrar({ mensaje: 'Eliminación pendiente', labelCerrar: 'Eliminar ahora', duracion: 5000, onUndo: op.deshacer, onDiscard: op.deshacer, onExpire: op.confirmar })
    }
    return { base, setBase, visibles: cola.filtrar('notas', base), eliminar, ...toasts }
  }, { initialProps: { contexto: '927' }, wrapper: StrictMode })
  return { ...h, guardar, onError, onConfirmado }
}

describe('Deshacer con temporizador y ciclo de vida del panel', () => {
  it('recargar antes de vencer no hace reaparecer la fila; Deshacer muestra la edición reciente', () => {
    const h = montar()
    let aviso
    act(() => { aviso = h.result.current.eliminar(1) })
    expect(h.result.current.base).toEqual(filas)
    act(() => h.result.current.setBase([{ id: 1, texto: 'Texto editado por otra sesión' }, filas[1]]))
    expect(h.result.current.visibles).toEqual([filas[1]])
    act(() => h.result.current.cerrar(aviso, 'undo'))
    expect(h.result.current.visibles).toHaveLength(2)
    expect(h.result.current.visibles[0].texto).toContain('otra sesión')
    act(() => vi.advanceTimersByTime(6000))
    expect(h.guardar).not.toHaveBeenCalled()
  })
  it('al vencer confirma una sola vez y oculta una recarga tardía', async () => {
    const h = montar()
    act(() => h.result.current.eliminar(1))
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(h.guardar).toHaveBeenCalledExactlyOnceWith({ id: 1, contexto: '927' })
    expect(h.onConfirmado).toHaveBeenCalledTimes(1)
    act(() => h.result.current.setBase(filas))
    expect(h.result.current.visibles).toEqual(filas.slice(1))
    expect(h.result.current.toasts.some((aviso) => aviso.mensaje === 'Nota eliminada')).toBe(true)
  })
  it('cerrar para confirmar y luego vencer no duplica el DELETE', async () => {
    const h = montar()
    let id
    act(() => { id = h.result.current.eliminar(1) })
    await act(async () => h.result.current.cerrar(id, 'expire'))
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(h.guardar).toHaveBeenCalledTimes(1)
  })
  it('superar el máximo de avisos cancela el más viejo en vez de borrar sin Deshacer', async () => {
    const h = montar()
    act(() => {
      h.result.current.eliminar(1)
      h.result.current.eliminar(2)
      h.result.current.eliminar(3)
    })
    expect(h.result.current.visibles).toEqual([filas[0]])
    expect(h.result.current.toasts).toHaveLength(2)
    expect(h.guardar).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(h.guardar.mock.calls.map(([arg]) => arg.id)).toEqual([2, 3])
  })
  it('pagehide cancela lo que aún no se envió sin iniciar peticiones', async () => {
    const h = montar()
    act(() => h.result.current.eliminar(1))
    act(() => fireEvent(window, new Event('pagehide')))
    expect(h.result.current.visibles).toEqual(filas)
    expect(h.result.current.toasts).toHaveLength(0)
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(h.guardar).not.toHaveBeenCalled()
  })
  it('desmontar limpia timers y no intenta persistir', async () => {
    const h = montar()
    act(() => h.result.current.eliminar(1))
    h.unmount()
    expect(vi.getTimerCount()).toBe(0)
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(h.guardar).not.toHaveBeenCalled()
  })
  it('cambiar de negocio descarta callbacks y avisos del anterior', async () => {
    const h = montar()
    act(() => h.result.current.eliminar(1))
    h.rerender({ contexto: '819' })
    expect(h.result.current.visibles).toEqual(filas)
    expect(h.result.current.toasts).toHaveLength(0)
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(h.guardar).not.toHaveBeenCalled()
  })
  it('una respuesta pendiente del negocio anterior no modifica la nueva pantalla', async () => {
    const envio = diferido()
    const h = montar(vi.fn(() => envio.promise))
    act(() => h.result.current.eliminar(1))
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    h.rerender({ contexto: '819' })
    await act(async () => envio.resolve())
    expect(h.result.current.visibles).toEqual(filas)
    expect(h.onConfirmado).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.guardar).toHaveBeenCalledWith({ id: 1, contexto: '927' })
  })
  it('un error conserva la fila actual y no emite aviso de borrado confirmado', async () => {
    const h = montar(vi.fn().mockRejectedValue(new TypeError('sin red')))
    act(() => h.result.current.eliminar(1))
    act(() => h.result.current.setBase([{ id: 1, texto: 'Última versión' }]))
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(h.result.current.visibles).toEqual([{ id: 1, texto: 'Última versión' }])
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onConfirmado).not.toHaveBeenCalled()
  })
  it('advierte al salir durante la espera o el envío, pero no después de confirmar', async () => {
    const envio = diferido()
    const h = montar(vi.fn(() => envio.promise))
    const intentarSalir = () => {
      const evento = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(evento)
      return evento.defaultPrevented
    }
    expect(intentarSalir()).toBe(false)
    act(() => h.result.current.eliminar(1))
    expect(intentarSalir()).toBe(true)
    await act(async () => vi.advanceTimersByTimeAsync(5000))
    expect(intentarSalir()).toBe(true)
    await act(async () => envio.resolve())
    expect(intentarSalir()).toBe(false)
  })
  it('el botón accesible Deshacer revierte sin confirmar y el cierre tiene etiqueta explícita', () => {
    const h = montar()
    act(() => h.result.current.eliminar(1))
    const view = render(<Toaster toasts={h.result.current.toasts} onClose={h.result.current.cerrar} />)
    expect(screen.getByRole('button', { name: 'Eliminar ahora' })).toHaveAttribute('type', 'button')
    const undo = screen.getByRole('button', { name: 'Deshacer' })
    undo.focus()
    expect(undo).toHaveFocus()
    fireEvent.click(undo)
    view.rerender(<Toaster toasts={h.result.current.toasts} onClose={h.result.current.cerrar} />)
    expect(h.result.current.visibles).toEqual(filas)
    expect(h.guardar).not.toHaveBeenCalled()
  })
})
