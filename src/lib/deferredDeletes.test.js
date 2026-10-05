import { describe, expect, it, vi } from 'vitest'
import { crearBorradosDiferidos, persistirBorrado } from './deferredDeletes.js'

const fila = { id: 5, texto: 'Original', updated_at: '2026-10-05T10:00:00Z' }
function diferido() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function preparar(extra = {}) {
  const onChange = vi.fn(), guardar = vi.fn().mockResolvedValue(), onConfirmado = vi.fn(), onError = vi.fn()
  const cola = crearBorradosDiferidos({ onChange })
  const opciones = { tabla: 'notas', id: fila.id, guardar, onConfirmado, onError, ...extra }
  const op = cola.programar(opciones)
  return { cola, op, opciones, onChange, guardar, onConfirmado, onError }
}

describe('borrados diferidos sobre listas actualizadas', () => {
  it('oculta la fila de cualquier recarga, sin mutar la lista original', () => {
    const { cola, guardar } = preparar()
    const recarga = [{ ...fila, texto: 'Más reciente' }, { id: 6 }]
    expect(cola.filtrar('notas', recarga)).toEqual([{ id: 6 }])
    expect(recarga).toHaveLength(2)
    expect(cola.filtrar('turnos', recarga)).toEqual(recarga)
    expect(guardar).not.toHaveBeenCalled()
  })
  it('Deshacer conserva la última versión y no resucita filas ausentes', () => {
    const { cola, op } = preparar()
    const recarga = [{ ...fila, texto: 'Edición ajena' }]
    expect(op.deshacer()).toBe(true)
    expect(op.deshacer()).toBe(false)
    expect(cola.filtrar('notas', recarga)).toBe(recarga)
    expect(cola.filtrar('notas', [])).toEqual([])
  })
  it('una operación deshecha no se confirma después', async () => {
    const { op, guardar, cola } = preparar()
    op.deshacer()
    expect(await op.confirmar()).toBe(false)
    expect(guardar).not.toHaveBeenCalled()
    expect(cola.pendiente()).toBe(false)
  })
  it('confirma una única vez aunque se cierre y venza a la vez', async () => {
    const pendiente = diferido()
    const guardar = vi.fn(() => pendiente.promise)
    const { cola, op, onConfirmado } = preparar({ guardar })
    const resultado = op.confirmar()
    expect(await op.confirmar()).toBe(false)
    expect(op.deshacer()).toBe(false)
    expect(cola.pendiente()).toBe(true)
    pendiente.resolve()
    expect(await resultado).toBe(true)
    expect(onConfirmado).toHaveBeenCalledTimes(1)
    expect(guardar).toHaveBeenCalledTimes(1)
    expect(cola.pendiente()).toBe(false)
    expect(cola.filtrar('notas', [fila])).toEqual([])
  })
  it('rechaza dos operaciones simultáneas sobre la misma fila', () => {
    const { cola, opciones } = preparar()
    expect(cola.programar(opciones)).toBeNull()
    expect(cola.programar({ ...opciones, tabla: 'turnos' })).not.toBeNull()
  })
  it('restaura la última lista tras una excepción, sin inventar éxito ni reintentar', async () => {
    const error = new TypeError('red interrumpida')
    const guardar = vi.fn().mockRejectedValue(error)
    const h = preparar({ guardar })
    expect(await h.op.confirmar()).toBe(false)
    expect(h.onError).toHaveBeenCalledWith(error)
    expect(h.onConfirmado).not.toHaveBeenCalled()
    expect(h.cola.filtrar('notas', [{ ...fila, texto: 'Nueva' }])[0].texto).toBe('Nueva')
    expect(await h.op.confirmar()).toBe(false)
    expect(guardar).toHaveBeenCalledTimes(1)
  })
  it('la marca confirmada oculta recargas tardías, sin bloquear salir', async () => {
    const { cola, op } = preparar()
    await op.confirmar()
    expect(cola.filtrar('notas', [fila])).toEqual([])
    expect(cola.pendiente()).toBe(false)
  })
  it('en demo libera el id confirmado para futuras filas locales', async () => {
    const { cola, op } = preparar({ retener: false })
    await op.confirmar()
    expect(cola.filtrar('notas', [{ ...fila, texto: 'Otra nota' }])).toHaveLength(1)
  })
  it('cerrar un contexto cancela lo pendiente sin enviar', async () => {
    const { cola, op, guardar } = preparar()
    cola.cerrar()
    expect(await op.confirmar()).toBe(false)
    expect(guardar).not.toHaveBeenCalled()
    expect(cola.filtrar('notas', [fila])).toEqual([fila])
  })
  it.each(['resolve', 'reject'])('ignora una respuesta %s del contexto anterior', async (accion) => {
    const pendiente = diferido()
    const h = preparar({ guardar: () => pendiente.promise })
    const resultado = h.op.confirmar()
    h.cola.cerrar()
    pendiente[accion](new Error('red'))
    expect(await resultado).toBe(false)
    expect(h.onConfirmado).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
  })
})

describe('borrado remoto acotado', () => {
  function cliente(respuesta) {
    const query = { delete: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockResolvedValue(respuesta) }
    return { query, from: vi.fn(() => query) }
  }
  it('filtra por negocio, id y versión, y exige una fila devuelta', async () => {
    const db = cliente({ data: [{ id: 5 }], error: null })
    await persistirBorrado(db, { tabla: 'notas', barberiaId: 927, fila })
    expect(db.from).toHaveBeenCalledWith('notas')
    expect(db.query.eq.mock.calls).toEqual([['barberia_id', 927], ['id', 5], ['updated_at', fila.updated_at]])
    expect(db.query.select).toHaveBeenCalledWith('id')
  })
  it.each([[], null, [{ id: 8 }], [{ id: 5 }, { id: 6 }]])('no acepta una respuesta ambigua %j', async (data) => {
    await expect(persistirBorrado(cliente({ data }), { tabla: 'turnos', barberiaId: 927, fila })).rejects.toThrow('No se confirmó')
  })
  it('propaga el rechazo de RLS sin fingir éxito', async () => {
    const error = { code: '42501', message: 'denegado' }
    await expect(persistirBorrado(cliente({ error }), { tabla: 'notas', barberiaId: 927, fila })).rejects.toEqual(error)
  })
  it.each([{ tabla: 'clientes', barberiaId: 927, fila }, { tabla: 'notas', barberiaId: null, fila }])('rechaza contexto inválido antes de llegar a la base', async (opciones) => {
    const db = cliente({ data: [] })
    await expect(persistirBorrado(db, opciones)).rejects.toThrow('Contexto')
    expect(db.from).not.toHaveBeenCalled()
  })
})
