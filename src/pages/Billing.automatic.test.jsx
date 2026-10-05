import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'

// Modo automático (fase futura, no habilitada comercialmente): la UI debe
// seguir cerrada mientras el backend no habilite proveedor ni precio.
vi.mock('../lib/supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabaseUrl: 'https://qa.localhost',
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'token-de-prueba' } } }) },
    rpc: () => Promise.resolve({ data: [], error: null }),
  },
}))

vi.mock('../lib/commercialCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  COMMERCIAL_BILLING_MODE: 'automatic',
}))

const { default: Billing } = await import('./Billing.jsx')

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      tenant: { pais: 'AR' },
      access_state: 'active',
      subscription: { estado: 'active', plan_codigo: 'starter', precio: 50000, moneda: 'ARS', periodicidad: 'monthly' },
      providers: [{ codigo: 'mercadopago', nombre: 'Mercado Pago', activo: false, entorno: 'production' }],
      payments: [],
      invoices: [],
      production_checkout_ready: false,
    }),
  }))
})

it('sin proveedor habilitado no ofrece ningún cobro', async () => {
  render(<Billing barberiaId={1} />)
  expect(await screen.findByRole('heading', { name: 'Elegí cómo pagar' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Mercado Pago/ })).toBeChecked()
  expect(screen.getByRole('group', { name: 'Medio de pago' })).toBeInTheDocument()
  expect(screen.getByText('Pagos todavía no habilitados')).toBeInTheDocument()
  expect(screen.getByText('Procesamiento seguro')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Plan actual' })).toBeDisabled()
  expect(screen.queryByText(/Continuar con tarjeta/)).not.toBeInTheDocument()
})
