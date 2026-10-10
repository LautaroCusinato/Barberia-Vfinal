import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TenantSettings from './TenantSettings'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn(), upload: vi.fn(), queryResult: {}, updates: [] }))
vi.mock('../lib/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: mocks.rpc,
    storage: { from: () => ({ remove: mocks.remove, upload: mocks.upload, getPublicUrl: () => ({ data: { publicUrl: 'https://mock.invalid/new-logo.png' } }) }) },
    from: table => {
      const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, delete: () => query,
        update: values => { mocks.updates.push({ table, values }); return query },
        then: (resolve, reject) => Promise.resolve(typeof mocks.queryResult[table] === 'function' ? mocks.queryResult[table]() : mocks.queryResult[table] || { data: [], error: null }).then(resolve, reject) }
      return query
    },
  },
}))
vi.mock('./WhatsAppConnectionPanel.jsx', () => ({ default: () => null }))

const settings = (id = 928) => ({ id, nombre: `Negocio ${id}`, slug: `negocio-${id}`, zona_horaria: 'America/Argentina/Buenos_Aires', reservas_publicas: true, anticipacion_minutos: 60, max_dias_reserva: 30, intervalo_reserva_min: 15 })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const calls = name => mocks.rpc.mock.calls.filter(([method]) => method === name)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryResult = {}
  mocks.updates = []
  mocks.remove.mockResolvedValue({ error: null })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.rpc.mockImplementation(async (name, args) => ({ data: name === 'create_barberia_invitation' ? { id: 77, token: 'offline-invite' } : settings(args.p_barberia_id), error: null }))
})

