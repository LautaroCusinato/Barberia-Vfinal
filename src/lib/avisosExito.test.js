import { describe, expect, it, vi } from 'vitest'
import { DURACION_AVISO_MS, MENSAJES_EXITO, conAvisoExito } from './avisosExito.js'

describe('conAvisoExito', () => {
  it('avisa una sola vez, con la duración de 5 s, cuando el guardado se confirma', async () => {
    const mostrar = vi.fn()
    const resultado = await conAvisoExito(async () => true, MENSAJES_EXITO.clienteCreado, mostrar)
    expect(resultado).toBe(true)
    expect(mostrar).toHaveBeenCalledTimes(1)
    expect(mostrar).toHaveBeenCalledWith({ mensaje: 'Cliente agregado', duracion: DURACION_AVISO_MS })
    expect(DURACION_AVISO_MS).toBe(5000)
  })

  it('no avisa si la mutación falla y devuelve false para conservar el borrador', async () => {
    const mostrar = vi.fn()
    expect(await conAvisoExito(async () => false, 'x', mostrar)).toBe(false)
    expect(mostrar).not.toHaveBeenCalled()
  })

  it('no avisa ante un resultado que no confirma el guardado', async () => {
    const mostrar = vi.fn()
    expect(await conAvisoExito(async () => undefined, 'x', mostrar)).toBeUndefined()
    expect(mostrar).not.toHaveBeenCalled()
  })

  it('no avisa y propaga el error si la mutación lanza', async () => {
    const mostrar = vi.fn()
    await expect(conAvisoExito(async () => { throw new Error('red') }, 'x', mostrar)).rejects.toThrow('red')
    expect(mostrar).not.toHaveBeenCalled()
  })

  it('espera la persistencia antes de avisar', async () => {
    const mostrar = vi.fn()
    let confirmar
    const pendiente = conAvisoExito(() => new Promise((resolve) => { confirmar = resolve }), 'x', mostrar)
    await Promise.resolve()
    expect(mostrar).not.toHaveBeenCalled()
    confirmar(true)
    await pendiente
    expect(mostrar).toHaveBeenCalledTimes(1)
  })
})

describe('MENSAJES_EXITO', () => {
  it('describe el estado elegido', () => {
    expect(MENSAJES_EXITO.estadoTurno('No asistió')).toBe('Turno marcado como No asistió')
  })
})
