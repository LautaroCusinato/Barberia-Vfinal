import { describe, expect, it, vi } from 'vitest'
import { CobroError, agregarPagoSinDuplicar, nuevaClaveCobro, registrarCobroTurno, validarCobro } from './cobroTurno.js'

// Servidor falso con la misma regla que la RPC: una clave = un pago, y un
// turno atendido no se vuelve a cobrar. `perderRespuesta` simula que el pago
// se guardó pero la respuesta no llegó al navegador.
function servidorFalso({ perderRespuesta = 0 } = {}) {
  const turnos = new Map([[7, { id: 7, estado: 'confirmado' }]])
  const pagos = []
  let perdidas = perderRespuesta
  const rpc = vi.fn(async (nombre, args) => {
    expect(nombre).toBe('registrar_cobro_turno')
    const turno = turnos.get(args.p_turno_id)
    if (!turno) return { data: null, error: { code: 'P0002', hint: 'turno_no_encontrado', message: 'x' } }
    const previo = pagos.find((p) => p.idempotency_key === args.p_idempotency_key)
    let data
    if (previo) data = { pago: previo, estado: turno.estado, repetido: true }
    else if (turno.estado === 'atendido') return { data: null, error: { code: 'P0001', hint: 'turno_ya_atendido', message: 'x' } }
    else {
      turno.estado = 'atendido'
      const pago = { id: pagos.length + 1, turno_id: turno.id, monto: args.p_monto, metodo: args.p_metodo, idempotency_key: args.p_idempotency_key }
      pagos.push(pago)
      data = { pago, estado: 'atendido', repetido: false }
    }
    if (perdidas > 0) { perdidas -= 1; throw new TypeError('Failed to fetch') }
    return { data, error: null }
  })
  return { supabase: { rpc }, turnos, pagos }
}

const cobro = { turnoId: 7, monto: 1500.5, metodo: 'efectivo' }

describe('registrarCobroTurno', () => {
  it('registra estado y pago en una sola llamada al servidor', async () => {
    const { supabase, turnos, pagos } = servidorFalso()
    const resultado = await registrarCobroTurno(supabase, { ...cobro, clave: 'k-1' })
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.rpc).toHaveBeenCalledWith('registrar_cobro_turno', { p_turno_id: 7, p_monto: 1500.5, p_metodo: 'efectivo', p_idempotency_key: 'k-1' })
    expect(resultado).toEqual({ pago: pagos[0], repetido: false })
    expect(turnos.get(7).estado).toBe('atendido')
  })

  it('respuesta perdida: el reintento con la misma clave no duplica el pago', async () => {
    const { supabase, pagos } = servidorFalso({ perderRespuesta: 1 })
    await expect(registrarCobroTurno(supabase, { ...cobro, clave: 'k-1' })).rejects.toMatchObject({ name: 'CobroError', codigo: 'red' })
    const reintento = await registrarCobroTurno(supabase, { ...cobro, clave: 'k-1' })
    expect(reintento.repetido).toBe(true)
    expect(pagos).toHaveLength(1)
  })

  it('dos operadores: el segundo cobro del mismo turno se rechaza con mensaje claro', async () => {
    const { supabase, pagos } = servidorFalso()
    await registrarCobroTurno(supabase, { ...cobro, clave: 'operador-a' })
    const error = await registrarCobroTurno(supabase, { ...cobro, clave: 'operador-b' }).catch((e) => e)
    expect(error).toBeInstanceOf(CobroError)
    expect(error.codigo).toBe('turno_ya_atendido')
    expect(error.message).toMatch(/ya figura como atendido/)
    expect(pagos).toHaveLength(1)
  })

  it('importe o método inválidos no llegan al servidor', async () => {
    const { supabase } = servidorFalso()
    for (const monto of [-1, Number.NaN, Infinity, 1.005, '100', 1e11]) {
      await expect(registrarCobroTurno(supabase, { ...cobro, monto, clave: 'k' })).rejects.toMatchObject({ codigo: 'monto_invalido' })
    }
    await expect(registrarCobroTurno(supabase, { ...cobro, metodo: 'bitcoin', clave: 'k' })).rejects.toMatchObject({ codigo: 'metodo_invalido' })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['turno_no_encontrado', /No encontramos ese turno/],
    ['sin_permiso', /Tu rol no permite/],
    ['sin_acceso_operativo', /cuenta del negocio/],
    ['monto_invalido', /importe/],
  ])('traduce el rechazo %s del servidor sin exponer detalles técnicos', async (hint, mensaje) => {
    const supabase = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: '42501', hint, message: 'permission denied for table pagos' } }) }
    const error = await registrarCobroTurno(supabase, { ...cobro, clave: 'k' }).catch((e) => e)
    expect(error.codigo).toBe(hint)
    expect(error.message).toMatch(mensaje)
    expect(error.message).not.toMatch(/permission denied/)
  })

  it('errores desconocidos o respuestas sin pago usan el mensaje genérico', async () => {
    const desconocido = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: 'XX000', message: 'boom' } }) }
    await expect(registrarCobroTurno(desconocido, { ...cobro, clave: 'k' })).rejects.toMatchObject({ codigo: 'desconocido', message: expect.stringMatching(/No se pudo registrar el cobro/) })
    const vacio = { rpc: vi.fn().mockResolvedValue({ data: {}, error: null }) }
    await expect(registrarCobroTurno(vacio, { ...cobro, clave: 'k' })).rejects.toMatchObject({ codigo: 'respuesta_invalida' })
  })
})

describe('helpers de cobro', () => {
  it('validarCobro acepta 0 y hasta 2 decimales', () => {
    expect(validarCobro({ monto: 0, metodo: 'efectivo' })).toBeNull()
    expect(validarCobro({ monto: 0.29, metodo: 'transferencia' })).toBeNull()
    expect(validarCobro({ monto: 9999999999.99, metodo: 'mercadopago' })).toBeNull()
  })

  it('nuevaClaveCobro genera UUID v4 distintos', () => {
    const a = nuevaClaveCobro()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(nuevaClaveCobro()).not.toBe(a)
  })

  it('agregarPagoSinDuplicar no repite un pago que Realtime ya trajo', () => {
    const lista = [{ id: 2 }, { id: 1 }]
    expect(agregarPagoSinDuplicar(lista, { id: 2 })).toBe(lista)
    expect(agregarPagoSinDuplicar(lista, { id: 3 }).map((p) => p.id)).toEqual([3, 2, 1])
  })
})