describe('Revisión independiente de Configuración (51/50)', () => {
  it('StrictMode: el reintento termina aunque la invitación y su recarga lleguen después', async () => {
    const user = userEvent.setup()
    const invite = deferred()
    const retry = deferred()
    const lists = deferred()
    let reads = 0
    let listReads = 0
    mocks.queryResult.barberia_invitaciones = () => (++listReads > 3 ? lists.promise : { data: [], error: null })
    mocks.rpc.mockImplementation((name) => {
      if (name === 'create_barberia_invitation') return invite.promise
      if (name === 'get_tenant_settings') return ++reads <= 2 ? Promise.resolve({ data: null, error: { message: 'Primera lectura fallida' } }) : retry.promise
      return Promise.resolve({ data: settings(), error: null })
    })
    render(<StrictMode><TenantSettings barberiaId={928} /></StrictMode>)
    await screen.findByRole('button', { name: 'Reintentar configuración' })
    await user.type(screen.getByRole('textbox', { name: 'Email de la invitación' }), 'prueba@example.invalid')
    await user.click(screen.getByRole('button', { name: 'Crear invitación' }))
    await user.click(screen.getByRole('button', { name: 'Reintentar configuración' }))
    await act(async () => retry.resolve({ data: settings(), error: null }))
    expect(await screen.findByLabelText('Nombre comercial')).toHaveValue('Negocio 928')
    await act(async () => invite.resolve({ data: { id: 77, token: 'offline-invite' }, error: null }))
    await act(async () => lists.resolve({ data: [{ id: 77, email: 'prueba@example.invalid', role: 'empleado', status: 'pending', expires_at: '2099-01-01T00:00:00Z' }], error: null }))
    expect(await screen.findByText('prueba@example.invalid')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Enlace de invitación generado' }).value).toContain('/invitacion/offline-invite')
    expect(screen.getByRole('button', { name: 'Guardar configuración' })).toBeEnabled()
  })

  it('dos envíos sincrónicos de la invitación crean una sola', async () => {
    const pending = deferred()
    mocks.rpc.mockImplementation((name, args) => name === 'create_barberia_invitation' ? pending.promise : Promise.resolve({ data: settings(args.p_barberia_id), error: null }))
    render(<TenantSettings barberiaId={928} />)
    const email = await screen.findByRole('textbox', { name: 'Email de la invitación' })
    fireEvent.change(email, { target: { value: 'prueba@example.invalid' } })
    act(() => { fireEvent.submit(email.closest('form')); fireEvent.submit(email.closest('form')) })
    expect(calls('create_barberia_invitation')).toHaveLength(1)
    await act(async () => pending.resolve({ data: { id: 77, token: 'offline-invite' }, error: null }))
  })

  it('el aviso de limpieza del logo sigue visible después de copiar el enlace o crear una invitación', async () => {
    const user = userEvent.setup()
    const original = { ...settings(), logo_url: 'https://mock.invalid/old.png', logo_storage_path: '928/old.png' }
    mocks.rpc.mockImplementation(async (name, args) => ({ data: name === 'create_barberia_invitation' ? { id: 77, token: 'offline-invite' } : name === 'update_tenant_settings' ? { ...original, logo_url: args.p_logo_url, logo_storage_path: args.p_logo_storage_path } : original, error: null }))
    mocks.remove.mockResolvedValue({ error: { message: 'storage_unavailable' } })
    render(<TenantSettings barberiaId={928} />)
    await screen.findByLabelText('Nombre comercial')
    await user.upload(screen.getByLabelText('Cargar logo'), new File(['x'], 'logo.png', { type: 'image/png' }))
    await screen.findByText('Logo cargado. Guardá la configuración para publicarlo.')
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    await screen.findByText('Configuración guardada.')
    await user.type(screen.getByRole('textbox', { name: 'Email de la invitación' }), 'prueba@example.invalid')
    await user.click(screen.getByRole('button', { name: 'Crear invitación' }))
    await screen.findByRole('textbox', { name: 'Enlace de invitación generado' })
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await user.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    await screen.findByText('Enlace copiado para compartir manualmente.')
    expect(screen.getByText(/limpiar el logo anterior/)).toBeInTheDocument()
  })

  it('no borra el logo anterior si la respuesta confirmada todavía lo usa', async () => {
    const user = userEvent.setup()
    const original = { ...settings(), logo_url: 'https://mock.invalid/old.png', logo_storage_path: '928/old.png' }
    mocks.rpc.mockImplementation(async () => ({ data: original, error: null }))
    render(<TenantSettings barberiaId={928} />)
    await screen.findByLabelText('Nombre comercial')
    await user.upload(screen.getByLabelText('Cargar logo'), new File(['x'], 'logo.png', { type: 'image/png' }))
    await screen.findByText('Logo cargado. Guardá la configuración para publicarlo.')
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    await screen.findByText('Configuración guardada.')
    expect(mocks.remove).not.toHaveBeenCalledWith(['928/old.png'])
  })

  it('cancelar la invitación recién creada retira el enlace para no copiar uno inválido', async () => {
    const user = userEvent.setup()
    mocks.queryResult.barberia_invitaciones = { data: [{ id: 77, email: 'prueba@example.invalid', role: 'empleado', status: 'pending', expires_at: '2099-01-01T00:00:00Z' }], error: null }
    render(<TenantSettings barberiaId={928} />)
    await user.type(await screen.findByRole('textbox', { name: 'Email de la invitación' }), 'prueba@example.invalid')
    await user.click(screen.getByRole('button', { name: 'Crear invitación' }))
    await screen.findByRole('textbox', { name: 'Enlace de invitación generado' })
    await user.click(screen.getByRole('button', { name: 'Cancelar invitación para prueba@example.invalid' }))
    await waitFor(() => expect(mocks.updates).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Enlace de invitación generado' })).toBeNull())
  })

  it('teclado: devuelve el foco al campo después de guardar con Enter', async () => {
    const pending = deferred()
    mocks.rpc.mockImplementation((name, args) => name === 'update_tenant_settings' ? pending.promise : Promise.resolve({ data: settings(args.p_barberia_id), error: null }))
    render(<TenantSettings barberiaId={928} />)
    const name = await screen.findByLabelText('Nombre comercial')
    name.focus()
    fireEvent.submit(name.closest('form'))
    // Chrome mueve el foco a <body> cuando el fieldset se deshabilita; jsdom no,
    // así que se reproduce a mano.
    document.body.tabIndex = -1
    act(() => document.body.focus())
    expect(document.activeElement).toBe(document.body)
    await act(async () => pending.resolve({ data: settings(), error: null }))
    await screen.findByText('Configuración guardada.')
    await waitFor(() => expect(screen.getByLabelText('Nombre comercial')).toHaveFocus())
    document.body.removeAttribute('tabindex')
  })

  it('teclado: no roba el foco si la persona ya se movió durante el guardado', async () => {
    const pending = deferred()
    mocks.rpc.mockImplementation((name, args) => name === 'update_tenant_settings' ? pending.promise : Promise.resolve({ data: settings(args.p_barberia_id), error: null }))
    render(<TenantSettings barberiaId={928} />)
    const name = await screen.findByLabelText('Nombre comercial')
    name.focus()
    fireEvent.submit(name.closest('form'))
    const email = screen.getByRole('textbox', { name: 'Email de la invitación' })
    act(() => email.focus())
    await act(async () => pending.resolve({ data: settings(), error: null }))
    await screen.findByText('Configuración guardada.')
    expect(email).toHaveFocus()
  })

  it('teclado: reintentar deja el foco en el primer campo o de nuevo en Reintentar', async () => {
    const user = userEvent.setup()
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Falla 1' } })
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Falla 2' } })
    render(<TenantSettings barberiaId={928} />)
    await user.click(await screen.findByRole('button', { name: 'Reintentar configuración' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar configuración' })).toHaveFocus())
    await user.click(screen.getByRole('button', { name: 'Reintentar configuración' }))
    await waitFor(() => expect(screen.getByLabelText('Nombre comercial')).toHaveFocus())
  })

  it('teclado: el selector de logo no está oculto para el orden de tabulación', async () => {
    render(<TenantSettings barberiaId={928} />)
    await screen.findByLabelText('Nombre comercial')
    const file = screen.getByLabelText('Cargar logo')
    expect(file.hidden).toBe(false)
    expect(file.tabIndex).toBe(0)
  })
})
