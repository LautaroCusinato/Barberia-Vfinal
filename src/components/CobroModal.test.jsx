import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import CobroModal from './CobroModal'
import { CobroError } from '../lib/cobroTurno.js'

const servicios = [
  { id: 1, nombre: 'Corte', precio: 8500 },
  { id: 2, nombre: 'Barba', precio: 7000 },
]
const turno = { id: 50, paciente: 'Ana Pérez', motivo: 'Corte', servicio_id: 1, precio: 9000 }

function renderModal(props = {}) {
  const onClose = vi.fn()
  const onConfirm = vi.fn().mockResolvedValue(undefined)
  const utils = render(<CobroModal turno={turno} servicios={servicios} onClose={onClose} onConfirm={onConfirm} {...props} />)
  return { ...utils, onClose, onConfirm, monto: () => screen.getByRole('spinbutton'), confirmar: () => screen.getByRole('button', { name: /Confirmar cobro|Guardando/ }) }
}

describe('CobroModal', () => {
  it('no renderiza nada sin turno', () => {
    const { container } = render(<CobroModal turno={null} servicios={servicios} onClose={() => {}} onConfirm={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra cliente y servicio y precarga el precio del turno', () => {
    const { monto } = renderModal()
    expect(screen.getByText('Ana Pérez — Corte')).toBeInTheDocument()
    expect(monto()).toHaveValue(9000)
  })

  it('sin precio en el turno usa el del servicio; sin ninguno queda vacío', () => {
    const { monto, rerender, onClose, onConfirm } = renderModal({ turno: { ...turno, precio: null } })
    expect(monto()).toHaveValue(8500)
    rerender(<CobroModal turno={{ ...turno, id: 51, precio: undefined, servicio_id: 99 }} servicios={servicios} onClose={onClose} onConfirm={onConfirm} />)
    expect(monto()).toHaveValue(null)
  })

  it('compara el servicio por id aunque venga como texto', () => {
    const { monto } = renderModal({ turno: { ...turno, precio: undefined, servicio_id: '2' } })
    expect(monto()).toHaveValue(7000)
  })

  it('valida el monto: vacío o negativo deshabilita el cobro', async () => {
    const user = userEvent.setup()
    const { monto, confirmar, onConfirm } = renderModal()
    await user.clear(monto())
    expect(confirmar()).toBeDisabled()
    await user.type(monto(), '-5')
    expect(confirmar()).toBeDisabled()
    await user.clear(monto())
    await user.type(monto(), '0')
    expect(confirmar()).toBeEnabled()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('confirma una sola vez con el monto y el método elegidos', async () => {
    const user = userEvent.setup()
    let resolver
    const onConfirm = vi.fn(() => new Promise((resolve) => { resolver = resolve }))
    const { monto, confirmar } = renderModal({ onConfirm })

    await user.clear(monto())
    await user.type(monto(), '1500.50')
    await user.click(screen.getByRole('button', { name: /Transferencia/ }))
    await user.dblClick(confirmar())

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith({ monto: 1500.5, metodo: 'transferencia' })
    expect(confirmar()).toBeDisabled()
    expect(confirmar()).toHaveTextContent('Guardando…')

    resolver()
    await vi.waitFor(() => expect(confirmar()).toHaveTextContent('Confirmar cobro'))
    expect(confirmar()).toBeEnabled()
  })

  it('el método por defecto es efectivo', async () => {
    const user = userEvent.setup()
    const { confirmar, onConfirm } = renderModal()
    expect(screen.getByRole('button', { name: /Efectivo/ })).toHaveClass('active')
    await user.click(confirmar())
    expect(onConfirm).toHaveBeenCalledWith({ monto: 9000, metodo: 'efectivo' })
  })

  it('no pisa el monto tipeado cuando se recargan los servicios del mismo turno', async () => {
    const user = userEvent.setup()
    const { monto, rerender, onClose, onConfirm } = renderModal()
    await user.clear(monto())
    await user.type(monto(), '7777')

    // Realtime: llega una lista nueva de servicios y un objeto turno nuevo con el mismo id.
    rerender(<CobroModal turno={{ ...turno }} servicios={[{ id: 1, nombre: 'Corte', precio: 12000 }]} onClose={onClose} onConfirm={onConfirm} />)
    expect(monto()).toHaveValue(7777)
  })

  it('se reinicializa al abrirse para otro turno', async () => {
    const user = userEvent.setup()
    const { monto, rerender, onClose, onConfirm } = renderModal()
    await user.clear(monto())
    await user.type(monto(), '1')
    await user.click(screen.getByRole('button', { name: /Mercado Pago/ }))

    rerender(<CobroModal turno={{ id: 60, paciente: 'Luis', servicio_id: 2 }} servicios={servicios} onClose={onClose} onConfirm={onConfirm} />)
    expect(monto()).toHaveValue(7000)
    expect(screen.getByRole('button', { name: /Efectivo/ })).toHaveClass('active')
    expect(screen.getByText('Luis — Turno')).toBeInTheDocument()
  })

  it('cancelar, cerrar o hacer clic afuera llama a onClose; clic adentro no', async () => {
    const user = userEvent.setup()
    const { container, onClose, onConfirm } = renderModal()
    await user.click(screen.getByRole('button', { name: 'Cancelar' }))
    await user.click(screen.getByRole('button', { name: 'Cerrar' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    await user.click(container.querySelector('.modal-box'))
    expect(onClose).toHaveBeenCalledTimes(2)
    await user.click(container.querySelector('.modal-overlay'))
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('si onConfirm rechaza vuelve a habilitar "Confirmar cobro" y muestra un error', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn().mockRejectedValue(new Error('red caída'))
    render(<CobroModal turno={{ id: 9, paciente: 'Ana', servicio_id: 1, precio: 5000 }} servicios={[]} onClose={() => {}} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo registrar el cobro')
    expect(screen.getByRole('button', { name: 'Confirmar cobro' })).toBeEnabled()
  })

  it('ante un rechazo del servidor muestra su motivo y conserva importe y método para reintentar', async () => {
    const user = userEvent.setup()
    const rechazo = new CobroError('Este turno ya figura como atendido. Actualizá la agenda antes de cobrarlo de nuevo.', { codigo: 'turno_ya_atendido' })
    const onConfirm = vi.fn().mockRejectedValueOnce(rechazo).mockResolvedValueOnce(undefined)
    const { monto, confirmar } = renderModal({ onConfirm })
    await user.clear(monto())
    await user.type(monto(), '4321')
    await user.click(screen.getByRole('button', { name: /Mercado Pago/ }))
    await user.click(confirmar())

    expect(await screen.findByRole('alert')).toHaveTextContent('ya figura como atendido')
    expect(monto()).toHaveValue(4321)
    expect(screen.getByRole('button', { name: /Mercado Pago/ })).toHaveClass('active')

    await user.click(confirmar())
    expect(onConfirm).toHaveBeenNthCalledWith(2, { monto: 4321, metodo: 'mercadopago' })
    await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
