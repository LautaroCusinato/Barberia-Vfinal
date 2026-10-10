import { describe, expect, it, vi } from 'vitest'
import { enqueueLatest } from './latestIntentQueue.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('enqueueLatest', () => {
  it('propaga el resultado de la última escritura y no el de una edición descartada', async () => {
    const map = {}
    const first = deferred()
    const execute = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(false)
    const saving = enqueueLatest(map, 'nombre', 'A', execute)
    enqueueLatest(map, 'nombre', 'B', execute)
    first.resolve(true)
    await expect(saving).resolves.toBe(false)
    expect(execute.mock.calls.map(([value]) => value)).toEqual(['A', 'B'])
  })
  it('ejecuta de inmediato el primer valor', async () => {
    const map = {}
    const execute = vi.fn().mockResolvedValue(undefined)
    await enqueueLatest(map, 'horario', 'A', execute)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith('A')
    expect(map.horario).toMatchObject({ inFlight: false, promise: null, latest: 'A' })
  })

  it('mientras hay una escritura en vuelo sólo guarda la intención más reciente', async () => {
    const map = {}
    const pendientes = []
    const execute = vi.fn(() => {
      const d = deferred()
      pendientes.push(d)
      return d.promise
    })

    const p1 = enqueueLatest(map, 'k', 1, execute)
    const p2 = enqueueLatest(map, 'k', 2, execute)
    const p3 = enqueueLatest(map, 'k', 3, execute)
    expect(p2).toBe(p1)
    expect(p3).toBe(p1)
    expect(execute).toHaveBeenCalledTimes(1)

    pendientes[0].resolve()
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(execute).toHaveBeenLastCalledWith(3) // el 2 se descarta
    pendientes[1].resolve()
    await p1
    expect(execute.mock.calls.map(([value]) => value)).toEqual([1, 3])
  })

  it('las claves distintas no se bloquean entre sí', async () => {
    const map = {}
    const lento = deferred()
    const execute = vi.fn((value) => (value === 'a' ? lento.promise : Promise.resolve()))
    const pa = enqueueLatest(map, 'barbero:1', 'a', execute)
    await enqueueLatest(map, 'barbero:2', 'b', execute)
    expect(execute.mock.calls.map(([value]) => value)).toEqual(['a', 'b'])
    lento.resolve()
    await pa
  })

  it('si la escritura falla rechaza y deja la cola lista para reintentar', async () => {
    const map = {}
    const execute = vi.fn().mockRejectedValueOnce(new Error('red caída')).mockResolvedValue(undefined)
    await expect(enqueueLatest(map, 'k', 'v1', execute)).rejects.toThrow('red caída')
    expect(map.k.inFlight).toBe(false)
    await enqueueLatest(map, 'k', 'v2', execute)
    expect(execute).toHaveBeenLastCalledWith('v2')
  })
})
