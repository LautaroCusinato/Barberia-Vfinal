import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import BloqueosModal from './BloqueosModal'

// Revisión 41: la advertencia de turnos agendados se basa en la base, no en
// la lista del panel (que puede venir cortada a 1000 filas o atrasada).
const HOY = '2026-10-05'
const barberos = [{ id: 7, nombre: 'Lucas', activo: true }]

function renderModal(props = {}) {
  const onBloquear = vi.fn().mockResolvedValue({ ok: true })
  render(
    <BloqueosModal
      open
      onClose={vi.fn()}
      fechaInicial="2026-10-10"
      todayKey={HOY}
      barberos={barberos}
      bloqueos={[]}
      turnos={[]}
      onBloquear={onBloquear}
      onDesbloquear={vi.fn()}
      {...props}
    />,
  )
  return { onBloquear }
}

describe('BloqueosModal — revisión de turnos en el servidor', () => {
  it('pide confirmar un turno que el panel no tenía cargado', async () => {
    const user = userEvent.setup()
    const onRevisarTurnos = vi.fn().mockResolvedValue({ ok: true, turnos: [{ id: 501, fecha: '2026-10-10', hora: '10:00', paciente: 'Turno lejano', barbero_id: 7, estado: 'confirmado' }] })
    const { onBloquear } = renderModal({ onRevisarTurnos })
    await user.click(screen.getByRole('button', { name: 'Bloquear' }))
    expect(onRevisarTurnos).toHaveBeenCalledWith({ fechas: ['2026-10-10'], barberoId: null })
    expect(await screen.findByText(/Hay 1 turno agendado/)).toBeInTheDocument()
    expect(screen.getByText(/Turno lejano/)).toBeInTheDocument()
    expect(onBloquear).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Bloquear igual' }))
    await waitFor(() => expect(onBloquear).toHaveBeenCalledTimes(1))
    // Confirmar no vuelve a consultar: guarda lo que el operador aceptó.
    expect(onRevisarTurnos).toHaveBeenCalledTimes(1)
  })

  it('si no puede revisar los turnos, no bloquea nada y lo dice', async () => {
    const user = userEvent.setup()
    const onRevisarTurnos = vi.fn().mockResolvedValue({ ok: false, error: new Error('red') })
    const { onBloquear } = renderModal({ onRevisarTurnos })
    await user.click(screen.getByRole('button', { name: 'Bloquear' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos revisar los turnos de esas fechas, así que no se bloqueó nada.')
    expect(onBloquear).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Bloquear' })).not.toHaveAttribute('aria-disabled')
  })

  it('mientras revisa no acepta un segundo envío', async () => {
    const user = userEvent.setup()
    let resolver
    const onRevisarTurnos = vi.fn(() => new Promise((r) => { resolver = r }))
    const { onBloquear } = renderModal({ onRevisarTurnos })
    await user.click(screen.getByRole('button', { name: 'Bloquear' }))
    const ocupado = await screen.findByRole('button', { name: 'Revisando turnos…' })
    await user.click(ocupado)
    expect(onRevisarTurnos).toHaveBeenCalledTimes(1)
    resolver({ ok: true, turnos: [] })
    await waitFor(() => expect(onBloquear).toHaveBeenCalledTimes(1))
  })
})
