import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  barberoBloqueadoFecha,
  barberoDisponible,
  barberoTrabajaFecha,
  generarSlotsDisponibles,
  parseHorarioBarbero,
  parseHorarioTexto,
} from './text.js'

// Fechas fijas lejos de "hoy" para que el filtro de horarios pasados no
// intervenga salvo en los tests que congelan el reloj.
const LUNES = '2030-01-07'
const MARTES = '2030-01-08'
const VIERNES = '2030-01-11'
const SABADO = '2030-01-12'
const DOMINGO = '2030-01-06'

const legacy = (horario, extra = {}) => ({ id: 7, nombre: 'Mateo', horario, ...extra })
const conAgenda = (agenda, extra = {}) => ({ id: 7, nombre: 'Mateo', horario: 'texto ignorado', agendaCargada: true, agenda, ...extra })
const franja = (day_of_week, start_time, end_time, extra = {}) => ({ day_of_week, start_time, end_time, ...extra })

afterEach(() => {
  vi.useRealTimers()
})

describe('fechas de prueba', () => {
  it('caen en el día de la semana esperado', () => {
    const dia = (fecha) => new Date(`${fecha}T00:00:00Z`).getUTCDay()
    expect([dia(DOMINGO), dia(LUNES), dia(MARTES), dia(VIERNES), dia(SABADO)]).toEqual([0, 1, 2, 5, 6])
  })
})

describe('parseHorarioTexto (texto del panel -> horarios_barbero)', () => {
  it('convierte una lista de días con una jornada', () => {
    expect(parseHorarioTexto('Lun, Mar y Vie 09:00-18:00')).toEqual([
      { day_of_week: 1, start_time: '09:00', end_time: '18:00' },
      { day_of_week: 2, start_time: '09:00', end_time: '18:00' },
      { day_of_week: 5, start_time: '09:00', end_time: '18:00' },
    ])
  })

  it('reconoce acentos y el fin de semana (domingo = 0)', () => {
    expect(parseHorarioTexto('Mié, Sáb y Dom 10:00-14:00').map((f) => f.day_of_week)).toEqual([3, 6, 0])
  })

  it('parte la jornada en dos franjas cuando hay break y completa horas de un dígito', () => {
    expect(parseHorarioTexto('Lun y Jue 9:00-18:00 break 13:00-14:00')).toEqual([
      { day_of_week: 1, start_time: '09:00', end_time: '13:00' },
      { day_of_week: 1, start_time: '14:00', end_time: '18:00' },
      { day_of_week: 4, start_time: '09:00', end_time: '13:00' },
      { day_of_week: 4, start_time: '14:00', end_time: '18:00' },
    ])
  })

  it('acepta el formato que genera el editor de horarios para los siete días', () => {
    const franjas = parseHorarioTexto('Lun, Mar, Mié, Jue, Vie, Sáb y Dom 09:00-18:00 break 13:00-14:00')
    expect(franjas).toHaveLength(14)
    expect(new Set(franjas.map((f) => f.day_of_week))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]))
  })

  it.each([
    ['', 'vacío'],
    ['cualquier cosa', 'sin días ni horas'],
    ['Lun y Mar', 'sin rango horario'],
    ['09:00-18:00', 'sin días'],
    ['Lun 18:00-09:00', 'jornada invertida'],
    ['Lun 09:00-09:00', 'jornada vacía'],
    ['Lun 09:00-18:00 break 08:00-10:00', 'break que empieza antes de abrir'],
    ['Lun 09:00-18:00 break 17:00-19:00', 'break que termina después de cerrar'],
    ['Lun 09:00-18:00 break 14:00-13:00', 'break invertido'],
  ])('devuelve null si el texto no es convertible: %s (%s)', (texto) => {
    expect(parseHorarioTexto(texto)).toBeNull()
  })

  // Hallazgo (no corregido, ver reporte): el editor de horarios serializa
  // "Sin dias asignados 09:00-18:00" cuando se destildan todos los días. Este
  // parser devuelve null, App.jsx muestra "no pudimos convertirlo en agenda" y
  // horarios_barbero conserva los días anteriores, que se siguen ofreciendo.
  it.todo('"Sin dias asignados 09:00-18:00" vacía la agenda en lugar de devolver null')

  // Hallazgo (latente): parseHorarioBarbero interpreta "Lun a Vie" como un
  // rango (lun-vie) pero este parser sólo detecta los nombres, así que el
  // mismo texto se guardaría como lunes y viernes. El editor actual nunca
  // genera rangos con "a".
  it.todo('"Lun a Vie 09:00-18:00" se convierte en las cinco jornadas, igual que parseHorarioBarbero')
})

