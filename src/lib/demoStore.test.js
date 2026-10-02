// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { DEMO_TTL_HOURS, getDemoSession, getDemoSnapshot, resetDemoSession, saveDemoSnapshot } from './demoStore.js'
import { barberoDisponible } from './text.js'

const HORA = 60 * 60 * 1000

function congelar(iso) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

describe('sesión demo', () => {
  it('reutiliza la sesión durante 8 horas y luego crea otra', () => {
    expect(DEMO_TTL_HOURS).toBe(8)
    congelar('2030-01-07T12:00:00Z')
    const primera = getDemoSession()
    expect(primera).toBeTruthy()
    vi.setSystemTime(Date.now() + 8 * HORA)
    expect(getDemoSession()).toBe(primera)
    vi.setSystemTime(Date.now() + 1)
    expect(getDemoSession()).not.toBe(primera)
  })

  it('si el storage está bloqueado sigue en memoria', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(getDemoSession()).toBe('demo-session-memory')
  })
})

describe('snapshot demo', () => {
  it('sin snapshot devuelve la semilla y cada lectura es una copia independiente', () => {
    const a = getDemoSnapshot('s1')
    expect(a.servicios.length).toBeGreaterThan(0)
    expect(a.barberos.length).toBeGreaterThan(0)
    a.servicios.push({ id: 'nuevo' })
    expect(getDemoSnapshot('s1').servicios.some((s) => s.id === 'nuevo')).toBe(false)
  })

  it('guarda y recupera los cambios de la sesión', () => {
    const snapshot = getDemoSnapshot('s2')
    snapshot.servicios = [{ id: 1, nombre: 'Sólo este' }]
    saveDemoSnapshot('s2', snapshot)
    expect(getDemoSnapshot('s2').servicios).toEqual([{ id: 1, nombre: 'Sólo este' }])
    expect(getDemoSnapshot('otra-sesion').servicios).not.toEqual([{ id: 1, nombre: 'Sólo este' }])
  })

  it('descarta snapshots vencidos', () => {
    congelar('2030-01-07T12:00:00Z')
    saveDemoSnapshot('s3', { servicios: [] })
    vi.setSystemTime(Date.now() + 8 * HORA + 1)
    expect(getDemoSnapshot('s3').servicios.length).toBeGreaterThan(0)
    expect(localStorage.getItem('austral-demo-snapshot-v2:s3')).toBeNull()
  })

  it('reset borra el snapshot y avisa a la app', () => {
    saveDemoSnapshot('s4', { servicios: [] })
    const listener = vi.fn()
    window.addEventListener('austral:demo-reset', listener)
    resetDemoSession('s4')
    window.removeEventListener('austral:demo-reset', listener)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener.mock.calls[0][0].detail).toEqual({ sessionId: 's4' })
    expect(getDemoSnapshot('s4').servicios.length).toBeGreaterThan(0)
  })

  it('las fechas de la semilla siguen el calendario de Buenos Aires, no el del runner', () => {
    congelar('2030-01-08T01:00:00Z') // 7/1 22:00 en Buenos Aires
    const { turnos, zonaHoraria } = getDemoSnapshot('tz')
    expect(zonaHoraria).toBe('America/Argentina/Buenos_Aires')
    expect(turnos.find((t) => t.hora === '17:00' && t.estado === 'pendiente').fecha).toBe('2030-01-07')
  })

  it('el turno de hoy que se usa para editar es válido cualquier día de la semana', () => {
    for (let dia = 0; dia < 7; dia += 1) {
      congelar(`2030-01-${String(6 + dia).padStart(2, '0')}T15:00:00Z`)
      const { turnos, barberos, bloqueos, servicios, zonaHoraria } = getDemoSnapshot(`semana-${dia}`)
      const turno = turnos.find((t) => t.hora === '17:00' && t.estado === 'pendiente')
      const barbero = barberos.find((b) => b.id === turno.barbero_id)
      const servicio = servicios.find((s) => s.id === turno.servicio_id)
      expect(barberoDisponible(barbero, turno.fecha, turno.hora, servicio.duracion, bloqueos, zonaHoraria, true)).toBe(true)
    }
  })
})
