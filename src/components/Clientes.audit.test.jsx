import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import NewClientModal from './NewClientModal'
import EditClientModal from './EditClientModal'
import ClientDetailModal from './ClientDetailModal'
import CobroModal from './CobroModal'
import Clientes from './Clientes'

const cliente = { id: 100, barberia_id: 928, nombre: 'Ana Pérez', telefono: '5491144445555' }

describe('Auditoría: identidad y teclado en fichas de cliente', () => {
  it('la ficha en la tabla de escritorio se puede abrir con Enter', async () => {
    const user = userEvent.setup()
    const { container } = render(<Clientes pacientes={[cliente]} notas={[]} turnos={[]} onViewNotes={vi.fn()} />)
    const button = container.querySelector('table button.table-name-cell')
    expect(button).not.toBeNull()
    button.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: /Ana Pérez/ })).toBeInTheDocument()
  })

  it('Escape devuelve el foco al botón que abrió el alta', async () => {
    const user = userEvent.setup()
    render(<Clientes pacientes={[]} notas={[]} turnos={[]} onViewNotes={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Agregar' })
    await user.click(button)
    await vi.waitFor(() => expect(screen.getByLabelText(/Nombre y apellido/)).toHaveFocus())
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(button).toHaveFocus())
  })

  it('no atribuye turnos sin vínculo ni de un homónimo a la ficha', () => {
    render(<ClientDetailModal paciente={cliente} notas={[]} onClose={vi.fn()} turnos={[
      { id: 1, cliente_id: '100', barberia_id: 928, paciente: 'Nombre de reserva', fecha: '2026-10-10', hora: '09:00', motivo: 'Propio por ID', estado: 'confirmado' },
      { id: 2, paciente_id: 100, paciente: 'Ana Pérez', fecha: '2026-10-10', hora: '10:00', motivo: 'Propio demo', estado: 'confirmado' },
      { id: 3, cliente_id: 101, paciente: 'Ana Pérez', fecha: '2026-10-10', hora: '11:00', motivo: 'Homónimo vinculado', estado: 'confirmado' },
      { id: 4, cliente_id: null, paciente: 'Ana Pérez', fecha: '2026-10-10', hora: '12:00', motivo: 'Sin vínculo fiable', estado: 'confirmado' },
      { id: 5, cliente_id: 100, barberia_id: 929, paciente: 'Ana Pérez', fecha: '2026-10-10', hora: '13:00', motivo: 'Otro negocio', estado: 'confirmado' },
    ]} />)
    expect(screen.getByText('Propio por ID')).toBeInTheDocument()
    expect(screen.getByText('Propio demo')).toBeInTheDocument()
    expect(screen.queryByText('Homónimo vinculado')).toBeNull()
    expect(screen.queryByText('Sin vínculo fiable')).toBeNull()
    expect(screen.queryByText('Otro negocio')).toBeNull()
    expect(screen.getByText('Turnos (2)')).toBeInTheDocument()
  })

  it.each(['alta', 'edición'])('%s tiene diálogo y etiquetas; Escape cierra', async (tipo) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onSubmit = vi.fn()
    render(tipo === 'alta'
      ? <NewClientModal open onClose={onClose} onSubmit={onSubmit} />
      : <EditClientModal paciente={cliente} onClose={onClose} onSubmit={onSubmit} />)
    const dialog = screen.getByRole('dialog', { name: tipo === 'alta' ? 'Agregar cliente' : 'Editar cliente' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByLabelText(/Nombre y apellido/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Última visita/)).toBeInTheDocument()
    if (tipo === 'alta') expect(within(dialog).getByLabelText(/Email/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('alta conserva borrador y no cierra durante el guardado; libera Escape tras error', async () => {
    const user = userEvent.setup()
    let reject
    const onClose = vi.fn()
    const onSubmit = vi.fn(() => new Promise((_, fail) => { reject = fail }))
    const { container } = render(<NewClientModal open onClose={onClose} onSubmit={onSubmit} />)
    await user.type(screen.getByPlaceholderText('Ej: Juan Pérez'), 'Lucía Pérez')
    await user.type(screen.getByRole('textbox', { name: 'Teléfono' }), '1144445555')
    await user.click(screen.getByRole('button', { name: 'Agregar cliente' }))
    await user.keyboard('{Escape}')
    fireEvent.mouseDown(container.querySelector('.modal-overlay'))
    expect(onClose).not.toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalledOnce()
    await act(async () => { reject(new Error('offline')) })
    expect(screen.getByPlaceholderText('Ej: Juan Pérez')).toHaveValue('Lucía Pérez')
    expect(screen.getByRole('alert')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('Auditoría: cobro en curso', () => {
  it('no permite cerrar o cambiar el importe mientras se registra; error conserva valores', async () => {
    const user = userEvent.setup()
    let reject
    const onClose = vi.fn()
    const onConfirm = vi.fn(() => new Promise((_, fail) => { reject = fail }))
    const { container } = render(<CobroModal turno={{ id: 1, paciente: 'Ana', precio: 9000 }} servicios={[]} onClose={onClose} onConfirm={onConfirm} />)
    await user.click(screen.getByRole('button', { name: 'Transferencia' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar cobro' }))
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled()
    expect(screen.getByRole('spinbutton')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Efectivo' })).toBeDisabled()
    await user.keyboard('{Escape}')
    fireEvent.mouseDown(container.querySelector('.modal-overlay'))
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ monto: 9000, metodo: 'transferencia' })
    await act(async () => { reject(new Error('offline')) })
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton')).toHaveValue(9000)
    expect(screen.getByRole('spinbutton')).toBeEnabled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
