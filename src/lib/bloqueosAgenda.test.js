import { describe, expect, it } from 'vitest'
import {
  bloqueosVigentes,
  copiaParaRestaurar,
  eliminarBloqueo,
  insertarBloqueos,
  esBloqueoDiaCompleto,
  esErrorPermiso,
  fechasEnRango,
  filasBloqueo,
  planificarBloqueo,
  rangoBloqueo,
  turnosAfectados,
} from './bloqueosAgenda.js'
import { barberoBloqueadoFecha, barberoDisponible, generarSlotsDisponibles } from './text.js'

const HOY = '2026-10-05'

describe('fechasEnRango', () => {
  it('devuelve un solo día sin fecha final', () => {
    expect(fechasEnRango('2026-10-10')).toEqual({ fechas: ['2026-10-10'], error: '' })
  })
  it('incluye ambos extremos y cruza meses y años', () => {
    expect(fechasEnRango('2026-12-30', '2027-01-02').fechas).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
  })
  it('no salta ni repite días en cambios de horario', () => {
    // Fines de semana con cambio de hora en hemisferio norte y sur.
    expect(fechasEnRango('2026-03-07', '2026-03-09').fechas).toHaveLength(3)
    expect(fechasEnRango('2026-10-03', '2026-10-05').fechas).toHaveLength(3)
  })
  it('rechaza fechas inválidas, invertidas o rangos demasiado largos', () => {
    expect(fechasEnRango('2026-02-30').error).toMatch(/válida/)
    expect(fechasEnRango('2026-10-10', '2026-10-01').error).toMatch(/anterior/)
    expect(fechasEnRango('2026-01-01', '2026-12-31').error).toMatch(/hasta 62/)
  })
})

describe('planificarBloqueo', () => {
  const bloqueos = [
    { id: 1, fecha: '2026-10-10', barbero_id: null, start_time: '00:00', end_time: '23:59' },
    { id: 2, fecha: '2026-10-11', barbero_id: 7, start_time: '00:00:00', end_time: '23:59:00' },
    { id: 3, fecha: '2026-10-12', barbero_id: 7, start_time: '13:00', end_time: '15:00' },
  ]
  it('no duplica días ya cubiertos por un bloqueo completo del mismo alcance o del negocio', () => {
    const plan = planificarBloqueo({ desde: '2026-10-10', hasta: '2026-10-12', barberoId: 7, bloqueos, todayKey: HOY })
    expect(plan.yaBloqueadas).toEqual(['2026-10-10', '2026-10-11'])
    // Un bloqueo parcial no cubre el día: se agrega el completo y el parcial se conserva.
    expect(plan.nuevas).toEqual(['2026-10-12'])
  })
  it('un bloqueo de un profesional no cubre al negocio completo', () => {
    const plan = planificarBloqueo({ desde: '2026-10-11', barberoId: null, bloqueos, todayKey: HOY })
    expect(plan.nuevas).toEqual(['2026-10-11'])
  })
  it('rechaza fechas pasadas', () => {
    expect(planificarBloqueo({ desde: '2026-10-04', bloqueos, todayKey: HOY }).error).toMatch(/pasaron/)
  })
})

describe('turnosAfectados', () => {
  const turnos = [
    { id: 1, fecha: '2026-10-10', hora: '10:00', barbero_id: 7, estado: 'confirmado' },
    { id: 2, fecha: '2026-10-10', hora: '09:00', barbero_id: 8, estado: 'pendiente' },
    { id: 3, fecha: '2026-10-10', hora: '11:00', barbero_id: 7, estado: 'cancelado' },
    { id: 4, fecha: '2026-10-10', hora: '12:00', barbero_id: 7, estado: 'no_asistio' },
    { id: 5, fecha: '2026-10-11', hora: '10:00', barbero_id: 7, estado: 'confirmado' },
  ]
  it('lista los turnos activos del negocio en orden', () => {
    expect(turnosAfectados(turnos, ['2026-10-10']).map((t) => t.id)).toEqual([2, 1])
  })
  it('para un profesional, sólo sus turnos', () => {
    expect(turnosAfectados(turnos, ['2026-10-10', '2026-10-11'], 7).map((t) => t.id)).toEqual([1, 5])
    expect(turnosAfectados(turnos, ['2026-10-10'], '8').map((t) => t.id)).toEqual([2])
  })
})

