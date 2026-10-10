import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => {
  const state = { db: {}, writes: [] }
  const supabase = {
    from(table) {
      const query = { table, filters: {}, op: 'select', payload: null }
      const api = {
        select: () => api, order: () => api, limit: () => api, in: () => api, gte: () => api, lt: () => api, lte: () => api,
        eq: (key, value) => { query.filters[key] = value; return api },
        update: payload => { query.op = 'update'; query.payload = payload; return api },
        insert: payload => { query.op = 'insert'; query.payload = payload; return api },
        delete: () => { query.op = 'delete'; return api },
        maybeSingle: () => { query.single = true; return api }, single: () => { query.single = true; return api },
        then: (resolve, reject) => Promise.resolve().then(() => {
          if (query.op !== 'select') return new Promise((done, fail) => state.writes.push({ ...query,
            finish: (error = null, { empty = false } = {}) => {
              const matches = (state.db[table] || []).filter(row => Object.entries(query.filters).every(([key, value]) => row[key] === value))
              if (!error && !empty && query.op === 'update') state.db[table] = (state.db[table] || []).map(row => matches.includes(row) ? { ...row, ...query.payload } : row)
              done({ data: error ? null : empty ? [] : matches.map(row => ({ id: row.id })), error })
            }, reject: fail,
          }))
          const data = (state.db[table] || []).filter(row => Object.entries(query.filters).every(([key, value]) => row[key] === value)).map(row => ({ ...row }))
          return { data: query.single ? data[0] ?? null : data, error: null }
        }).then(resolve, reject),
      }
      return api
    },
    rpc: async () => ({ data: { access_state: 'active' }, error: null }),
    functions: { invoke: async () => ({ data: null, error: null }) },
    channel: () => { const channel = { on: () => channel, subscribe: () => channel }; return channel },
    removeChannel: () => {}, auth: { getSession: async () => ({ data: { session: null } }) }, realtime: { setAuth: async () => {} },
  }
  return { state, supabase }
})
vi.mock('./lib/supabaseClient', () => ({ supabase: mock.supabase, supabaseUrl: 'http://mock.invalid', isSupabaseConfigured: true }))
vi.mock('./lib/observability.js', () => ({ reportClientError: vi.fn() }))
import App from './App.jsx'

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  mock.state.db = {
    barberias: [{ id: 928, nombre: 'Negocio simulado', zona_horaria: 'America/Argentina/Buenos_Aires' }],
    servicios: [{ id: 11, barberia_id: 928, nombre: 'Corte', descripcion: '', precio: 100, duracion_min: 30, activo: true }],
    barberos: [{ id: 7, barberia_id: 928, nombre: 'Mateo', color: '#9b6a2f', horario_texto: 'Lun 09:00-18:00', habilidades: '', activo: true }],
  }
  mock.state.writes = []
  window.history.replaceState(null, '', '/?view=operacion')
})
const writes = table => mock.state.writes.filter(query => query.table === table)
async function open() {
  render(<App barberiaId={928} barberiaNombre="Negocio simulado" />)
  return screen.findByLabelText('Nombre del servicio *')
}
const fail = { code: '42501', message: 'Rechazo simulado' }

