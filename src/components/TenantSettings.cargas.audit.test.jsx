import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TenantSettings from './TenantSettings'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn(), upload: vi.fn(), queryResult: {} }))
vi.mock('../lib/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: mocks.rpc,
    storage: { from: () => ({ remove: mocks.remove, upload: mocks.upload, getPublicUrl: () => ({ data: { publicUrl: 'https://mock.invalid/new-logo.png' } }) }) },
    from: table => {
      const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, update: () => query, delete: () => query,
        then: (resolve, reject) => Promise.resolve(mocks.queryResult[table] || { data: [], error: null }).then(resolve, reject) }
      return query
    },
  },
}))
vi.mock('./WhatsAppConnectionPanel.jsx', () => ({ default: () => null }))

const settings = (id = 928) => ({ id, nombre: `Negocio ${id}`, slug: `negocio-${id}`, descripcion: 'Descripción guardada', direccion: 'Calle prueba', zona_horaria: 'America/Argentina/Buenos_Aires', reservas_publicas: false, anticipacion_minutos: 90, max_dias_reserva: 45, intervalo_reserva_min: 30 })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const settingsCalls = name => mocks.rpc.mock.calls.filter(([method]) => method === name)

beforeEach(() => {
  vi.clearAllMocks()
  mocks.queryResult = {}
  mocks.remove.mockResolvedValue({ error: null })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.rpc.mockImplementation(async (name, args) => ({ data: name === 'create_barberia_invitation' ? { token: 'offline-invite' } : settings(args.p_barberia_id), error: null }))
})