describe('filasBloqueo', () => {
  it('arma filas de día completo con tipos permitidos por la tabla', () => {
    const filas = filasBloqueo({ fechas: ['2026-10-10', '2026-10-11'], barberoId: '', tipo: 'feriado', detalle: '  Día   de la  Raza ', barberiaId: 4 })
    expect(filas).toEqual([
      { barberia_id: 4, barbero_id: null, fecha: '2026-10-10', motivo: 'Día de la Raza', tipo: 'feriado', start_time: '00:00', end_time: '23:59' },
      { barberia_id: 4, barbero_id: null, fecha: '2026-10-11', motivo: 'Día de la Raza', tipo: 'feriado', start_time: '00:00', end_time: '23:59' },
    ])
  })
  it('usa la etiqueta como motivo si no hay detalle y normaliza tipos desconocidos', () => {
    const [fila] = filasBloqueo({ fechas: ['2026-10-10'], barberoId: 7, tipo: 'parcial', detalle: '', barberiaId: 4 })
    expect(fila).toMatchObject({ barbero_id: 7, tipo: 'bloqueo', motivo: 'Otro motivo' })
  })
  it('los bloqueos creados vuelven indisponible el día completo en el panel', () => {
    const barbero = { id: 7, activo: true, agendaCargada: true, agenda: [{ day_of_week: 6, start_time: '09:00', end_time: '18:00', activo: true }] }
    const filas = filasBloqueo({ fechas: ['2026-10-10'], barberoId: 7, tipo: 'vacaciones', barberiaId: 4 })
    expect(barberoBloqueadoFecha(filas, 7, '2026-10-10')).toBe(true)
    expect(generarSlotsDisponibles(barbero, '2026-10-10', 30, filas, 15, 'UTC', true)).toEqual([])
    expect(barberoDisponible(barbero, '2026-10-10', '17:30', 30, filas, 'UTC', true)).toBe(false)
    // Otro profesional sigue disponible.
    expect(barberoBloqueadoFecha(filas, 8, '2026-10-10')).toBe(false)
  })
})

describe('representación y desbloqueo', () => {
  const global = { id: 1, fecha: '2026-10-10', barbero_id: null, start_time: '00:00:00', end_time: '23:59:00', tipo: 'cierre', motivo: 'Cierre', barberia_id: 4, created_at: 'x' }
  const parcial = { id: 2, fecha: '2026-10-10', barbero_id: 7, start_time: '13:00:00', end_time: '15:00:00', tipo: 'bloqueo', motivo: 'Capacitación', barberia_id: 4 }
  it('distingue día completo y parcial', () => {
    expect(esBloqueoDiaCompleto(global)).toBe(true)
    expect(esBloqueoDiaCompleto(parcial)).toBe(false)
    expect(rangoBloqueo(global)).toBe('Todo el día')
    expect(rangoBloqueo(parcial)).toBe('13:00–15:00')
  })
  it('lista sólo vigentes, primero el negocio completo', () => {
    const viejo = { ...global, id: 9, fecha: '2026-10-01' }
    expect(bloqueosVigentes([parcial, viejo, global], HOY).map((b) => b.id)).toEqual([1, 2])
  })
  it('quitar un bloqueo deja vigentes los superpuestos', () => {
    const restantes = [global, parcial].filter((b) => b.id !== 2)
    expect(barberoBloqueadoFecha(restantes, 7, '2026-10-10')).toBe(true)
    const sinGlobal = [global, parcial].filter((b) => b.id !== 1)
    const barbero = { id: 7, activo: true, agendaCargada: true, agenda: [{ day_of_week: 6, start_time: '09:00', end_time: '18:00', activo: true }] }
    expect(barberoDisponible(barbero, '2026-10-10', '14:00', 30, sinGlobal, 'UTC', true)).toBe(false)
    expect(barberoDisponible(barbero, '2026-10-10', '10:00', 30, sinGlobal, 'UTC', true)).toBe(true)
  })
  it('la copia para deshacer conserva rango y alcance sin id ni marcas de tiempo', () => {
    expect(copiaParaRestaurar(parcial)).toEqual({ barberia_id: 4, barbero_id: 7, fecha: '2026-10-10', motivo: 'Capacitación', tipo: 'bloqueo', start_time: '13:00:00', end_time: '15:00:00' })
    expect(copiaParaRestaurar({ ...global, tipo: 'total' }).tipo).toBe('bloqueo')
  })
  it('reconoce errores de permiso', () => {
    expect(esErrorPermiso({ code: '42501' })).toBe(true)
    expect(esErrorPermiso({ message: 'new row violates row-level security policy' })).toBe(true)
    expect(esErrorPermiso({ message: 'network' })).toBe(false)
  })
})

