import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Notes from './Notes.jsx'

const nota = { id: 7, paciente: 'General', texto: 'Comprar insumos', fecha: '2026-10-05' }
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('Notes · borrado con Deshacer', () => {
  it('si el borrado no se programa, la tarjeta deja de colapsarse y se puede reintentar', () => {
    const onDelete = vi.fn(() => false)
    const { container } = render(<Notes notas={[nota]} onDelete={onDelete} pacientes={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar nota' }))
    expect(container.querySelector('.collapse-row.is-collapsing')).not.toBeNull()
    act(() => vi.advanceTimersByTime(300))
    expect(onDelete).toHaveBeenCalledWith(7)
    expect(container.querySelector('.collapse-row.is-collapsing')).toBeNull()
    expect(screen.getByRole('button', { name: 'Eliminar nota' })).toBeEnabled()
  })
})