describe('parseHorarioBarbero (fallback legacy por texto)', () => {
  const jornada = { ini: 9 * 60, fin: 18 * 60 }

  it('lista con "y"', () => {
    expect(parseHorarioBarbero('Lun, Mar, Mié, Jue y Vie 09:00-18:00')).toEqual({
      1: [jornada], 2: [jornada], 3: [jornada], 4: [jornada], 5: [jornada],
    })
  })

  it('lista con break', () => {
    const mapa = parseHorarioBarbero('Sáb y Dom 09:00-18:00 break 13:00-14:00')
    expect(Object.keys(mapa).sort()).toEqual(['0', '6'])
    expect(mapa[6]).toEqual([jornada, { ini: 13 * 60, fin: 14 * 60, break: true }])
  })

  it('rango de días con "a", con nombres cortos o completos', () => {
    expect(Object.keys(parseHorarioBarbero('Lun a Vie 09:00-17:00')).map(Number)).toEqual([1, 2, 3, 4, 5])
    expect(Object.keys(parseHorarioBarbero('Lunes a Miércoles 09:00-17:00')).map(Number)).toEqual([1, 2, 3])
  })

  it('rango que cruza el fin de semana', () => {
    expect(Object.keys(parseHorarioBarbero('Vie a Lun 10:00-14:00')).map(Number).sort()).toEqual([0, 1, 5, 6])
  })

  it('un solo día', () => {
    expect(parseHorarioBarbero('Sáb 10:00-14:00')).toEqual({ 6: [{ ini: 600, fin: 840 }] })
  })

  it.each([
    [''],
    [null],
    [42],
    ['Sin dias asignados 09:00-18:00'],
    ['Foo a Bar 09:00-10:00'],
    ['Feriado 09:00-10:00'],
    ['texto libre'],
  ])('devuelve null para %j', (horario) => {
    expect(parseHorarioBarbero(horario)).toBeNull()
  })
})

describe('barberoTrabajaFecha', () => {
  it('usa el texto legacy cuando no hay agenda cargada', () => {
    const barbero = legacy('Lun, Mar y Vie 09:00-18:00')
    expect(barberoTrabajaFecha(barbero, LUNES)).toBe(true)
    expect(barberoTrabajaFecha(barbero, VIERNES)).toBe(true)
    expect(barberoTrabajaFecha(barbero, SABADO)).toBe(false)
  })

  it('la agenda relacional es la fuente de verdad cuando está cargada', () => {
    const barbero = conAgenda([franja(6, '10:00', '14:00')], { horario: 'Lun a Vie 09:00-18:00' })
    expect(barberoTrabajaFecha(barbero, SABADO)).toBe(true)
    expect(barberoTrabajaFecha(barbero, LUNES)).toBe(false)
    expect(barberoTrabajaFecha(conAgenda([]), LUNES)).toBe(false)
  })

  it('ignora franjas inactivas o vacías', () => {
    const barbero = conAgenda([franja(1, '09:00', '18:00', { activo: false }), franja(2, '12:00', '12:00')])
    expect(barberoTrabajaFecha(barbero, LUNES)).toBe(false)
    expect(barberoTrabajaFecha(barbero, MARTES)).toBe(false)
  })

  it('devuelve false con fecha inválida o sin barbero', () => {
    expect(barberoTrabajaFecha(legacy('Lun a Dom 09:00-18:00'), '')).toBe(false)
    expect(barberoTrabajaFecha(legacy('Lun a Dom 09:00-18:00'), 'no-es-fecha')).toBe(false)
    expect(barberoTrabajaFecha(null, LUNES)).toBe(false)
  })
})

describe('barberoBloqueadoFecha (día libre completo)', () => {
  it('bloquea al barbero con un bloqueo de día completo', () => {
    const bloqueos = [{ fecha: LUNES, barbero_id: 7, start_time: '00:00', end_time: '23:59' }]
    expect(barberoBloqueadoFecha(bloqueos, 7, LUNES)).toBe(true)
    expect(barberoBloqueadoFecha(bloqueos, '7', LUNES)).toBe(true)
    expect(barberoBloqueadoFecha(bloqueos, 8, LUNES)).toBe(false)
    expect(barberoBloqueadoFecha(bloqueos, 7, MARTES)).toBe(false)
  })

  it('un bloqueo sin barbero_id aplica a toda la barbería', () => {
    const bloqueos = [{ fecha: LUNES, barbero_id: null, start_time: '00:00:00', end_time: '23:59:59' }]
    expect(barberoBloqueadoFecha(bloqueos, 1, LUNES)).toBe(true)
    expect(barberoBloqueadoFecha(bloqueos, 99, LUNES)).toBe(true)
  })

  it('sin horario explícito el bloqueo es de día completo', () => {
    expect(barberoBloqueadoFecha([{ fecha: LUNES, barbero_id: 7 }], 7, LUNES)).toBe(true)
  })

  it('un bloqueo parcial no saca al barbero del día', () => {
    const bloqueos = [{ fecha: LUNES, barbero_id: 7, start_time: '13:00', end_time: '15:00' }]
    expect(barberoBloqueadoFecha(bloqueos, 7, LUNES)).toBe(false)
  })

  it('devuelve false sin bloqueos o sin fecha', () => {
    expect(barberoBloqueadoFecha([], 7, LUNES)).toBe(false)
    expect(barberoBloqueadoFecha(undefined, 7, LUNES)).toBe(false)
    expect(barberoBloqueadoFecha([{ fecha: LUNES, barbero_id: 7 }], 7, '')).toBe(false)
  })
})

