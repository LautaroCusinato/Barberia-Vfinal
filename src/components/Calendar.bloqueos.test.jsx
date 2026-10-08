import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Calendar from './Calendar'

// Revisión 41: sin filtro de profesional, el bloqueo de un solo profesional
// no cierra el día para el resto del equipo.
const HOY = '2026-10-05'
const barberos = [
  { id: 7, nombre: 'Lucas', color: '#2d9464', horario: 'Lun a Sáb 09:00-18:00', activo: true },
  { id: 8, nombre: 'Mora', color: '#9b6a2f', horario: 'Lun a Sáb 09:00-18:00', activo: true },
]

function renderCalendar(bloqueos) {
  return render(
    <Calendar
      turnos={[]}
      todayKey={HOY}
      onChangeEstado={vi.fn()}
      onDeleteTurno={vi.fn()}
      onEditTurno={vi.fn()}
      notas={[]}
      onAddNota={vi.fn()}
      onNewTurno={vi.fn()}
      barberos={barberos}
      bloqueos={bloqueos}
    />,
  )
}

const celdaDelDia = () => screen.getAllByLabelText(/^lunes 5 de octubre/i)[0]

describe('Calendar — alcance de los bloqueos', () => {
  it('un bloqueo de día completo de un profesional se ve como parcial en la vista de todos', () => {
    renderCalendar([{ id: 1, fecha: HOY, barbero_id: 7, start_time: '00:00', end_time: '23:59', motivo: 'Vacaciones' }])
    expect(celdaDelDia()).toHaveAccessibleName(/bloqueo parcial/)
    expect(screen.getByText('Lucas', { selector: '.day-panel-team-name' }).closest('.day-panel-team-chip')).toHaveTextContent('No disponible')
    expect(screen.getByText('Mora', { selector: '.day-panel-team-name' }).closest('.day-panel-team-chip')).toHaveTextContent('Trabaja')
  })

  it('un bloqueo de todo el negocio cierra el día', () => {
    renderCalendar([{ id: 2, fecha: HOY, barbero_id: null, start_time: '00:00', end_time: '23:59', motivo: 'Feriado' }])
    expect(celdaDelDia()).toHaveAccessibleName(/, bloqueado$/)
  })
})
