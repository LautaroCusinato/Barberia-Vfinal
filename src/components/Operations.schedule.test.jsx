import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Operations from './Operations.jsx'
import { generarSlotsDisponibles, parseHorarioTexto } from '../lib/text.js'

const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MONDAY = '2030-01-07'

function setup(horario, succeeds = true) {
  const saved = vi.fn()
  function Harness() {
    const [barberos, setBarberos] = useState([{ id: 7, nombre: 'Mateo', color: '#9b6a2f', habilidades: '', horario }])
    const update = (id, field, value) => {
      saved(id, field, value)
      if (succeeds) setBarberos((current) => current.map((b) => b.id === id ? { ...b, [field]: value } : b))
      return Promise.resolve(succeeds)
    }
    return <Operations servicios={[]} barberos={barberos} onUpdateBarbero={update} />
  }
  const rendered = render(<Harness />)
  return { ...rendered, saved }
}

function expectNoDays() {
  for (const day of DAYS) expect(screen.getByRole('button', { name: day, exact: true })).toHaveAttribute('aria-pressed', 'false')
}

describe('Operación: profesional sin días laborales (42)', () => {
  it.each(['Sin dias asignados 09:00-18:00', 'Sin días asignados 10:00-19:00'])('al abrir %s no muestra días activos', (horario) => {
    setup(horario)
    expectNoDays()
  })

  it('quitar el último día conserva agenda vacía al cambiar una hora y volver a abrir', async () => {
    const first = setup('Lun 09:00-18:00')
    fireEvent.click(screen.getByRole('button', { name: 'Lun', exact: true }))
    await waitFor(() => expect(first.saved).toHaveBeenLastCalledWith(7, 'horario', 'Sin dias asignados 09:00-18:00'))
    await waitFor(expectNoDays)
    await waitFor(() => expect(screen.getByLabelText('Desde')).not.toBeDisabled())
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '10:00' } })
    await waitFor(() => expect(first.saved).toHaveBeenLastCalledWith(7, 'horario', 'Sin dias asignados 10:00-18:00'))
    const finalSchedule = first.saved.mock.calls.at(-1)[2]
    expect(parseHorarioTexto(finalSchedule)).toEqual([])
    expect(generarSlotsDisponibles({ id: 7, horario: finalSchedule, agendaCargada: true, agenda: [] }, MONDAY, 30, [], 15, 'America/Argentina/Buenos_Aires', true)).toEqual([])
    first.unmount()
    setup(finalSchedule)
    expectNoDays()
    expect(screen.getByLabelText('Desde')).toHaveValue('10:00')
  })

  it('agregar un día explícitamente reactiva sólo ese día', async () => {
    const { saved } = setup('Sin dias asignados 10:00-18:00')
    fireEvent.click(screen.getByRole('button', { name: 'Sáb', exact: true }))
    await waitFor(() => expect(saved).toHaveBeenCalledWith(7, 'horario', 'Sáb 10:00-18:00'))
    expect(parseHorarioTexto(saved.mock.calls[0][2])).toEqual([{ day_of_week: 6, start_time: '10:00', end_time: '18:00' }])
  })

  it('rechazar quitar el último día conserva el horario anterior y muestra error', async () => {
    const { saved } = setup('Lun 09:00-18:00', false)
    fireEvent.click(screen.getByRole('button', { name: 'Lun', exact: true }))
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('No se pudo guardar. Intentá de nuevo.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lun', exact: true })).toHaveAttribute('aria-pressed', 'true')
  })

  it('mantiene la pausa válida de una jornada activa al editar horas', async () => {
    const { saved } = setup('Lun y Mar 09:00-18:00 break 13:00-14:00')
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '19:00' } })
    await waitFor(() => expect(saved).toHaveBeenCalledWith(7, 'horario', 'Lun y Mar 09:00-19:00 break 13:00-14:00'))
  })
})