describe('Configuración: lectura fallida y conservación de borradores', () => {
  it('una lectura fallida no permite guardar defaults; reintentar recupera los datos reales', async () => {
    const user = userEvent.setup()
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Lectura temporalmente fallida' } })
    render(<TenantSettings barberiaId={928} />)
    await screen.findByRole('alert')
    const save = screen.queryByRole('button', { name: 'Guardar configuración' })
    expect(save == null || save.disabled).toBe(true)
    expect(settingsCalls('update_tenant_settings')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: /Reintentar configuración/i }))
    expect(await screen.findByLabelText('Nombre comercial')).toHaveValue('Negocio 928')
    expect(screen.getByLabelText('Anticipación (min)')).toHaveValue(90)
    expect(screen.getByLabelText('Permitir reservas públicas')).not.toBeChecked()
  })

  it('una respuesta vacía no se convierte en configuración editable', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null })
    render(<TenantSettings barberiaId={928} />)
    await screen.findByRole('alert')
    expect(screen.queryByLabelText('Nombre comercial')).toBeNull()
    expect(settingsCalls('update_tenant_settings')).toHaveLength(0)
  })

  it('rechaza una configuración de otro negocio aunque llegue sin error de API', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: settings(929), error: null })
    render(<TenantSettings barberiaId={928} />)
    await screen.findByRole('alert')
    expect(screen.queryByLabelText('Nombre comercial')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reintentar configuración' })).toBeInTheDocument()
  })

  it('crear invitación conserva el borrador de configuración sin releerlo', async () => {
    const user = userEvent.setup()
    render(<TenantSettings barberiaId={928} />)
    const name = await screen.findByLabelText('Nombre comercial')
    await user.clear(name); await user.type(name, 'Borrador nuevo')
    await user.type(screen.getByRole('textbox', { name: 'Email de la invitación' }), 'prueba@example.invalid')
    await user.click(screen.getByRole('button', { name: 'Crear invitación' }))
    await screen.findByRole('textbox', { name: 'Enlace de invitación generado' })
    await waitFor(() => expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Borrador nuevo'))
    expect(settingsCalls('get_tenant_settings')).toHaveLength(1)
    expect(settingsCalls('update_tenant_settings')).toHaveLength(0)
  })

  it('cancelar una invitación tampoco reemplaza el borrador', async () => {
    const user = userEvent.setup()
    mocks.queryResult.barberia_invitaciones = { data: [{ id: 4, email: 'test@example.invalid', role: 'empleado', status: 'pending', expires_at: '2099-01-01T00:00:00Z' }], error: null }
    render(<TenantSettings barberiaId={928} />)
    const name = await screen.findByLabelText('Nombre comercial')
    await user.clear(name); await user.type(name, 'Borrador nuevo')
    await user.click(screen.getByRole('button', { name: 'Cancelar invitación para test@example.invalid' }))
    await waitFor(() => expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Borrador nuevo'))
    expect(settingsCalls('get_tenant_settings')).toHaveLength(1)
  })

  it('no deja cambiar campos ni enviar dos guardados mientras la RPC sigue pendiente', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    const branding = vi.fn()
    mocks.rpc.mockImplementation((name, args) => name === 'update_tenant_settings' ? pending.promise : Promise.resolve({ data: settings(args.p_barberia_id), error: null }))
    render(<TenantSettings barberiaId={928} onBrandingChange={branding} />)
    const name = await screen.findByLabelText('Nombre comercial')
    await user.clear(name); await user.type(name, 'Nombre enviado')
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    expect(screen.getByLabelText('Nombre comercial')).toBeDisabled()
    expect(screen.getByLabelText(/^Dirección de tu página de reservas/)).toBeDisabled()
    expect(screen.getByLabelText('Permitir reservas públicas')).toBeDisabled()
    fireEvent.submit(screen.getByLabelText('Nombre comercial').closest('form'))
    expect(settingsCalls('update_tenant_settings')).toHaveLength(1)
    expect(branding).not.toHaveBeenCalled()
    await act(async () => pending.resolve({ data: null, error: { message: 'Sin conexión' } }))
    expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Nombre enviado')
    expect(screen.getByLabelText('Nombre comercial')).toBeEnabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexión')
  })

  it('usa la respuesta guardada autoritativa sin otra lectura que pueda pisarla', async () => {
    const user = userEvent.setup()
    const branding = vi.fn()
    mocks.rpc.mockImplementation(async (name, args) => ({ data: name === 'update_tenant_settings' ? { ...settings(args.p_barberia_id), nombre: 'Nombre normalizado', slug: 'normalizado' } : settings(args.p_barberia_id), error: null }))
    render(<TenantSettings barberiaId={928} onBrandingChange={branding} />)
    await screen.findByLabelText('Nombre comercial')
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    await screen.findByText('Configuración guardada.')
    expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Nombre normalizado')
    expect(screen.getByLabelText(/^Dirección de tu página de reservas/)).toHaveValue('normalizado')
    expect(branding).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Nombre normalizado', zona_horaria: 'America/Argentina/Buenos_Aires' }))
    expect(settingsCalls('get_tenant_settings')).toHaveLength(1)
  })

  it.each([null, 929])('respuesta de guardado no verificable (%s) no anuncia éxito ni aplica branding', async (responseTenant) => {
    const user = userEvent.setup()
    const branding = vi.fn()
    mocks.rpc.mockImplementation(async (name, args) => ({ data: name === 'update_tenant_settings' ? responseTenant == null ? null : settings(responseTenant) : settings(args.p_barberia_id), error: null }))
    render(<TenantSettings barberiaId={928} onBrandingChange={branding} />)
    await screen.findByLabelText('Nombre comercial')
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('verificar')
    expect(screen.queryByText('Configuración guardada.')).toBeNull()
    expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Negocio 928')
    expect(branding).not.toHaveBeenCalled()
  })

  it('el error de limpiar un logo no desaparece cuando recarga la actividad', async () => {
    const user = userEvent.setup()
    const original = { ...settings(), logo_url: 'https://mock.invalid/old.png', logo_storage_path: '928/old.png' }
    mocks.rpc.mockImplementation(async (name, args) => ({ data: name === 'update_tenant_settings' ? { ...original, logo_url: args.p_logo_url, logo_storage_path: args.p_logo_storage_path } : original, error: null }))
    mocks.remove.mockResolvedValue({ error: { message: 'storage_unavailable' } })
    render(<TenantSettings barberiaId={928} />)
    await screen.findByLabelText('Nombre comercial')
    const file = new File(['fake-image'], 'logo.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Cargar logo'), file)
    await screen.findByText('Logo cargado. Guardá la configuración para publicarlo.')
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    await screen.findByText('Configuración guardada.')
    expect(await screen.findByRole('alert')).toHaveTextContent('limpiar el logo anterior')
    expect(mocks.remove).toHaveBeenCalledWith(['928/old.png'])
    expect(settingsCalls('get_tenant_settings')).toHaveLength(1)
  })

  it('una lectura tardía de otro negocio no rellena el negocio vigente', async () => {
    const old = deferred()
    mocks.rpc.mockImplementation((name, args) => args.p_barberia_id === 928 ? old.promise : Promise.resolve({ data: settings(args.p_barberia_id), error: null }))
    const { rerender } = render(<TenantSettings barberiaId={928} />)
    rerender(<TenantSettings barberiaId={929} />)
    expect(await screen.findByLabelText('Nombre comercial')).toHaveValue('Negocio 929')
    await act(async () => old.resolve({ data: settings(928), error: null }))
    expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Negocio 929')
  })

  it('terminar una invitación durante el reintento de configuración no invalida esa lectura', async () => {
    const user = userEvent.setup()
    const invite = deferred()
    const retry = deferred()
    let reads = 0
    mocks.rpc.mockImplementation((name) => {
      if (name === 'create_barberia_invitation') return invite.promise
      if (name === 'get_tenant_settings') return ++reads === 1
        ? Promise.resolve({ data: null, error: { message: 'Primera lectura fallida' } }) : retry.promise
      return Promise.resolve({ data: settings(), error: null })
    })
    render(<TenantSettings barberiaId={928} />)
    await screen.findByRole('alert')
    await user.type(screen.getByRole('textbox', { name: 'Email de la invitación' }), 'prueba@example.invalid')
    await user.click(screen.getByRole('button', { name: 'Crear invitación' }))
    await user.click(screen.getByRole('button', { name: 'Reintentar configuración' }))
    await act(async () => invite.resolve({ data: { token: 'offline-invite' }, error: null }))
    await act(async () => retry.resolve({ data: settings(), error: null }))
    expect(await screen.findByLabelText('Nombre comercial')).toHaveValue('Negocio 928')
    expect(screen.getByRole('button', { name: 'Guardar configuración' })).toBeEnabled()
  })

  it('el montaje doble de StrictMode ignora la lectura vieja del mismo negocio', async () => {
    const oldRead = deferred()
    mocks.rpc.mockImplementationOnce(() => oldRead.promise)
    render(<StrictMode><TenantSettings barberiaId={928} /></StrictMode>)
    expect(await screen.findByLabelText('Nombre comercial')).toHaveValue('Negocio 928')
    await act(async () => oldRead.resolve({ data: { ...settings(928), nombre: 'Lectura vieja' }, error: null }))
    expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Negocio 928')
    expect(settingsCalls('get_tenant_settings')).toHaveLength(2)
  })

  it('guardar el negocio anterior no publica branding en el nuevo después del cambio', async () => {
    const user = userEvent.setup()
    const oldSave = deferred()
    const branding = vi.fn()
    mocks.rpc.mockImplementation((name, args) => name === 'update_tenant_settings' ? oldSave.promise : Promise.resolve({ data: settings(args.p_barberia_id), error: null }))
    const { rerender } = render(<TenantSettings barberiaId={928} onBrandingChange={branding} />)
    await screen.findByLabelText('Nombre comercial')
    await user.click(screen.getByRole('button', { name: 'Guardar configuración' }))
    rerender(<TenantSettings barberiaId={929} onBrandingChange={branding} />)
    await screen.findByLabelText('Nombre comercial')
    await act(async () => oldSave.resolve({ data: settings(928), error: null }))
    expect(branding).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Nombre comercial')).toHaveValue('Negocio 929')
  })
})
