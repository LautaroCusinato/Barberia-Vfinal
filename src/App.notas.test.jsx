import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.spyOn(window, 'scrollTo').mockImplementation(() => {}))

vi.mock('./lib/demoStore.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    saveDemoSnapshot: vi.fn(),
    getDemoSnapshot: () => ({
      ...original.getDemoSnapshot('43-local'),
      pacientes: [{id:1,nombre:'Juan',telefono:'549110001'}, {id:2,nombre:'Juan',telefono:'549110002'}],
      notas: [
        {id:7,cliente_id:1,paciente:'Nombre antiguo',texto:'Sólo ficha uno',fecha:'2026-10-07'},
        {id:8,cliente_id:2,paciente:'Juan',texto:'Sólo ficha dos',fecha:'2026-10-07'},
        {id:9,cliente_id:null,paciente:'Juan',texto:'Legado sin asignar',fecha:'2026-10-07'},
      ],
    }),
  }
})

import App from './App.jsx'

describe('App: recorrido Clientes → Notas por id (43), sólo demo', () => {
  it('filtra la ficha correcta, permite ver todas y crear una nota vinculada', async () => {
    window.history.replaceState({},'', '/demo?view=clientes')
    render(<App barberiaId={0} barberiaNombre="Demo" demoMode />)
    const table = await screen.findByRole('table')
    const row = within(table).getAllByRole('row')[1]
    fireEvent.click(within(row).getByRole('button',{name:'1',exact:true}))
    expect(await screen.findByText('Sólo ficha uno')).toBeInTheDocument()
    expect(screen.queryByText('Sólo ficha dos')).toBeNull()
    expect(screen.queryByText('Legado sin asignar')).toBeNull()
    fireEvent.click(screen.getByRole('button',{name:'Ver todas las notas'}))
    expect(await screen.findByText('Legado sin asignar')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Cliente de la nota'),{target:{value:'2'}})
    fireEvent.change(screen.getByLabelText('Contenido de la nota'),{target:{value:'Nueva de dos'}})
    fireEvent.click(screen.getByRole('button',{name:'Guardar nota'}))
    expect(await screen.findByText('Nueva de dos')).toBeInTheDocument()
    await waitFor(()=>expect(screen.getByLabelText('Contenido de la nota')).toHaveValue(''))
  })
})
