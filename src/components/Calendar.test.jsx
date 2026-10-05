import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Calendar from './Calendar.jsx'

const fecha = '2030-01-07'
const turno = { id: 7, fecha, hora: '09:00', duracion: 30, paciente: 'Cliente de prueba', motivo: 'Corte', barbero_id: 3, estado: 'confirmado' }
const minutos = (hora) => { const [h, m] = hora.split(':').map(Number); return h * 60 + m }
const rect = (left, top, width = 100, height = 60) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top })
const filaY = (hora) => 50 + (minutos(hora) - 540) * 2
function diferido() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(new Date('2030-01-07T10:00:00Z'))
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  // jsdom no calcula layout: geometría explícita para ejercitar los handlers,
  // no para afirmar que el CSS quedó validado en un teléfono real.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    if (this.matches('.week-grid')) return rect(0, 0, 800, 500)
    if (this.matches('.week-time-label')) return rect(0, filaY(this.dataset.slot))
    if (this.matches('.week-day-header')) {
      const dia = (new Date(`${this.dataset.fecha}T12:00:00Z`).getUTCDay() + 6) % 7
      return rect(100 + dia * 100, 0, 100, 50)
    }
    if (this.matches('.week-chip')) return rect(100, filaY(this.querySelector('.week-chip-time')?.textContent || '09:00'))
    return rect(0, 0)
  })
})

function montar(onMoverTurno = vi.fn().mockResolvedValue(false)) {
  const onEditTurno = vi.fn()
  const props = { turnos: [turno], todayKey: fecha, onMoverTurno, onEditTurno, notas: [], barberos: [{ id: 3, nombre: 'Profesional QA', horario: 'Lun a Vie 09:00-13:00', activo: true }] }
  const vista = render(<Calendar {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Semana', exact: true }))
  return { ...vista, onMoverTurno, onEditTurno, actualizar: (turnos) => vista.rerender(<Calendar {...props} turnos={turnos} />) }
}
function puntero(target, type, y, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 150, clientY: y, button: 0 })
  Object.defineProperties(event, { pointerId: { value: 42 }, pointerType: { value: pointerType } })
  fireEvent(target, event)
}
const chip = () => document.querySelector('.week-grid .week-chip--draggable')
const horaVisible = () => chip()?.querySelector('.week-chip-time').textContent
function iniciar(hora, tipo = 'mouse') {
  const elemento = chip()
  const y = elemento.getBoundingClientRect().top + 10
  puntero(elemento, 'pointerdown', y, tipo)
  if (tipo === 'touch') act(() => vi.advanceTimersByTime(300))
  puntero(window, 'pointermove', filaY(hora) + 10, tipo)
  expect(document.querySelector('.week-chip-ghost')).not.toBeNull()
}
async function soltar(hora, tipo = 'mouse') {
  await act(async () => puntero(window, 'pointerup', filaY(hora) + 10, tipo))
}

describe('arrastre del calendario', () => {
  it('una respuesta vieja no borra el segundo destino provisional', async () => {
    const a = diferido(), b = diferido()
    const h = montar(vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise))
    iniciar('10:00')
    await soltar('10:00')
    expect(horaVisible()).toBe('10:00')
    iniciar('11:00')
    await soltar('11:00')
    expect(horaVisible()).toBe('11:00')
    await act(async () => { a.reject(new Error('falló el primer guardado')) })
    expect(horaVisible()).toBe('11:00')
    h.actualizar([{ ...turno, hora: '11:00' }])
    await act(async () => { b.resolve(true) })
    expect(horaVisible()).toBe('11:00')
    expect(h.onMoverTurno).toHaveBeenCalledTimes(2)
  })

  it('al fallar el último movimiento muestra la posición confirmada del padre', async () => {
    const a = diferido()
    const h = montar(vi.fn().mockReturnValue(a.promise))
    iniciar('10:00')
    await soltar('10:00')
    expect(horaVisible()).toBe('10:00')
    await act(async () => { a.resolve(false) })
    expect(horaVisible()).toBe('09:00')
    expect(h.onEditTurno).not.toHaveBeenCalled()
  })

  it('touch requiere pulsación larga y entrega el destino al soltar', async () => {
    const h = montar()
    iniciar('10:00', 'touch')
    await soltar('10:00', 'touch')
    expect(h.onMoverTurno).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }), { fecha, hora: '10:00' })
    expect(document.querySelector('.week-chip-ghost')).toBeNull()
  })

  it('mover el dedo antes de la pulsación larga permite scroll y no agenda', async () => {
    const h = montar()
    const y = chip().getBoundingClientRect().top + 10
    puntero(chip(), 'pointerdown', y, 'touch')
    puntero(window, 'pointermove', y + 20, 'touch')
    act(() => vi.advanceTimersByTime(400))
    await soltar('10:00', 'touch')
    expect(document.querySelector('.week-chip-ghost')).toBeNull()
    expect(h.onMoverTurno).not.toHaveBeenCalled()
  })

  it.each(['escape', 'pointercancel', 'otra-semana', 'desmontar'])('cancela sin guardar al recibir %s', async (motivo) => {
    const h = montar()
    iniciar('10:00')
    if (motivo === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
    if (motivo === 'pointercancel') puntero(window, 'pointercancel', filaY('10:00') + 10)
    if (motivo === 'otra-semana') fireEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }))
    if (motivo === 'desmontar') h.unmount()
    await soltar('10:00')
    expect(document.querySelector('.week-chip-ghost')).toBeNull()
    expect(h.onMoverTurno).not.toHaveBeenCalled()
  })

  it('revalida si el destino se ocupa mientras el puntero está quieto', async () => {
    const h = montar()
    iniciar('10:00')
    h.actualizar([turno, { ...turno, id: 8, hora: '10:00', paciente: 'Otra reserva' }])
    await soltar('10:00')
    expect(h.onMoverTurno).not.toHaveBeenCalled()
  })
})
