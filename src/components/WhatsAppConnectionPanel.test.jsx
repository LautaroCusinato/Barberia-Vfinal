import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WhatsAppConnectionPanel from './WhatsAppConnectionPanel'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/supabaseClient', () => ({ isSupabaseConfigured: true, supabase: { functions: { invoke } } }))
vi.mock('../lib/whatsappProvisioning.js', () => ({ WHATSAPP_DISCONNECT_SUPPORTED: true, WHATSAPP_PROVISION_FUNCTION: 'whatsapp-provision', provisioningAction: action => action }))
const qr = expiry => ({ state: 'QR_READY', qr_available: true, qr: 'data:image/png;base64,fixture', pairing_expires_at: expiry })

beforeEach(() => invoke.mockReset())
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('recuperación del QR de WhatsApp', () => {
  it('permite obtener otro código si quedó conectando sin un QR vigente', async () => {
    invoke.mockResolvedValueOnce({ data: { connection: { state: 'CONNECTING', qr_available: false } } })
      .mockResolvedValueOnce({ data: { connection: qr(new Date(Date.now() + 45000).toISOString()) } })
    render(<WhatsAppConnectionPanel barberiaId={928} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generar nuevo código' }))
    await screen.findByRole('img', { name: 'Código temporal para vincular WhatsApp' })
    expect(invoke).toHaveBeenLastCalledWith('whatsapp-provision', { body: { action: 'connect', tenant_id: 928 } })
  })

  it('retira el QR vencido y ofrece renovarlo sin desconectar el teléfono', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-10-09T18:00:00.000Z')
    vi.setSystemTime(now)
    // El servidor ya no tiene un código vigente: las consultas automáticas
    // responden CONNECTING sin QR y nunca piden conectar ni desconectar.
    invoke.mockResolvedValueOnce({ data: { connection: qr(new Date(now.getTime() + 45000).toISOString()) } })
      .mockResolvedValue({ data: { connection: { state: 'CONNECTING', qr_available: false } } })
    await act(async () => render(<WhatsAppConnectionPanel barberiaId={928} />))
    expect(screen.getByRole('img')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(45000))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar nuevo código' })).toBeInTheDocument()
    expect(invoke.mock.calls.every(([, request]) => request.body.action === 'status')).toBe(true)
  })

  it('al escanear el código pasa solo a Conectado y deja de consultar', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-10-10T18:00:00.000Z')
    vi.setSystemTime(now)
    invoke.mockResolvedValueOnce({ data: { connection: qr(new Date(now.getTime() + 45000).toISOString()) } })
      .mockResolvedValue({ data: { connection: { state: 'CONNECTED', qr_available: false, automation_enabled: true, outbound_enabled: true, booking_enabled: true } } })
    await act(async () => render(<WhatsAppConnectionPanel barberiaId={928} />))
    expect(screen.getByRole('img')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(4000))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('WhatsApp quedó vinculado. El asistente ya responde a tus clientes.')).toBeInTheDocument()
    expect(screen.getAllByText('Activas', { selector: 'strong' })).toHaveLength(2)
    const calls = invoke.mock.calls.length
    await act(async () => vi.advanceTimersByTime(12000))
    expect(invoke.mock.calls.length).toBe(calls)
  })

  it('no habilita regeneración si no pudo verificar el estado del servidor', async () => {
    invoke.mockResolvedValue({ error: new Error('provider unavailable') })
    render(<WhatsAppConnectionPanel barberiaId={928} />)
    await screen.findByRole('alert')
    expect(screen.queryByRole('button', { name: 'Generar nuevo código' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar verificación' })).toBeInTheDocument()
  })

  it('no genera QR ni desconecta al actualizar una conexión ya vinculada', async () => {
    invoke.mockResolvedValue({ data: { connection: { state: 'CONNECTED', qr_available: false } } })
    render(<WhatsAppConnectionPanel barberiaId={928} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Actualizar estado' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
    expect(invoke.mock.calls.every(([, request]) => request.body.action === 'status')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Generar nuevo código' })).not.toBeInTheDocument()
  })
})