describe('barberoDisponible', () => {
  const barbero = legacy('Lun, Mar, Mié, Jue y Vie 09:00-18:00 break 13:00-14:00')

  it('acepta un turno que entra completo en la jornada', () => {
    expect(barberoDisponible(barbero, LUNES, '09:00', 30)).toBe(true)
    expect(barberoDisponible(barbero, LUNES, '17:30', 30)).toBe(true) // termina justo al cierre
  })

  it('rechaza un turno que se pasa del cierre', () => {
    expect(barberoDisponible(barbero, LUNES, '17:45', 30)).toBe(false)
    expect(barberoDisponible(barbero, LUNES, '18:00', 30)).toBe(false)
    expect(barberoDisponible(barbero, LUNES, '08:45', 30)).toBe(false)
  })

  it('rechaza un turno que atraviesa el break aunque arranque antes', () => {
    expect(barberoDisponible(barbero, LUNES, '12:45', 30)).toBe(false)
    expect(barberoDisponible(barbero, LUNES, '13:15', 15)).toBe(false)
    expect(barberoDisponible(barbero, LUNES, '12:30', 30)).toBe(true) // termina al empezar el break
    expect(barberoDisponible(barbero, LUNES, '14:00', 30)).toBe(true) // arranca al terminar el break
  })

  it('rechaza días que no trabaja y datos incompletos', () => {
    expect(barberoDisponible(barbero, SABADO, '10:00', 30)).toBe(false)
    expect(barberoDisponible(null, LUNES, '10:00', 30)).toBe(false)
    expect(barberoDisponible(barbero, '', '10:00', 30)).toBe(false)
    expect(barberoDisponible(barbero, LUNES, '', 30)).toBe(false)
  })

  it('respeta bloqueos parciales del barbero o de toda la barbería', () => {
    const bloqueos = [{ fecha: LUNES, barbero_id: 7, start_time: '10:00', end_time: '11:00' }]
    expect(barberoDisponible(barbero, LUNES, '10:30', 30, bloqueos)).toBe(false)
    expect(barberoDisponible(barbero, LUNES, '09:45', 30, bloqueos)).toBe(false) // pisa el inicio del bloqueo
    expect(barberoDisponible(barbero, LUNES, '09:30', 30, bloqueos)).toBe(true) // termina justo al bloquearse
    expect(barberoDisponible(barbero, LUNES, '11:00', 30, bloqueos)).toBe(true)
    expect(barberoDisponible(barbero, LUNES, '10:30', 30, [{ ...bloqueos[0], barbero_id: 8 }])).toBe(true)
    expect(barberoDisponible(barbero, LUNES, '10:30', 30, [{ ...bloqueos[0], barbero_id: null }])).toBe(false)
  })

  it('usa la agenda cargada en lugar del texto', () => {
    const agenda = conAgenda([franja(6, '10:00', '14:00')])
    expect(barberoDisponible(agenda, SABADO, '13:30', 30)).toBe(true)
    expect(barberoDisponible(agenda, SABADO, '13:45', 30)).toBe(false)
    expect(barberoDisponible(agenda, LUNES, '10:00', 30)).toBe(false)
  })

  it('no ofrece horarios ya pasados de hoy en la zona horaria del negocio', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-01-07T15:00:00Z')) // 12:00 en Buenos Aires
    expect(barberoDisponible(barbero, LUNES, '11:30', 30)).toBe(false)
    expect(barberoDisponible(barbero, LUNES, '12:00', 30)).toBe(true)
    expect(barberoDisponible(barbero, LUNES, '11:30', 30, [], 'America/Argentina/Buenos_Aires', true)).toBe(true)
    // En UTC ya son las 15:00.
    expect(barberoDisponible(barbero, LUNES, '14:30', 30, [], 'UTC')).toBe(false)
    expect(barberoDisponible(barbero, LUNES, '15:00', 30, [], 'UTC')).toBe(true)
  })
})

