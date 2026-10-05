import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ClientDetailModal from './ClientDetailModal'
import Clientes from './Clientes'

const ana = { id: 100, nombre: 'Ana Pérez', telefono: '5491122334455' }

describe('Ficha del cliente · Iniciar chat (tarea 38)', () => {
  it('cliente sin conversación ofrece "Iniciar chat" con su id', async () => {
    const user = userEvent.setup()
    const onStartChat = vi.fn()
    render(<ClientDetailModal paciente={ana} turnos={[]} notas={[]} onClose={() => {}} onStartChat={onStartChat} />)
    await user.click(screen.getByRole('button', { name: 'Iniciar chat' }))
    expect(onStartChat).toHaveBeenCalledWith(100)
  })

  it('cliente con conversación ofrece "Abrir chat"', () => {
    render(<ClientDetailModal paciente={ana} turnos={[]} notas={[]} onClose={() => {}} onStartChat={vi.fn()} tieneMensajes />)
    expect(screen.getByRole('button', { name: 'Abrir chat' })).toBeInTheDocument()
  })

  it('sin la acción no muestra el botón', () => {
    render(<ClientDetailModal paciente={ana} turnos={[]} notas={[]} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: /chat/i })).toBeNull()
  })

  it('desde Clientes: abre la ficha, inicia el chat del cliente correcto y cierra la ficha', async () => {
    const user = userEvent.setup()
    const onStartChat = vi.fn()
    const beto = { id: 101, nombre: 'Beto Ruiz', telefono: '5491166667777' }
    render(
      <Clientes
        pacientes={[ana, beto]}
        notas={[]}
        turnos={[]}
        onViewNotes={() => {}}
        onStartChat={onStartChat}
        clientesConMensajes={new Set([101])}
      />,
    )
    await user.click(screen.getAllByText('Beto Ruiz')[0])
    await user.click(screen.getByRole('button', { name: 'Abrir chat' }))
    expect(onStartChat).toHaveBeenCalledTimes(1)
    expect(onStartChat).toHaveBeenCalledWith(101)
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Abrir chat' })).toBeNull())
  })
})
