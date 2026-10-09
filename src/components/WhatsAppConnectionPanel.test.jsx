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
    invoke.mockResolvedValue({ data: { connection: qr(new Date(now.getTime() + 45000).toISOString()) } })
    await act(async () => render(<WhatsAppConnectionPanel barberiaId={928} />))
    expect(screen.getByRole('img')).toBeInTheDocument()
    await act(async () => vi.advanceTimersByTime(45000))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generar nuevo código' })).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledTimes(1)
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
