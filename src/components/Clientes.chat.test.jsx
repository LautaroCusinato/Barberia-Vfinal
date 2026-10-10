import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Clientes from './Clientes'

const pacientes = [{ id: 5, nombre: 'Ana Pérez', telefono: '5491155221234', ultima_visita: null, proximo_turno: null }, { id: 6, nombre: 'Sin Teléfono', telefono: '' }]
const turnos = [
  { id: 1, cliente_id: 5, fecha: '2026-10-03', hora: '10:00', estado: 'atendido' },
  { id: 2, cliente_id: 5, fecha: '2026-10-20', hora: '11:00', estado: 'confirmado' },
]

function renderizar(onStartChat = vi.fn()) {
  render(<Clientes pacientes={pacientes} notas={[]} turnos={turnos} todayKey="2026-10-11" onViewNotes={vi.fn()} onStartChat={onStartChat} clientesConMensajes={new Set()} />)
  return onStartChat
}

describe('Clientes', () => {
  it('tocar el teléfono abre el chat de esa persona en Mensajes', () => {
    const onStartChat = renderizar()
    const [botonTabla] = screen.getAllByRole('button', { name: /Abrir chat con Ana Pérez/ })
    fireEvent.click(botonTabla)
    expect(onStartChat).toHaveBeenCalledWith(5)
  })

  it('en la tarjeta del celular el teléfono también abre el chat (no llama)', () => {
    const onStartChat = renderizar()
    const lista = screen.getByLabelText('Clientes')
    const boton = within(lista).getByRole('button', { name: /Abrir chat con Ana Pérez/ })
    fireEvent.click(boton)
    expect(onStartChat).toHaveBeenCalledWith(5)
    expect(lista.querySelector('a[href^="tel:"]')).toBeNull()
  })

  it('un cliente sin teléfono no ofrece chat', () => {
    renderizar()
    expect(screen.queryByRole('button', { name: /Abrir chat con Sin Teléfono/ })).toBeNull()
  })

  it('muestra la última visita y el próximo turno calculados con los turnos', () => {
    renderizar()
    const fila = screen.getAllByRole('row').find((row) => row.textContent.includes('Ana Pérez'))
    expect(fila.textContent).toMatch(/03\/10\/2026/)
    expect(fila.textContent).toMatch(/20\/10\/2026/)
  })
})