describe('Operación: rollback por campo y resultado confirmado', () => {
  it('un nombre rechazado no revierte un precio guardado mientras tanto', async () => {
    const name = await open()
    fireEvent.change(name, { target: { value: 'Nombre rechazado' } })
    await waitFor(() => expect(writes('servicios')).toHaveLength(1))
    fireEvent.change(screen.getByLabelText('Precio ($) *'), { target: { value: '300' } })
    await waitFor(() => expect(writes('servicios')).toHaveLength(2))
    await act(async () => writes('servicios')[1].finish())
    await act(async () => writes('servicios')[0].finish(fail))
    expect(screen.getByLabelText('Nombre del servicio *')).toHaveValue('Corte')
    expect(screen.getByLabelText('Precio ($) *')).toHaveValue(300)
    expect(mock.state.db.servicios[0].precio).toBe(300)
  })

  it('si A se guarda y B falla en la misma cola, vuelve a A y no al valor inicial', async () => {
    const name = await open()
    fireEvent.change(name, { target: { value: 'Nombre A' } })
    await waitFor(() => expect(writes('servicios')).toHaveLength(1))
    fireEvent.change(name, { target: { value: 'Nombre B' } })
    await act(async () => writes('servicios')[0].finish())
    await waitFor(() => expect(writes('servicios')).toHaveLength(2))
    await act(async () => writes('servicios')[1].finish(fail))
    expect(screen.getByLabelText('Nombre del servicio *')).toHaveValue('Nombre A')
    expect(mock.state.db.servicios[0].nombre).toBe('Nombre A')
  })

  it('un error de API del profesional no deja el nombre optimista como guardado', async () => {
    await open()
    const name = screen.getByLabelText('Nombre *')
    fireEvent.change(name, { target: { value: 'Nombre rechazado' } })
    await waitFor(() => expect(writes('barberos')).toHaveLength(1))
    await act(async () => writes('barberos')[0].finish(fail))
    expect(screen.getByLabelText('Nombre *')).toHaveValue('Mateo')
    expect(mock.state.db.barberos[0].nombre).toBe('Mateo')
  })

  it('el profesional vuelve al último nombre confirmado de su cola', async () => {
    await open()
    const name = screen.getByLabelText('Nombre *')
    fireEvent.change(name, { target: { value: 'Nombre A' } })
    await waitFor(() => expect(writes('barberos')).toHaveLength(1))
    fireEvent.change(name, { target: { value: 'Nombre B' } })
    await act(async () => writes('barberos')[0].finish())
    await waitFor(() => expect(writes('barberos')).toHaveLength(2))
    await act(async () => writes('barberos')[1].finish(fail))
    expect(screen.getByLabelText('Nombre *')).toHaveValue('Nombre A')
    expect(mock.state.db.barberos[0].nombre).toBe('Nombre A')
  })

  it('una excepción de nombre del profesional conserva su color guardado', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Nombre *'), { target: { value: 'Nombre incierto' } })
    await waitFor(() => expect(writes('barberos')).toHaveLength(1))
    fireEvent.change(screen.getByLabelText('Color del barbero'), { target: { value: '#112233' } })
    await waitFor(() => expect(writes('barberos')).toHaveLength(2))
    await act(async () => writes('barberos')[1].finish())
    await act(async () => writes('barberos')[0].reject(new Error('Red caída')))
    expect(screen.getByLabelText('Nombre *')).toHaveValue('Mateo')
    expect(screen.getByLabelText('Color del barbero')).toHaveValue('#112233')
    expect(mock.state.db.barberos[0].color).toBe('#112233')
  })

  it.each([
    ['servicios', 'Nombre del servicio *', 'Corte'],
    ['barberos', 'Nombre *', 'Mateo'],
  ])('cero filas actualizadas en %s no se toma como guardado confirmado', async (table, label, original) => {
    await open()
    fireEvent.change(screen.getByLabelText(label), { target: { value: 'Cambio sin permiso' } })
    await waitFor(() => expect(writes(table)).toHaveLength(1))
    await act(async () => writes(table)[0].finish(null, { empty: true }))
    expect(screen.getByLabelText(label)).toHaveValue(original)
    expect(await screen.findByText('No se pudo guardar. Intentá de nuevo.')).toBeInTheDocument()
    expect(writes(table)[0].filters).toEqual({ id: table === 'servicios' ? 11 : 7, barberia_id: 928 })
  })

  it('una excepción vieja del profesional no descarta una edición más nueva pendiente', async () => {
    await open()
    const name = screen.getByLabelText('Nombre *')
    fireEvent.change(name, { target: { value: 'Nombre A' } })
    await waitFor(() => expect(writes('barberos')).toHaveLength(1))
    fireEvent.change(name, { target: { value: 'Nombre B' } })
    await act(async () => writes('barberos')[0].reject(new Error('Falla primera petición')))
    await waitFor(() => expect(writes('barberos')).toHaveLength(2))
    expect(writes('barberos')[1].payload).toEqual({ nombre: 'Nombre B' })
    await act(async () => writes('barberos')[1].finish())
    expect(screen.getByLabelText('Nombre *')).toHaveValue('Nombre B')
    expect(mock.state.db.barberos[0].nombre).toBe('Nombre B')
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
