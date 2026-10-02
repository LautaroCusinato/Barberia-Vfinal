import { describe, expect, it } from 'vitest'
import {
  barberoHaceServicio,
  barberoRealizaServicio,
  capitalizar,
  duracionServicioBarbero,
  formatFechaVisible,
  generarIdHabilidad,
  generarSlots,
  normalizar,
  parseHabilidades,
  serializeHabilidades,
  siguienteNombreServicio,
  slotsOcupados,
  soloDigitos,
  turnosSeSuperponen,
} from './text.js'

describe('normalizar / soloDigitos', () => {
  it('normalizar pasa a minúsculas y quita acentos', () => {
    expect(normalizar('Joaquín PÉREZ Ñandú')).toBe('joaquin perez nandu')
    expect(normalizar()).toBe('')
  })

  it('soloDigitos descarta todo lo que no es dígito', () => {
    expect(soloDigitos('+54 9 (11) 5522-1234')).toBe('5491155221234')
    expect(soloDigitos()).toBe('')
  })
})

describe('capitalizar', () => {
  it('sólo pone en mayúscula la primera letra (no cada palabra)', () => {
    expect(capitalizar('viernes 2 de octubre')).toBe('Viernes 2 de octubre')
    expect(capitalizar('ñandú')).toBe('Ñandú')
    expect(capitalizar('Ya Capitalizado')).toBe('Ya Capitalizado')
  })

  it('tolera valores vacíos o no string', () => {
    expect(capitalizar('')).toBe('')
    expect(capitalizar(null)).toBe('')
    expect(capitalizar(undefined)).toBe('')
    expect(capitalizar(42)).toBe('42')
  })
})

describe('formatFechaVisible', () => {
  it('muestra fechas ISO como DD/MM/AAAA', () => {
    expect(formatFechaVisible('2026-10-02')).toBe('02/10/2026')
    expect(formatFechaVisible('2026-10-02T23:30:00-03:00')).toBe('02/10/2026')
  })

  it('usa un guion largo sin valor y deja intactos otros formatos', () => {
    expect(formatFechaVisible('')).toBe('—')
    expect(formatFechaVisible(null)).toBe('—')
    expect(formatFechaVisible('ayer')).toBe('ayer')
    expect(formatFechaVisible('02/10/2026')).toBe('02/10/2026')
  })
})

describe('siguienteNombreServicio', () => {
  it('propone el primer "Nuevo servicio N" libre', () => {
    expect(siguienteNombreServicio([])).toBe('Nuevo servicio 1')
    expect(siguienteNombreServicio()).toBe('Nuevo servicio 1')
    expect(siguienteNombreServicio([{ nombre: 'Nuevo servicio 1' }, { nombre: 'Corte' }])).toBe('Nuevo servicio 2')
  })

  it('reutiliza huecos y compara sin mayúsculas ni espacios', () => {
    expect(siguienteNombreServicio([{ nombre: 'Nuevo servicio 2' }])).toBe('Nuevo servicio 1')
    expect(siguienteNombreServicio([{ nombre: '  nuevo SERVICIO 1 ' }, { nombre: 'Nuevo servicio 2' }])).toBe('Nuevo servicio 3')
  })

  it('ignora entradas vacías o nulas', () => {
    expect(siguienteNombreServicio([null, {}, { nombre: '' }, { nombre: 'Nuevo servicio 1' }])).toBe('Nuevo servicio 2')
  })
})

describe('habilidades del barbero', () => {
  it('generarIdHabilidad crea un slug estable sin acentos', () => {
    expect(generarIdHabilidad('Corte clásico')).toBe('corte_clasico')
    expect(generarIdHabilidad('Corte + barba')).toBe('corte__barba')
    expect(generarIdHabilidad('Degradé')).toBe('degrade')
  })

  it('parseHabilidades acepta arrays, JSON o basura', () => {
    expect(parseHabilidades(['barba'])).toEqual(['barba'])
    expect(parseHabilidades('["barba","fade"]')).toEqual(['barba', 'fade'])
    expect(parseHabilidades('no-json')).toEqual([])
    expect(parseHabilidades(null)).toEqual([])
    expect(parseHabilidades(serializeHabilidades(['a', 'b']))).toEqual(['a', 'b'])
  })

  it('barberoHaceServicio: sin habilidades cargadas hace todo', () => {
    const corte = { id: 1, nombre: 'Corte clásico' }
    expect(barberoHaceServicio({ habilidades: [] }, corte)).toBe(true)
    expect(barberoHaceServicio({}, corte)).toBe(true)
    expect(barberoHaceServicio({ habilidades: ['corte_clasico'] }, corte)).toBe(true)
    expect(barberoHaceServicio({ habilidades: '["barba"]' }, corte)).toBe(false)
    expect(barberoHaceServicio({ habilidades: ['barba'] }, null)).toBe(true)
  })
})

