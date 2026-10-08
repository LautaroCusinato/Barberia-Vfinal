import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Notes from './Notes.jsx'
import Clientes from './Clientes.jsx'
import ClientDetailModal from './ClientDetailModal.jsx'
import { clienteLegadoDeNota, notaDelCliente } from '../lib/clientNotes.js'

// Revisión 43: las notas creadas antes de la tarea no tienen cliente_id (el
// alta nunca lo guardaba). Con un único cliente de ese nombre siguen en su
// ficha, marcadas como vínculo por nombre; con homónimos, no se atribuyen.
const clientes = [
  { id: 1, barberia_id: 10, nombre: 'Ana Pérez', telefono: '549110001' },
  { id: 2, barberia_id: 10, nombre: 'Juan', telefono: '549110002' },
  { id: 3, barberia_id: 10, nombre: 'Juan', telefono: '549110003' },
]
const notas = [
  { id: 20, cliente_id: null, paciente: 'Ana Pérez', texto: 'Nota anterior de Ana', fecha: '2026-09-01' },
  { id: 21, cliente_id: null, paciente: 'Juan', texto: 'Nota anterior ambigua', fecha: '2026-09-01' },
  { id: 22, cliente_id: null, paciente: 'General', texto: 'Nota general', fecha: '2026-09-01' },
  { id: 23, cliente_id: 1, paciente: 'Ana Pérez', texto: 'Nota nueva de Ana', fecha: '2026-10-07' },
]

describe('Notas anteriores sin cliente_id — revisión 43', () => {
  it('sólo se vinculan por nombre con un único candidato del mismo negocio', () => {
    expect(clienteLegadoDeNota(notas[0], clientes)?.id).toBe(1)
    expect(clienteLegadoDeNota(notas[1], clientes)).toBeNull()
    expect(clienteLegadoDeNota(notas[2], [...clientes, { id: 9, nombre: 'General' }])).toBeNull()
    expect(clienteLegadoDeNota({ ...notas[0], barberia_id: 99 }, clientes)).toBeNull()
    expect(clienteLegadoDeNota(notas[0], [{ ...clientes[0], nombre: 'Ana Pérez Gómez' }])).toBeNull()
    // Una nota con cliente_id nunca se reasigna por nombre.
    expect(notaDelCliente({ cliente_id: 3, paciente: 'Ana Pérez' }, clientes[0], clientes)).toBe(false)
    // Sin la lista de clientes no hay vínculo por nombre.
    expect(notaDelCliente(notas[0], clientes[0])).toBe(false)
  })

  it('la ficha y el contador las incluyen; los homónimos no', () => {
    render(<Clientes pacientes={clientes} notas={notas} turnos={[]} onViewNotes={vi.fn()} />)
    const filas = screen.getAllByRole('row')
    const fila = (nombre, i = 0) => filas.filter((row) => within(row).queryByText(nombre))[i]
    expect(within(fila('Ana Pérez')).getByRole('button', { name: '2', exact: true })).toBeInTheDocument()
    expect(within(fila('Juan', 0)).getByRole('button', { name: 'Ver', exact: true })).toBeInTheDocument()
    expect(within(fila('Juan', 1)).getByRole('button', { name: 'Ver', exact: true })).toBeInTheDocument()
  })

  it('el detalle de la ficha muestra la nota anterior de su único candidato', () => {
    render(<ClientDetailModal paciente={clientes[0]} clientes={clientes} turnos={[]} notas={notas} onClose={() => {}} />)
    expect(screen.getByText('Nota anterior de Ana')).toBeInTheDocument()
    expect(screen.getByText('Nota nueva de Ana')).toBeInTheDocument()
    expect(screen.queryByText('Nota anterior ambigua')).toBeNull()
  })

  it('en Notas filtradas por ficha aparece marcada como vínculo por nombre', () => {
    render(<Notes notas={notas} pacientes={clientes} filtroClienteId={1} />)
    expect(screen.getByText('Nota anterior de Ana')).toBeInTheDocument()
    expect(screen.getByText(/Nota anterior, vinculada por nombre/)).toBeInTheDocument()
    expect(screen.queryByText('Nota anterior ambigua')).toBeNull()
    expect(screen.queryByText('Nota general')).toBeNull()
  })
})
