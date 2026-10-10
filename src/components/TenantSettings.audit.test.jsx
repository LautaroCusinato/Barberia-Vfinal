import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TenantSettings from './TenantSettings'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: mocks.rpc,
    from: () => {
      const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, then: resolve => Promise.resolve({ data: [], error: null }).then(resolve) }
      return query
    },
  },
}))
vi.mock('./WhatsAppConnectionPanel.jsx', () => ({ default: () => null }))

async function invitation() {
  const user = userEvent.setup()
  mocks.rpc.mockImplementation(async (name, args) => ({ error: null, data: name === 'create_barberia_invitation' ? { token: 'offline-test-invite' } : { id: args.p_barberia_id, nombre: 'Negocio QA', slug: 'negocio-qa' } }))
  render(<TenantSettings barberiaId={928} />)
  await user.type(await screen.findByRole('textbox', { name: 'Email de la invitación' }), 'prueba@example.invalid')
  await user.click(screen.getByRole('button', { name: 'Crear invitación' }))
  await screen.findByRole('textbox', { name: 'Enlace de invitación generado' })
  return user
}

describe('Auditoría de configuración: copiar una invitación', () => {
  it('no anuncia éxito si el navegador no tiene portapapeles; conserva enlace seleccionable', async () => {
    const user = await invitation()
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue(undefined)
    await user.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    expect(screen.queryByText('Enlace copiado para compartir manualmente.')).toBeNull()
    expect(screen.getByRole('alert')).toHaveTextContent(/copiar|portapapeles/i)
    expect(screen.getByRole('textbox', { name: 'Enlace de invitación generado' })).toHaveFocus()
  })

  it('permiso denegado no produce una promesa sin manejar ni un aviso falso', async () => {
    const user = await invitation()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    await user.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/copiar|portapapeles/i)
    expect(screen.queryByText('Enlace copiado para compartir manualmente.')).toBeNull()
    const link = screen.getByRole('textbox', { name: 'Enlace de invitación generado' })
    expect(link.value).toContain('/invitacion/offline-test-invite')
    expect(link.selectionStart).toBe(0)
    expect(link.selectionEnd).toBe(link.value.length)
  })

  it('sólo confirma que se copió después de que el navegador acepta escribir', async () => {
    const user = await invitation()
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    await user.click(screen.getByRole('button', { name: 'Copiar enlace' }))
    expect(write).toHaveBeenCalledOnce()
    expect(await screen.findByText('Enlace copiado para compartir manualmente.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
