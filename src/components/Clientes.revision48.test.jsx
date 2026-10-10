import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ClientDetailModal from './ClientDetailModal'
import NewTurnoModal from './NewTurnoModal'

// Revisión independiente de la tarea 48: contraejemplos fuera de los casos
// que cubre Clientes.audit.test.jsx.
const FECHA = '2030-01-07'
const servicios = [{ id: 1, nombre: 'Corte', duracion: 30, precio: 8000, activo: true }]
const barberos = [{ id: 10, nombre: 'Mateo', horario: 'Lun a Vie 09:00-12:00', activo: true }]
const homonimos = [
  { id: 100, nombre: 'Ana Pérez', telefono: '5491155221234' },
  { id: 101, nombre: 'Ana Pérez', telefono: '5493515551234' },
]
const turnoBase = { id: 77, fecha: FECHA, hora: '11:00', barbero_id: 10, servicio_id: 1, estado: 'confirmado', motivo: 'Corte', paciente: 'Ana Pérez', duracion: 30, precio: 8000 }

function editar(turnoExistente) {
  render(<NewTurnoModal open onClose={vi.fn()} onSubmit={vi.fn()} defaultDate={FECHA} servicios={servicios} barberos={barberos} clientes={homonimos} turnoExistente={turnoExistente} />)
}

describe('Revisión 48: identidad del turno', () => {
  it('cliente_id null explícito gana sobre un paciente_id viejo de demo', () => {
    // guardarTurno en demo hace { ...t, ...payload, cliente_id: null } y deja
    // paciente_id intacto cuando el turno se reasigna a alguien sin ficha.
    render(<ClientDetailModal paciente={homonimos[0]} notas={[]} onClose={vi.fn()} turnos={[
      { ...turnoBase, paciente: 'Otra persona', paciente_id: 100, cliente_id: null },
    ]} />)
    expect(screen.getByText('Turnos (0)')).toBeInTheDocument()
  })

  it('editar un turno sin ID no elige un homónimo por nombre', () => {
    editar({ ...turnoBase, cliente_id: null })
    expect(screen.queryByText('5491155221234')).toBeNull()
    expect(screen.getByPlaceholderText('Nombre y apellido')).toHaveValue('Ana Pérez')
  })

  it('editar un turno con ID string vincula ese cliente y no el primer homónimo', () => {
    editar({ ...turnoBase, cliente_id: '101' })
    expect(screen.getByText('5493515551234')).toBeInTheDocument()
    expect(screen.queryByText('5491155221234')).toBeNull()
  })

  it('editar un turno demo con paciente_id vincula por ese ID', () => {
    editar({ ...turnoBase, paciente_id: 101 })
    expect(screen.getByText('5493515551234')).toBeInTheDocument()
    expect(screen.queryByText('5491155221234')).toBeNull()
  })
})