describe('generarSlotsDisponibles', () => {
  const barbero = legacy('Lun a Vie 09:00-11:00')

  it('genera slots cada 15 minutos que entran completos antes del cierre', () => {
    expect(generarSlotsDisponibles(barbero, LUNES, 30)).toEqual([
      '09:00', '09:15', '09:30', '09:45', '10:00', '10:15', '10:30',
    ])
  })

  it('respeta el paso y la duración', () => {
    expect(generarSlotsDisponibles(barbero, LUNES, 60, [], 30)).toEqual(['09:00', '09:30', '10:00'])
    expect(generarSlotsDisponibles(barbero, LUNES, 120, [], 30)).toEqual(['09:00'])
    expect(generarSlotsDisponibles(barbero, LUNES, 121, [], 30)).toEqual([])
  })

  it('usa 30 minutos cuando la duración no es válida', () => {
    expect(generarSlotsDisponibles(barbero, LUNES, 0)).toEqual(generarSlotsDisponibles(barbero, LUNES, 30))
    expect(generarSlotsDisponibles(barbero, LUNES, 'abc')).toEqual(generarSlotsDisponibles(barbero, LUNES, 30))
  })

  it('no ofrece slots que pisan el break', () => {
    const conBreak = legacy('Lun y Mar 12:00-15:00 break 13:00-14:00')
    expect(generarSlotsDisponibles(conBreak, LUNES, 30, [], 30)).toEqual(['12:00', '12:30', '14:00', '14:30'])
  })

  it('saca los slots que se superponen con un bloqueo parcial', () => {
    const bloqueos = [{ fecha: LUNES, barbero_id: 7, start_time: '10:00', end_time: '10:30' }]
    expect(generarSlotsDisponibles(barbero, LUNES, 30, bloqueos)).toEqual(['09:00', '09:15', '09:30', '10:30'])
  })

  it('no devuelve slots con un bloqueo de día completo y no se ve afectado por bloqueos de otro día o barbero', () => {
    expect(generarSlotsDisponibles(barbero, LUNES, 30, [{ fecha: LUNES, barbero_id: null, start_time: '00:00', end_time: '23:59' }])).toEqual([])
    const otros = [
      { fecha: MARTES, barbero_id: 7, start_time: '00:00', end_time: '23:59' },
      { fecha: LUNES, barbero_id: 8, start_time: '00:00', end_time: '23:59' },
    ]
    expect(generarSlotsDisponibles(barbero, LUNES, 30, otros)).toHaveLength(7)
  })

  it('devuelve slots únicos y ordenados aunque la agenda tenga franjas superpuestas', () => {
    const agenda = conAgenda([franja(1, '10:00', '11:00'), franja(1, '09:00', '10:30')])
    expect(generarSlotsDisponibles(agenda, LUNES, 30, [], 30)).toEqual(['09:00', '09:30', '10:00', '10:30'])
  })

  it('devuelve vacío sin barbero, sin fecha o en un día libre', () => {
    expect(generarSlotsDisponibles(null, LUNES)).toEqual([])
    expect(generarSlotsDisponibles(barbero, '')).toEqual([])
    expect(generarSlotsDisponibles(barbero, SABADO)).toEqual([])
  })

  describe('con el reloj congelado el lunes a las 12:00 de Buenos Aires (15:00 UTC)', () => {
    const jornada = legacy('Lun a Vie 09:00-18:00')
    const congelar = () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2030-01-07T15:00:00Z'))
    }

    it('omite los horarios pasados de hoy en la zona por defecto', () => {
      congelar()
      expect(generarSlotsDisponibles(jornada, LUNES, 30, [], 60)[0]).toBe('12:00')
    })

    it('usa la zona horaria recibida', () => {
      congelar()
      expect(generarSlotsDisponibles(jornada, LUNES, 30, [], 60, 'UTC')[0]).toBe('15:00')
      // En Tokio ya es martes: el lunes no es "hoy" y no se filtra nada.
      expect(generarSlotsDisponibles(jornada, LUNES, 30, [], 60, 'Asia/Tokyo')[0]).toBe('09:00')
    })

    it('no filtra otros días ni cuando se pide ignorar el pasado', () => {
      congelar()
      expect(generarSlotsDisponibles(jornada, MARTES, 30, [], 60)[0]).toBe('09:00')
      expect(generarSlotsDisponibles(jornada, LUNES, 30, [], 60, 'America/Argentina/Buenos_Aires', true)[0]).toBe('09:00')
    })
  })
})
