import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import TurnoRow from './TurnoRow.jsx'

const turno = { id: 21, cliente_id: 1, barberia_id: 10, paciente: 'Juan', fecha: '2026-10-10', hora: '09:00', motivo: 'Corte', estado: 'confirmado' }
const notas = [
  { id: 31, cliente_id: 1, barberia_id: 10, paciente: 'Nombre anterior', texto: 'Nota de la ficha uno', fecha: '2026-10-09' },
  { id: 32, cliente_id: 2, barberia_id: 10, paciente: 'Juan', texto: 'Nota del homónimo', fecha: '2026-10-09' },
  { id: 33, cliente_id: null, barberia_id: 10, paciente: 'Juan', texto: 'Legado sin vínculo', fecha: '2026-10-09' },
  { id: 34, cliente_id: 1, barberia_id: 20, paciente: 'Juan', texto: 'Nota de otro negocio', fecha: '2026-10-09' },
]

function abrir(overrides = {}) {
  const props = { turno, notas, onAddNota: vi.fn(async () => true), onChangeEstado: vi.fn(), onDeleteTurno: vi.fn(), onEditTurno: vi.fn(), ...overrides }
  render(<TurnoRow {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'Notas del cliente' }))
  return props
}

describe('Agenda: notas de la ficha del turno (55)', () => {
  it('muestra sólo la nota del ID correcto aunque el nombre guardado sea antiguo', () => {
    abrir()
    expect(screen.getByText('Nota de la ficha uno')).toBeInTheDocument()
    expect(screen.queryByText('Nota del homónimo')).toBeNull()
    expect(screen.queryByText('Legado sin vínculo')).toBeNull()
    expect(screen.queryByText('Nota de otro negocio')).toBeNull()
    expect(screen.getByRole('button', { name: 'Notas del cliente' }).querySelector('.note-count')).toHaveTextContent('1')
  })

  it.each(['paciente_id', 'clienteId'])('soporta %s de fixtures antiguos sin buscar por nombre', (alias) => {
    const { cliente_id: _unused, ...legacy } = turno
    abrir({ turno: { ...legacy, [alias]: '1' } })
    expect(screen.getByText('Nota de la ficha uno')).toBeInTheDocument()
    expect(screen.queryByText('Nota del homónimo')).toBeNull()
  })

  it('al reasignar el turno a otra ficha muestra sólo las notas de la nueva, sin arrastrar las anteriores', () => {
    const props = { notas, onAddNota: vi.fn(async () => true), onChangeEstado: vi.fn(), onDeleteTurno: vi.fn(), onEditTurno: vi.fn() }
    const { rerender } = render(<TurnoRow {...props} turno={turno} />)
    fireEvent.click(screen.getByRole('button', { name: 'Notas del cliente' }))
    expect(screen.getByText('Nota de la ficha uno')).toBeInTheDocument()
    rerender(<TurnoRow {...props} turno={{ ...turno, cliente_id: 2 }} />)
    expect(screen.getByText('Nota del homónimo')).toBeInTheDocument()
    expect(screen.queryByText('Nota de la ficha uno')).toBeNull()
    expect(screen.queryByText('Legado sin vínculo')).toBeNull()
  })

  it('un cliente_id null manda sobre un paciente_id viejo después de reasignar el turno', () => {
    abrir({ turno: { ...turno, cliente_id: null, paciente_id: 1 } })
    expect(screen.getByText('Sin notas todavía')).toBeInTheDocument()
    expect(screen.queryByText('Nota de la ficha uno')).toBeNull()
    expect(screen.getByRole('button', { name: 'Agregar nota' })).toBeDisabled()
  })

  it('envía el ID y conserva el contrato de texto, sin inferirlo del nombre', async () => {
    const props = abrir({ turno: { ...turno, cliente_id: '1' } })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  Nueva de Juan  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar nota' }))
    await waitFor(() => expect(props.onAddNota).toHaveBeenCalledWith({ cliente_id: '1', paciente: 'Juan', texto: 'Nueva de Juan' }))
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('no permite crear una nota de cliente cuando el turno no tiene ficha', () => {
    abrir({ turno: { ...turno, cliente_id: null } })
    expect(screen.getByText(/Vinculá el turno a una ficha/)).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Agregar nota' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Editar turno' })).toBeEnabled()
  })

  it.each([false, new Error('sin conexión')])('preserva el borrador cuando el guardado falla: %s', async (result) => {
    const onAddNota = vi.fn(async () => { if (result instanceof Error) throw result; return result })
    abrir({ onAddNota })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Borrador que no se pierde' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar nota' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar')
    expect(screen.getByRole('textbox')).toHaveValue('Borrador que no se pierde')
    expect(screen.getByRole('button', { name: 'Agregar nota' })).toBeEnabled()
    expect(onAddNota).toHaveBeenCalledTimes(1)
  })
})
