import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Notes from './Notes.jsx'
import Clientes from './Clientes.jsx'
import ClientDetailModal from './ClientDetailModal.jsx'
import { clienteDeNota, notaDelCliente } from '../lib/clientNotes.js'

// Regresión 43: notas.cliente_id es "on delete set null"
// (20260810171324_qa_base_schema.sql). Borrar una ficha deja sus notas sin
// vínculo y con el nombre como texto. Un cliente nuevo con el mismo nombre no
// debe heredarlas: sólo se asocian por ID, a mano.
const antes = {
  clientes: [{ id: 1, barberia_id: 10, nombre: 'Juan', telefono: '549110001' }],
  notas: [
    { id: 30, barberia_id: 10, cliente_id: 1, paciente: 'Juan', texto: 'Nota de la ficha borrada', fecha: '2026-09-01' },
    { id: 31, barberia_id: 10, cliente_id: null, paciente: 'Juan', texto: 'Nota anterior sin vínculo', fecha: '2026-08-01' },
  ],
}
// Lo que deja la base al borrar la ficha 1 (ON DELETE SET NULL) y crear otra "Juan".
function borrarYCrearHomonimo({ clientes, notas }) {
  const notasTrasBorrar = notas.map((nota) => (nota.cliente_id === 1 ? { ...nota, cliente_id: null } : nota))
  const nuevo = { id: 2, barberia_id: 10, nombre: 'Juan', telefono: '549110009' }
  return { clientes: [...clientes.filter((c) => c.id !== 1), nuevo], notas: notasTrasBorrar, nuevo }
}

describe('Notas: borrar cliente → crear homónimo (43)', () => {
  const { clientes, notas, nuevo } = borrarYCrearHomonimo(antes)

  it('el cliente nuevo no hereda notas por nombre', () => {
    for (const nota of notas) {
      expect(notaDelCliente(nota, nuevo)).toBe(false)
      expect(clienteDeNota(nota, clientes)).toBeNull()
    }
  })

  it('contador, ficha y Notas filtradas por la ficha nueva quedan vacíos', () => {
    const { unmount } = render(<Clientes pacientes={clientes} notas={notas} turnos={[]} onViewNotes={vi.fn()} />)
    const fila = screen.getAllByRole('row').find((row) => within(row).queryByText('Juan'))
    expect(within(fila).getByRole('button', { name: 'Ver', exact: true })).toBeInTheDocument()
    unmount()
    const ficha = render(<ClientDetailModal paciente={nuevo} turnos={[]} notas={notas} onClose={() => {}} />)
    expect(screen.queryByText('Nota de la ficha borrada')).toBeNull()
    expect(screen.queryByText('Nota anterior sin vínculo')).toBeNull()
    ficha.unmount()
    render(<Notes notas={notas} pacientes={clientes} filtroClienteId={nuevo.id} />)
    expect(screen.queryByText('Nota de la ficha borrada')).toBeNull()
    expect(screen.queryByText('Nota anterior sin vínculo')).toBeNull()
  })

  it('siguen en Todas las notas, marcadas sin vínculo', () => {
    render(<Notes notas={notas} pacientes={clientes} />)
    expect(screen.getByText('Nota de la ficha borrada')).toBeInTheDocument()
    expect(screen.getByText('Nota anterior sin vínculo')).toBeInTheDocument()
    expect(screen.getAllByText(/Sin vínculo a una ficha/)).toHaveLength(2)
  })

  it('se pueden asociar a mano a la ficha nueva, por ID', async () => {
    const onUpdate = vi.fn().mockResolvedValue(true)
    render(<Notes notas={notas} pacientes={clientes} onUpdate={onUpdate} />)
    const tarjeta = screen.getByText('Nota de la ficha borrada').closest('.note-card')
    fireEvent.click(within(tarjeta).getByRole('button', { name: 'Editar nota' }))
    fireEvent.change(within(tarjeta).getByLabelText('Cliente de esta nota'), { target: { value: String(nuevo.id) } })
    fireEvent.click(within(tarjeta).getByRole('button', { name: /Guardar/ }))
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(30, 'Nota de la ficha borrada', { cliente_id: 2, paciente: 'Juan' }))
  })
})
