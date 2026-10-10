import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const escenario = vi.hoisted(() => ({ clienteDisponible: true, nombreActual: 'Juan' }))

vi.mock('./lib/demoStore.js', async (importOriginal) => {
  const original = await importOriginal()
  return {
    ...original,
    saveDemoSnapshot: vi.fn(),
    getDemoSnapshot: () => {
      const seed = original.getDemoSnapshot('55-local')
      return {
        ...seed,
        pacientes: [
          ...(escenario.clienteDisponible ? [{ id: 1, nombre: escenario.nombreActual, telefono: '549110001' }] : []),
          { id: 2, nombre: 'Juan', telefono: '549110002' },
        ],
        turnos: [{ ...seed.turnos[0], paciente: 'Juan', paciente_id: 1 }],
        notas: [{ id: 8, cliente_id: 2, paciente: 'Juan', texto: 'Sólo ficha dos', fecha: seed.turnos[0].fecha }],
      }
    },
  }
})

import App from './App.jsx'
import { saveDemoSnapshot } from './lib/demoStore.js'

beforeEach(() => {
  escenario.clienteDisponible = true
  escenario.nombreActual = 'Juan'
  saveDemoSnapshot.mockClear()
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

describe('App: nota desde Agenda → ficha y Notas (55), sólo demo', () => {
  it('crea la nota para el cliente del turno y la conserva en su ficha, sin el homónimo', async () => {
    window.history.replaceState({}, '', '/demo?view=resumen')
    render(<App barberiaId={0} barberiaNombre="Demo" demoMode demoSessionId="55-local" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notas del cliente' }))
    expect(screen.queryByText('Sólo ficha dos')).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Creada desde el turno' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar nota' }))
    expect(await screen.findByText('Creada desde el turno')).toBeInTheDocument()
    await waitFor(() => {
      const snapshot = saveDemoSnapshot.mock.calls.at(-1)?.[1]
      expect(snapshot?.notas.find((n) => n.texto === 'Creada desde el turno')).toMatchObject({ cliente_id: 1, paciente: 'Juan' })
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Clientes', exact: true })[0])
    const table = await screen.findByRole('table')
    fireEvent.click(within(within(table).getAllByRole('row')[1]).getByRole('button', { name: '1', exact: true }))
    expect(await screen.findByText('Creada desde el turno')).toBeInTheDocument()
    expect(screen.queryByText('Sólo ficha dos')).toBeNull()
  })

  it('resuelve el nombre vigente de la ficha aunque el turno conserve el anterior', async () => {
    escenario.nombreActual = 'Juan Nuevo'
    window.history.replaceState({}, '', '/demo?view=resumen')
    render(<App barberiaId={0} barberiaNombre="Demo" demoMode demoSessionId="55-local" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notas del cliente' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Nota tras renombrar' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar nota' }))
    await waitFor(() => {
      const snapshot = saveDemoSnapshot.mock.calls.at(-1)?.[1]
      expect(snapshot?.notas.find((n) => n.texto === 'Nota tras renombrar')).toMatchObject({ cliente_id: 1, paciente: 'Juan Nuevo' })
    })
  })

  it('si ya no existe la ficha, rechaza el guardado y conserva el borrador', async () => {
    escenario.clienteDisponible = false
    window.history.replaceState({}, '', '/demo?view=resumen')
    render(<App barberiaId={0} barberiaNombre="Demo" demoMode demoSessionId="55-local" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Notas del cliente' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Borrador para ficha eliminada' } })
    fireEvent.click(screen.getByRole('button', { name: 'Agregar nota' }))
    expect(await screen.findByText('No se pudo guardar la nota. El borrador quedó preservado.')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('Borrador para ficha eliminada')
    expect(saveDemoSnapshot.mock.calls.at(-1)[1].notas).toHaveLength(1)
  })
})