// Cliente mínimo con la forma encadenada de supabase-js.
function fakeClient(respuestas) {
  const llamadas = []
  const cola = [...respuestas]
  const builder = (op) => {
    const call = { op, filtros: [] }
    llamadas.push(call)
    const chain = {
      insert(filas) { call.filas = filas; return chain },
      delete() { call.op = 'delete'; return chain },
      select(cols) { call.select = cols ?? '*'; return chain },
      eq(col, val) { call.filtros.push([col, val]); return chain },
      maybeSingle() { call.single = true; return chain },
      then(resolve, reject) {
        const next = cola.shift()
        if (next instanceof Error) return Promise.reject(next).then(resolve, reject)
        return Promise.resolve(next).then(resolve, reject)
      },
    }
    return chain
  }
  return { client: { from: (tabla) => { expect(tabla).toBe('bloqueos_agenda'); return builder('from') } }, llamadas }
}

describe('insertarBloqueos', () => {
  const filas = filasBloqueo({ fechas: ['2026-10-10', '2026-10-11'], tipo: 'cierre', barberiaId: 4 })
  it('envía todas las fechas en un solo insert y devuelve lo guardado', async () => {
    const { client, llamadas } = fakeClient([{ data: [{ id: 1 }, { id: 2 }], error: null }])
    expect(await insertarBloqueos(client, filas)).toEqual({ ok: true, data: [{ id: 1 }, { id: 2 }] })
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].filas).toHaveLength(2)
  })
  it('distingue el rechazo por permisos de un error técnico o de red', async () => {
    expect((await insertarBloqueos(fakeClient([{ data: null, error: { code: '42501', message: 'new row violates row-level security policy' } }]).client, filas)).motivo).toBe('permiso')
    expect((await insertarBloqueos(fakeClient([{ data: null, error: { code: '23514', message: 'check' } }]).client, filas)).motivo).toBe('error')
    expect((await insertarBloqueos(fakeClient([new TypeError('Failed to fetch')]).client, filas))).toMatchObject({ ok: false, motivo: 'error' })
  })
})

describe('eliminarBloqueo', () => {
  it('borra sólo la fila elegida del negocio y confirma con la fila devuelta', async () => {
    const { client, llamadas } = fakeClient([{ data: [{ id: 5 }], error: null }])
    expect(await eliminarBloqueo(client, 5, 4)).toEqual({ ok: true })
    expect(llamadas[0]).toMatchObject({ op: 'delete', filtros: [['id', 5], ['barberia_id', 4]], select: 'id' })
  })
  it('0 filas y la fila sigue visible: RLS no permitió borrar (sin falso éxito)', async () => {
    const { client } = fakeClient([{ data: [], error: null }, { data: { id: 5 }, error: null }])
    expect(await eliminarBloqueo(client, 5, 4)).toEqual({ ok: false, motivo: 'permiso' })
  })
  it('0 filas y ya no existe: otra persona lo había quitado', async () => {
    const { client } = fakeClient([{ data: [], error: null }, { data: null, error: null }])
    expect(await eliminarBloqueo(client, 5, 4)).toEqual({ ok: true, yaNoExistia: true })
  })
  it('error de red: el bloqueo sigue vigente', async () => {
    const { client } = fakeClient([new TypeError('Failed to fetch')])
    expect(await eliminarBloqueo(client, 5, 4)).toMatchObject({ ok: false, motivo: 'error' })
  })
})
