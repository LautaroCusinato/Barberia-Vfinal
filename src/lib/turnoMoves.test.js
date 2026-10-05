import { describe, expect, it, vi } from 'vitest'
import { confirmarMovimiento, crearColaMovimientos, mismaVersionTurno, persistirMovimiento, TURNO_CAMBIO, TURNO_SIN_PERMISO } from './turnoMoves.js'

const fecha = '2026-10-12'
const turno = { id: 7, barberia_id: 927, barbero_id: 3, fecha, hora: '09:00', estado: 'confirmado', updated_at: '2026-10-05T12:00:00Z' }
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
    if (!filas.has(id)) return false
    const resultado = confirmarMovimiento([filas.get(id)], id, origen, guardado)
    if (resultado.ok) filas.set(id, resultado.turnos[0])
    return resultado.ok
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

  it.each(['edicion', 'eliminacion', 'movido por otro operador', 'reasignado a otro profesional'])('invalida Deshacer por %s sin nuevas escrituras', async (tipo) => {
    const h = preparar()
    const movimiento = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    h.exito(0)
    await movimiento
    const { onUndo } = h.onMovido.mock.calls[0][0]
    if (tipo === 'edicion') h.cola.invalidar(7)
    if (tipo === 'eliminacion') h.filas.delete(7)
    if (tipo === 'movido por otro operador') h.filas.set(7, { ...h.filas.get(7), hora: '12:00', updated_at: '2026-10-05T12:30:00Z' })
    if (tipo === 'reasignado a otro profesional') h.filas.set(7, { ...h.filas.get(7), barbero_id: 4, updated_at: '2026-10-05T12:30:00Z' })
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

  it.each([
    ['un cambio de estado local', (fila) => ({ ...fila, estado: 'atendido' })],
    ['una edición sin cambio de horario llegada por Realtime', (fila) => ({ ...fila, precio: 9000, updated_at: '2026-10-05T12:00:01.5Z' })],
  ])('Deshacer sigue disponible después de %s', async (_nombre, cambiar) => {
    const h = preparar()
    const movimiento = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    h.exito(0)
    await movimiento
    h.filas.set(7, cambiar(h.filas.get(7)))
    const vuelta = h.onMovido.mock.calls[0][0].onUndo()
    await Promise.resolve()
    expect(h.peticiones[1].origen).toMatchObject({ hora: '10:00' })
    expect(h.peticiones[1].posicion.hora).toBe('09:00')
    h.exito(1)
    expect(await vuelta).toBe(true)
    expect(h.filas.get(7).hora).toBe('09:00')
    expect(h.onObsoleto).not.toHaveBeenCalled()
  })

  it('una versión posterior que ya muestra el destino confirma el movimiento sin retroceder la fila', async () => {
    const h = preparar()
    const movimiento = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    // Realtime trajo el movimiento y además un cambio de estado de otro operador.
    const posterior = { ...turno, hora: '10:00:00', estado: 'atendido', updated_at: '2026-10-05T13:00:00.5+00:00' }
    h.filas.set(7, posterior)
    h.exito(0)
    expect(await movimiento).toBe(true)
    expect(h.filas.get(7)).toEqual(posterior)
    expect(h.onObsoleto).not.toHaveBeenCalled()
    expect(h.onMovido).toHaveBeenCalledTimes(1)
  })

  it('una versión posterior que devolvió el turno al origen no se pisa con la respuesta atrasada', async () => {
    const h = preparar()
    const movimiento = h.cola.mover(7, destino('10:00'))
    await Promise.resolve()
    const posterior = { ...turno, updated_at: '2026-10-05 13:00:00.123+00' }
    h.filas.set(7, posterior)
    h.exito(0)
    expect(await movimiento).toBe(false)
    expect(h.filas.get(7)).toEqual(posterior)
    expect(h.onObsoleto).toHaveBeenCalledTimes(1)
  })

  it('compara versiones con microsegundos y distintos formatos de zona', () => {
    const origen = { ...turno }
    const guardado = { ...turno, hora: '10:00:00', updated_at: '2026-10-05T12:00:00.123456+00:00' }
    const masNueva = { ...turno, updated_at: '2026-10-05 12:00:00.123457+00' }
    expect(confirmarMovimiento([masNueva], 7, origen, guardado).ok).toBe(false)
    const igual = { ...turno, updated_at: '2026-10-05T09:00:00.123456-03:00' }
    expect(confirmarMovimiento([igual], 7, origen, guardado)).toMatchObject({ ok: true, turnos: [{ hora: '10:00:00' }] })
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
  // Fila única en memoria: aplica los filtros eq, simula RLS de escritura y
  // el trigger que renueva updated_at en cada UPDATE.
  function baseSimulada(fila = { ...turno }, { escrituraPermitida = true } = {}) {
    const estado = { fila: fila && { ...fila }, updates: [], selects: 0, version: 0 }
    const normalizar = (key, value) => (key === 'hora' ? String(value).slice(0, 5) : String(value))
    const from = vi.fn(() => {
      const filtros = []
      let valores = null
      const query = {
        update: vi.fn((payload) => { valores = payload; return query }),
        select: vi.fn(() => query),
        eq: vi.fn((key, value) => { filtros.push([key, value]); return query }),
        maybeSingle: vi.fn(async () => {
          const f = estado.fila
          const coincide = Boolean(f) && filtros.every(([key, value]) => normalizar(key, f[key]) === normalizar(key, value))
          if (!valores) {
            estado.selects += 1
            return { data: coincide ? { ...f } : null, error: null }
          }
          estado.updates.push({ valores, filtros: Object.fromEntries(filtros) })
          if (!coincide || !escrituraPermitida) return { data: null, error: null }
          estado.version += 1
          estado.fila = { ...f, ...valores, updated_at: `2026-10-05T14:00:0${estado.version}.000001+00:00` }
          return { data: { ...estado.fila }, error: null }
        }),
      }
      return query
    })
    return { supabase: { from }, estado }
  }
  const peticion = { barberiaId: 927, turnoId: 7, origen: turno, destino: destino('10:00') }

  it('confirma la fila devuelta y limita el cambio a fecha/hora dentro del tenant y versión', async () => {
    const h = baseSimulada()
    const resultado = await persistirMovimiento(h.supabase, peticion)
    expect(resultado.hora).toBe('10:00')
    expect(resultado.updated_at).toBe('2026-10-05T14:00:01.000001+00:00')
    expect(h.supabase.from).toHaveBeenCalledWith('turnos')
    expect(h.estado.updates).toHaveLength(1)
    expect(h.estado.updates[0].valores).toEqual({ fecha, hora: '10:00' })
    expect(h.estado.updates[0].filtros).toMatchObject({ barberia_id: 927, id: 7, updated_at: turno.updated_at, fecha, hora: '09:00' })
    expect(h.estado.selects).toBe(0)
  })

  it.each([
    ['editarlo', { precio: 9000 }],
    ['cambiarle el estado', { estado: 'en_curso' }],
    ['cobrarlo', { estado: 'atendido' }],
  ])('mover después de %s en este panel reintenta una vez con la versión del servidor', async (_accion, cambio) => {
    // El panel aplica el cambio localmente pero no recibe el updated_at nuevo.
    const h = baseSimulada({ ...turno, ...cambio, updated_at: '2026-10-05T12:10:00.5+00:00' })
    const resultado = await persistirMovimiento(h.supabase, { ...peticion, origen: { ...turno, ...cambio } })
    expect(resultado).toMatchObject({ hora: '10:00', estado: cambio.estado ?? 'confirmado' })
    expect(h.estado.updates).toHaveLength(2)
    expect(h.estado.updates[1].filtros.updated_at).toBe('2026-10-05T12:10:00.5+00:00')
    expect(h.estado.updates.every((u) => Object.keys(u.valores).join() === 'fecha,hora')).toBe(true)
  })

  it.each([
    ['otro tenant', { ...turno, barberia_id: 819 }],
    ['otro operador lo movió', { ...turno, hora: '11:00', updated_at: 'otra-version' }],
    ['otro operador lo movió de día al mismo horario', { ...turno, fecha: '2026-10-13', updated_at: 'otra-version' }],
    ['otro operador lo reasignó', { ...turno, barbero_id: 4, updated_at: 'otra-version' }],
    ['otro operador le cambió el estado', { ...turno, estado: 'cancelado', updated_at: 'otra-version' }],
    ['turno eliminado o invisible', null],
  ])('no interpreta cero filas como éxito ni reintenta: %s', async (_nombre, fila) => {
    const h = baseSimulada(fila)
    await expect(persistirMovimiento(h.supabase, peticion)).rejects.toMatchObject({ code: TURNO_CAMBIO })
    expect(h.estado.updates).toHaveLength(1)
    expect(h.estado.fila).toEqual(fila)
  })

  it('una fila visible y sin cambios que RLS no deja escribir se informa como falta de permiso', async () => {
    const h = baseSimulada({ ...turno }, { escrituraPermitida: false })
    await expect(persistirMovimiento(h.supabase, peticion)).rejects.toMatchObject({ code: TURNO_SIN_PERMISO })
    expect(h.estado.updates).toHaveLength(1)
    expect(h.estado.fila).toEqual(turno)
  })

  it('si el reintento también devuelve cero filas, se rechaza sin un tercer intento', async () => {
    const h = baseSimulada({ ...turno, updated_at: 'v-servidor' }, { escrituraPermitida: false })
    await expect(persistirMovimiento(h.supabase, peticion)).rejects.toMatchObject({ code: TURNO_CAMBIO })
    expect(h.estado.updates).toHaveLength(2)
  })

  it.each([{ ...peticion, barberiaId: null }, { ...peticion, origen: { ...turno, updated_at: null } }])('no escribe sin tenant o versión', async (pedido) => {
    const h = baseSimulada()
    await expect(persistirMovimiento(h.supabase, pedido)).rejects.toMatchObject({ code: TURNO_CAMBIO })
    expect(h.supabase.from).not.toHaveBeenCalled()
  })

  it.each([{ code: '42501' }, { code: '23P01' }, new Error('red')])('propaga rechazos para informar sin cambiar el estado confirmado: %j', async (error) => {
    const query = { update: () => query, eq: () => query, select: () => query, maybeSingle: async () => ({ data: null, error }) }
    await expect(persistirMovimiento({ from: () => query }, peticion)).rejects.toBe(error)
  })
})
