import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const signUp = vi.fn()
vi.mock('../lib/supabaseClient', () => ({ supabase: { auth: { signUp: (...args) => signUp(...args) } }, isSupabaseConfigured: true }))

const { default: Signup } = await import('./Signup.jsx')

function completar() {
  fireEvent.change(screen.getByLabelText(/nombre/i), { target: { value: 'Lautaro' } })
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'dueno@example.com' } })
  const [password, confirm] = document.querySelectorAll('input[type="password"]')
  fireEvent.change(password, { target: { value: 'clave-segura-1' } })
  fireEvent.change(confirm, { target: { value: 'clave-segura-1' } })
  fireEvent.submit(password.closest('form'))
}

describe('Signup', () => {
  beforeEach(() => signUp.mockReset())

  it('un email ya registrado no promete un mail que Supabase no envía', async () => {
    signUp.mockResolvedValue({ data: { user: { id: 'u1', identities: [] }, session: null }, error: null })
    render(<Signup />)
    completar()
    expect(await screen.findByRole('heading', { name: 'Ya tenés una cuenta' })).toBeTruthy()
    expect(screen.queryByText('Revisá tu email')).toBeNull()
    expect(screen.getByRole('button', { name: 'Recuperar contraseña' })).toBeTruthy()
  })

  it('una cuenta nueva pide confirmar el email', async () => {
    signUp.mockResolvedValue({ data: { user: { id: 'u2', identities: [{ id: 'i' }] }, session: null }, error: null })
    render(<Signup />)
    completar()
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Revisá tu email' })).toBeTruthy())
  })
})
