import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Notes from './Notes.jsx'
import Clientes from './Clientes.jsx'
import ClientDetailModal from './ClientDetailModal.jsx'

const clientes = [{ id: 1, nombre: 'Juan', telefono: '549110001' }, { id: 2, nombre: 'Juan', telefono: '549110002' }]
const notas = [
  { id: 7, cliente_id: 1, paciente: 'Nombre anterior', texto: 'Nota de uno', fecha: '2026-10-07' },
  { id: 8, cliente_id: 2, paciente: 'Juan', texto: 'Nota de dos', fecha: '2026-10-07' },
  { id: 9, cliente_id: null, paciente: 'Juan', texto: 'Legado ambiguo', fecha: '2026-10-07' },
]

describe('Notas: identidad estable de cliente (43)', () => {
  it('crea la nota con el id elegido, no sólo el nombre repetido', async () => {
    const onAdd = vi.fn().mockResolvedValue(true)
    render(<Notes notas={[]} pacientes={clientes} onAdd={onAdd} />)
    fireEvent.change(screen.getByLabelText('Cliente de la nota'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('Contenido de la nota'), { target: { value: 'Sólo para dos' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nota' }))
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith({ paciente: 'Juan', cliente_id: 2, texto: 'Sólo para dos' }))
  })

  it('la ficha incluye sólo notas con el id correcto, incluso después de renombrar', () => {
    render(<ClientDetailModal paciente={{...clientes[0],nombre:'Juan Nuevo'}} pacientes={clientes} turnos={[]} notas={notas} onClose={() => {}} />)
    expect(screen.getByText('Nota de uno')).toBeInTheDocument()
    expect(screen.queryByText('Nota de dos')).toBeNull()
    expect(screen.queryByText('Legado ambiguo')).toBeNull()
  })

  it('Ver notas pasa el id de la ficha y cuenta sólo vínculos explícitos', () => {
    const onViewNotes = vi.fn()
    render(<Clientes pacientes={clientes} notas={notas} turnos={[]} onViewNotes={onViewNotes} />)
    const row = screen.getAllByRole('row')[1]
    const noteButton = within(row).getByRole('button', {name:'1',exact:true})
    fireEvent.click(noteButton)
    expect(onViewNotes).toHaveBeenCalledWith(1)
  })

  it('no atribuye notas sin id a una ficha por coincidencia de nombre', () => {
    render(<Notes notas={notas} pacientes={clientes} filtroClienteId={1} />)
    expect(screen.getByLabelText('Cliente de la nota')).toHaveValue('1')
    expect(screen.getByText('Nota de uno')).toBeInTheDocument()
    expect(screen.queryByText('Nota de dos')).toBeNull()
    expect(screen.queryByText('Legado ambiguo')).toBeNull()
  })

  it('sin filtro de ficha conserva el legado y permite vincularlo explícitamente', async () => {
    const onUpdate = vi.fn().mockResolvedValue(true)
    render(<Notes notas={[notas[2]]} pacientes={clientes} onUpdate={onUpdate} />)
    expect(screen.getByText('Legado ambiguo')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Editar nota'}))
    fireEvent.change(screen.getByLabelText('Cliente de esta nota'),{target:{value:'2'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar',exact:true}))
    await waitFor(()=>expect(onUpdate).toHaveBeenCalledWith(9,'Legado ambiguo',{cliente_id:2,paciente:'Juan'}))
  })

  it('un error de creación conserva texto y selección', async () => {
    render(<Notes notas={[]} pacientes={clientes} onAdd={vi.fn().mockResolvedValue(false)} />)
    fireEvent.change(screen.getByLabelText('Cliente de la nota'),{target:{value:'2'}})
    fireEvent.change(screen.getByLabelText('Contenido de la nota'),{target:{value:'Borrador'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar nota'}))
    expect(await screen.findByText(/El borrador quedó preservado/)).toBeInTheDocument()
    expect(screen.getByLabelText('Cliente de la nota')).toHaveValue('2')
    expect(screen.getByLabelText('Contenido de la nota')).toHaveValue('Borrador')
  })

  it('cliente llamado General es distinto de una nota general', async () => {
    const onAdd = vi.fn().mockResolvedValue(true)
    render(<Notes notas={[]} pacientes={[{id:3,nombre:'General'}]} onAdd={onAdd} />)
    fireEvent.change(screen.getByLabelText('Cliente de la nota'),{target:{value:'3'}})
    fireEvent.change(screen.getByLabelText('Contenido de la nota'),{target:{value:'Nota vinculada'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar nota'}))
    await waitFor(()=>expect(onAdd).toHaveBeenCalledWith({cliente_id:3,paciente:'General',texto:'Nota vinculada'}))
  })

  it('conserva la vinculación elegida y texto si falla editar una nota antigua', async () => {
    render(<Notes notas={[notas[2]]} pacientes={clientes} onUpdate={vi.fn().mockResolvedValue(false)} />)
    fireEvent.click(screen.getByRole('button',{name:'Editar nota'}))
    fireEvent.change(screen.getByLabelText('Cliente de esta nota'),{target:{value:'2'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar',exact:true}))
    expect(await screen.findByText(/El texto quedó preservado/)).toBeInTheDocument()
    expect(screen.getByLabelText('Cliente de esta nota')).toHaveValue('2')
    expect(screen.getByDisplayValue('Legado ambiguo')).toBeInTheDocument()
  })

  it('ficha desaparecida no termina guardando una nota general en su lugar', async () => {
    const onAdd=vi.fn()
    const {rerender}=render(<Notes notas={[]} pacientes={clientes} onAdd={onAdd} />)
    fireEvent.change(screen.getByLabelText('Cliente de la nota'),{target:{value:'2'}})
    fireEvent.change(screen.getByLabelText('Contenido de la nota'),{target:{value:'Pendiente'}})
    rerender(<Notes notas={[]} pacientes={[clientes[0]]} onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button',{name:'Guardar nota'}))
    expect(screen.getByText(/El cliente ya no está disponible/)).toBeInTheDocument()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
