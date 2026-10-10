import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Operations from './Operations'

const servicios = [
  { id: 1, nombre: 'Corte', precio: 8000, duracion: 30, activo: true },
  { id: 2, nombre: 'Corte + barba', precio: 12000, duracion: 45, activo: true },
]
const barbero = (id, nombre, servicioIds) => ({
  id, nombre, color: '#336699', activo: true, horario: 'Lun a Vie 09:00-18:00',
  // El texto heredado dice otra cosa: el panel debe seguir la relación.
  habilidades: '["corte"]',
  servicios: servicioIds.map((servicio_id) => ({ barbero_id: id, servicio_id })),
  serviciosCargados: true,
})

function renderizar(barberos, onToggleServicioBarbero = vi.fn(() => true)) {
  render(<Operations servicios={servicios} barberos={barberos} onAddServicio={vi.fn()} onUpdateServicio={vi.fn()} onDeleteServicio={vi.fn()} onReactivarServicio={vi.fn()} onAddBarbero={vi.fn()} onUpdateBarbero={vi.fn()} onDeleteBarbero={vi.fn()} onToggleServicioBarbero={onToggleServicioBarbero} />)
  return onToggleServicioBarbero
}

const tarjeta = (nombre) => screen.getByDisplayValue(nombre).closest('.ops-barbero-card')

describe('Habilidades de cada profesional', () => {
  it('muestra los servicios que realmente usa la reserva (barbero_servicios), no el texto viejo', () => {
    renderizar([barbero(10, 'Mateo', [2])])
    const card = tarjeta('Mateo')
    expect(within(card).getByRole('button', { name: /Corte \+ barba/ })).toHaveAttribute('aria-pressed', 'true')
    expect(within(card).getByRole('button', { name: /^Corte$/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('cada profesional tiene las suyas y tocar una cambia sólo ese servicio de ese profesional', async () => {
    const toggle = renderizar([barbero(10, 'Mateo', [1]), barbero(11, 'Lucas', [1, 2])])
    fireEvent.click(within(tarjeta('Mateo')).getByRole('button', { name: /Corte \+ barba/ }))
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(10, 2, true))
    fireEvent.click(within(tarjeta('Lucas')).getByRole('button', { name: /^Corte$/ }))
    await waitFor(() => expect(toggle).toHaveBeenCalledWith(11, 1, false))
  })

  it('sin servicios asignados avisa que no aparece para reservar (ya no significa "hace todo")', () => {
    renderizar([barbero(10, 'Mateo', [])])
    expect(within(tarjeta('Mateo')).getByText(/Sin servicios asignados/)).toBeInTheDocument()
  })
})