describe('barberoRealizaServicio', () => {
  const corte = { id: 10, nombre: 'Corte clásico' }

  it('usa la relación barbero_servicios cuando está cargada', () => {
    const barbero = { serviciosCargados: true, servicios: [{ servicio_id: 10 }], habilidades: ['barba'] }
    expect(barberoRealizaServicio(barbero, corte)).toBe(true)
    expect(barberoRealizaServicio(barbero, { id: 11, nombre: 'Barba' })).toBe(false)
  })

  it('compara ids como texto y acepta relaciones con id', () => {
    expect(barberoRealizaServicio({ serviciosCargados: true, servicios: [{ servicio_id: '10' }] }, corte)).toBe(true)
    expect(barberoRealizaServicio({ serviciosCargados: true, servicios: [{ id: 10 }] }, corte)).toBe(true)
  })

  it('con la relación cargada pero vacía no realiza nada', () => {
    expect(barberoRealizaServicio({ serviciosCargados: true, servicios: [] }, corte)).toBe(false)
    expect(barberoRealizaServicio({ serviciosCargados: true }, corte)).toBe(false)
  })

  it('cae a las habilidades JSON en demo/datos viejos', () => {
    expect(barberoRealizaServicio({ habilidades: ['corte_clasico'] }, corte)).toBe(true)
    expect(barberoRealizaServicio({ habilidades: ['barba'] }, corte)).toBe(false)
    expect(barberoRealizaServicio({ habilidades: [] }, corte)).toBe(true)
  })

  it('devuelve false sin barbero o sin servicio', () => {
    expect(barberoRealizaServicio(null, corte)).toBe(false)
    expect(barberoRealizaServicio({ habilidades: [] }, null)).toBe(false)
  })
})

describe('duracionServicioBarbero', () => {
  const servicio = { id: 5, duracion: 40 }

  it('prioriza la duración propia del barbero para ese servicio', () => {
    expect(duracionServicioBarbero({ servicios: [{ servicio_id: 5, duracion_min: 55 }] }, servicio)).toBe(55)
    expect(duracionServicioBarbero({ servicios: [{ servicio_id: '5', duracion_min: '25' }] }, servicio)).toBe(25)
  })

  it('luego usa duracion_min o duracion del servicio', () => {
    expect(duracionServicioBarbero({ servicios: [] }, { id: 5, duracion_min: 35, duracion: 40 })).toBe(35)
    expect(duracionServicioBarbero({}, servicio)).toBe(40)
    expect(duracionServicioBarbero({ servicios: [{ servicio_id: 9, duracion_min: 90 }] }, servicio)).toBe(40)
  })

  it('cae al fallback (y a 30) cuando no hay duración válida', () => {
    expect(duracionServicioBarbero({}, { id: 5 }, 45)).toBe(45)
    expect(duracionServicioBarbero({}, { id: 5 })).toBe(30)
    expect(duracionServicioBarbero({}, { id: 5, duracion: 'abc' }, 20)).toBe(20)
    expect(duracionServicioBarbero({}, { id: 5, duracion: 0 }, 20)).toBe(20)
    expect(duracionServicioBarbero({}, null, 50)).toBe(50)
    expect(duracionServicioBarbero({}, null, 'x')).toBe(30)
  })
})

describe('turnosSeSuperponen', () => {
  it('detecta superposición parcial o total', () => {
    expect(turnosSeSuperponen('10:00', 30, '10:15', 30)).toBe(true)
    expect(turnosSeSuperponen('10:00', 60, '10:15', 15)).toBe(true)
    expect(turnosSeSuperponen('10:15', 15, '10:00', 60)).toBe(true)
    expect(turnosSeSuperponen('10:00', 30, '10:00', 30)).toBe(true)
  })

  it('turnos contiguos no se superponen', () => {
    expect(turnosSeSuperponen('10:00', 30, '10:30', 30)).toBe(false)
    expect(turnosSeSuperponen('10:30', 30, '10:00', 30)).toBe(false)
  })

  it('acepta horas con segundos (formato time de Postgres)', () => {
    expect(turnosSeSuperponen('10:00:00', 30, '10:20:00', 30)).toBe(true)
  })

  it('una duración nula, negativa o inválida se trata como un instante', () => {
    expect(turnosSeSuperponen('10:00', 0, '10:00', 30)).toBe(false)
    expect(turnosSeSuperponen('10:00', 'abc', '10:00', 30)).toBe(false)
    expect(turnosSeSuperponen('10:00', -15, '09:50', 30)).toBe(true) // instante dentro de otro turno
  })
})

describe('generarSlots / slotsOcupados', () => {
  it('generarSlots arma la grilla [inicio, fin)', () => {
    expect(generarSlots(9 * 60, 10 * 60, 20)).toEqual(['09:00', '09:20', '09:40'])
    expect(generarSlots(600, 600)).toEqual([])
  })

  it('slotsOcupados redondea con 5 minutos de tolerancia y ocupa al menos uno', () => {
    expect(slotsOcupados(30, 30)).toBe(1)
    expect(slotsOcupados(35, 30)).toBe(1)
    expect(slotsOcupados(36, 30)).toBe(2)
    expect(slotsOcupados(60, 30)).toBe(2)
    expect(slotsOcupados(5, 30)).toBe(1)
    expect(slotsOcupados(undefined, 30)).toBe(1)
  })
})
