import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configured: true,
  session: { access_token: 'token-de-prueba' },
  continuationHref: '',
  rpc: null,
}))

vi.mock('../lib/supabaseClient', () => ({
  get isSupabaseConfigured() { return mocks.configured },
  supabaseUrl: 'https://qa.localhost',
  supabase: {
    auth: { getSession: () => Promise.resolve({ data: { session: mocks.session } }) },
    rpc: (...args) => mocks.rpc(...args),
  },
}))

vi.mock('../lib/commercialCatalog.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getTrialContinuationWhatsAppHref: () => mocks.continuationHref,
}))

const { default: Billing } = await import('./Billing.jsx')

const DAY = 24 * 60 * 60 * 1000
const inDays = (days) => new Date(Date.now() + days * DAY - 60_000).toISOString()

function portalWith(subscription = {}, extra = {}) {
  return {
    tenant: { pais: 'AR', billing_email: '' },
    access_state: subscription.estado || 'active',
    subscription: { estado: 'active', plan_codigo: 'starter', precio: 50000, moneda: 'ARS', periodicidad: 'monthly', trial_ends_at: null, current_period_end: null, ...subscription },
    providers: [],
    payments: [],
    invoices: [],
    ...extra,
  }
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const fail = (status, code, message = 'Error del backend') => ({ ok: false, status, json: async () => ({ error: { code, message } }) })

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

let fetchMock

beforeEach(() => {
  mocks.configured = true
  mocks.session = { access_token: 'token-de-prueba' }
  mocks.continuationHref = ''
  mocks.rpc = vi.fn(() => Promise.resolve({ data: [], error: null }))
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('requestAnimationFrame', (callback) => callback())
  window.history.replaceState(null, '', '/facturacion')
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('Billing · estados de carga y disponibilidad', () => {
  it('muestra el esqueleto accesible mientras consulta', async () => {
    const pending = deferred()
    fetchMock.mockReturnValueOnce(pending.promise)
    render(<Billing barberiaId={1} />)
    expect(screen.getByRole('status', { name: 'Cargando facturación' })).toHaveAttribute('aria-busy', 'true')
    pending.resolve(ok(portalWith()))
    expect(await screen.findByRole('heading', { name: 'Tu plan está activo' })).toBeInTheDocument()
  })

  it('sin backend configurado explica que no está disponible y no ofrece actualizar', () => {
    mocks.configured = false
    render(<Billing barberiaId={1} />)
    expect(screen.getByRole('heading', { name: 'Facturación' })).toBeInTheDocument()
    expect(screen.getByText('Facturación no disponible')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /actualizar/i })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('consulta sólo billing-api con el token de la sesión, sin enviar el tenant', async () => {
    fetchMock.mockResolvedValueOnce(ok(portalWith()))
    render(<Billing barberiaId={77} />)
    await screen.findByRole('heading', { name: 'Tu plan está activo' })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://qa.localhost/functions/v1/billing-api/status')
    expect(options.method).toBe('GET')
    expect(options.body).toBeUndefined()
    expect(String(url)).not.toMatch(/77/)
  })
})

describe('Billing · estado de la cuenta', () => {
  it('prueba activa: días restantes, sin cargo y continuidad manual', async () => {
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'trialing', trial_ends_at: inDays(5) })))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'Prueba gratuita · 5 días restantes' })).toBeInTheDocument()
    expect(screen.getByText('Sin cargo durante la prueba')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Continuá por WhatsApp' })).toBeInTheDocument()
    expect(screen.getByText(/no se ofrecen Mercado Pago, PayPal, tarjetas ni suscripciones automáticas/)).toBeInTheDocument()
    expect(screen.getByText('Todavía no hay pagos registrados.')).toBeInTheDocument()
    expect(screen.getByText('Todavía no hay comprobantes.')).toBeInTheDocument()
    // En modo manual no se habla de precios externos ni de un checkout.
    expect(screen.queryByText(/referencia base|precio externo|Elegí cómo pagar/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Procesamiento seguro')).not.toBeInTheDocument()
  })

  it('un día restante usa singular', async () => {
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'trialing', trial_ends_at: inDays(1) })))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'Prueba gratuita · 1 día restante' })).toBeInTheDocument()
  })

  it('prueba vencida: aviso exacto y enlace de continuidad por WhatsApp', async () => {
    mocks.continuationHref = 'https://wa.me/5490000000000?text=hola'
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'trialing', trial_ends_at: inDays(-2) })))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'Tu período de prueba terminó.' })).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: /Quiero seguir usando Austral/ })
    expect(cta).toHaveAttribute('href', mocks.continuationHref)
    expect(cta).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Prueba finalizada')).toBeInTheDocument()
    // La CTA del panel manual no se duplica tras la prueba.
    expect(screen.queryByRole('link', { name: /Hablar con el equipo/ })).not.toBeInTheDocument()
  })

  it('prueba vencida sin número comercial configurado muestra el texto alternativo', async () => {
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'expired', trial_ends_at: inDays(-1) })))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByText(/Escribinos al equipo de Austral para continuar/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Quiero seguir usando Austral/ })).not.toBeInTheDocument()
  })

  it.each([
    ['past_due', 'Hay un pago pendiente', 'warning'],
    ['suspended', 'La cuenta está suspendida', 'danger'],
    ['canceled', 'La suscripción fue cancelada', 'danger'],
    ['payment_review', 'Estamos revisando un pago', 'warning'],
    ['paused', 'La suscripción está pausada', 'neutral'],
    ['algo_nuevo', 'Estado de la suscripción', 'neutral'],
  ])('estado %s se explica con su tono', async (estado, title, tone) => {
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado })))
    render(<Billing barberiaId={1} />)
    const heading = await screen.findByRole('heading', { name: title })
    expect(heading.closest('section')).toHaveAttribute('data-billing-tone', tone)
  })

  it('plan activo con historial: montos, estados traducidos y comprobante accesible', async () => {
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'active', current_period_end: '2026-11-05T12:00:00Z' }, {
      payments: [{ id: 'p1', provider: 'mercadopago', amount: 50000, currency: 'ARS', status: 'approved', paid_at: '2026-10-05T12:00:00Z' }],
      invoices: [{ id: 'i1', provider: 'mercadopago', amount: 50000, currency: 'ARS', status: 'paid', issued_at: '2026-10-05T12:00:00Z', invoice_url: 'https://comprobantes.localhost/i1' }],
    })))
    render(<Billing barberiaId={1} />)
    await screen.findByRole('heading', { name: 'Tu plan está activo' })
    const payments = screen.getByRole('region', { name: 'Pagos' })
    expect(within(payments).getByText('Aprobado')).toBeInTheDocument()
    expect(within(payments).getByText(/Mercado Pago ·/)).toBeInTheDocument()
    expect(within(payments).queryByText(/mercadopago/)).not.toBeInTheDocument()
    const invoices = screen.getByRole('region', { name: 'Comprobantes' })
    const link = within(invoices).getByRole('link', { name: /Abrir comprobante de .*50\.000/ })
    expect(link).toHaveAttribute('href', 'https://comprobantes.localhost/i1')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(screen.getByText(/^Hasta /)).toBeInTheDocument()
  })

  it('fechas inválidas del backend no rompen la pantalla', async () => {
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'active', current_period_end: 'no-es-fecha' }, {
      payments: [{ id: 'p1', provider: 'otro', amount: 1, currency: 'ARS', status: 'rarísimo', paid_at: 'tampoco' }],
    })))
    render(<Billing barberiaId={1} />)
    await screen.findByRole('heading', { name: 'Tu plan está activo' })
    expect(screen.getByText('Hasta —')).toBeInTheDocument()
    expect(screen.getByText('otro · —')).toBeInTheDocument()
  })

  it('sin suscripción es un estado comercial, no un error técnico', async () => {
    fetchMock.mockResolvedValueOnce(fail(409, 'subscription_missing', 'La cuenta todavía no tiene una suscripción.'))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'Tu suscripción todavía no está creada' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Pendiente de iniciar')).toBeInTheDocument()
    expect(screen.queryByText(/La cuenta todavía no tiene una suscripción\./)).not.toBeInTheDocument()
  })
})

describe('Billing · errores y permisos', () => {
  it('sin permiso de dueño no muestra plan, precios ni historial', async () => {
    fetchMock.mockResolvedValueOnce(fail(403, 'owner_required', 'El usuario no es owner de ningún tenant.'))
    render(<Billing barberiaId={1} />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByRole('heading', { name: 'No tenés permiso para ver la facturación' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
    expect(screen.queryByText(/50\.000/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Pagos' })).not.toBeInTheDocument()
    // El mensaje técnico del backend no se expone.
    expect(screen.queryByText(/owner|tenant/i)).not.toBeInTheDocument()
  })

  it('sesión vencida lleva a iniciar sesión sin llamar al backend', async () => {
    mocks.session = null
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'Tu sesión expiró' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Iniciar sesión/ })).toHaveAttribute('href', '/ingresar')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('usuario con varios negocios recibe una explicación propia', async () => {
    fetchMock.mockResolvedValueOnce(fail(409, 'tenant_selection_required'))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'Tu usuario administra más de un negocio' })).toBeInTheDocument()
  })

  it('backend caído en la primera carga: no afirma historial vacío y permite reintentar con foco en el resultado', async () => {
    const user = userEvent.setup()
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'No pudimos conectarnos' })).toBeInTheDocument()
    expect(screen.queryByText('Todavía no hay pagos registrados.')).not.toBeInTheDocument()
    expect(screen.getByText(/Precio de referencia/)).toBeInTheDocument()

    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'active' })))
    await user.click(screen.getByRole('button', { name: 'Reintentar' }))
    const heading = await screen.findByRole('heading', { name: 'Tu plan está activo' })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByText('Facturación actualizada.')).toBeInTheDocument()
  })

  it('error 502 técnico en la primera carga ofrece reintentar', async () => {
    fetchMock.mockResolvedValueOnce(fail(502, 'billing_status_failed'))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'No pudimos consultar la facturación' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })

  it('si falla una actualización conserva el plan y el historial anteriores', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'active' }, {
      payments: [{ id: 'p1', provider: 'mercadopago', amount: 50000, currency: 'ARS', status: 'approved', paid_at: '2026-10-05T12:00:00Z' }],
    })))
    render(<Billing barberiaId={1} />)
    await screen.findByRole('heading', { name: 'Tu plan está activo' })

    fetchMock.mockResolvedValueOnce(fail(502, 'billing_status_failed'))
    // Teclado: el botón Actualizar es alcanzable y se activa con Enter.
    const refresh = screen.getByRole('button', { name: 'Actualizar' })
    refresh.focus()
    await user.keyboard('{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveAttribute('data-billing-stale', 'true')
    expect(within(alert).getByText(/Mostramos los datos consultados a las/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tu plan está activo' })).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Pagos' })).getByText('Aprobado')).toBeInTheDocument()

    // Recuperación: el reintento limpia el aviso y muestra los datos nuevos.
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'past_due' })))
    await user.click(within(alert).getByRole('button', { name: 'Reintentar' }))
    expect(await screen.findByRole('heading', { name: 'Hay un pago pendiente' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('mientras actualiza no dispara consultas duplicadas', async () => {
    const user = userEvent.setup()
    fetchMock.mockResolvedValueOnce(ok(portalWith()))
    render(<Billing barberiaId={1} />)
    await screen.findByRole('heading', { name: 'Tu plan está activo' })
    const pending = deferred()
    fetchMock.mockReturnValueOnce(pending.promise)
    const refresh = screen.getByRole('button', { name: 'Actualizar' })
    await user.click(refresh)
    const busy = await screen.findByRole('button', { name: 'Actualizando…' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    await user.click(busy)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    pending.resolve(ok(portalWith()))
    expect(await screen.findByRole('button', { name: 'Actualizar' })).toBeInTheDocument()
  })

  it('la caída del catálogo RPC no tapa el estado confirmado', async () => {
    mocks.rpc = vi.fn(() => Promise.resolve({ data: null, error: { code: '500', message: 'rpc caído' } }))
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'active' })))
    render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'Tu plan está activo' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Billing · retorno del proveedor y demo', () => {
  it('cancelar en el proveedor informa sin cambiar el estado que confirma el backend', async () => {
    window.history.replaceState(null, '', '/facturacion?billing=cancel')
    fetchMock.mockResolvedValueOnce(ok(portalWith({ estado: 'trialing', trial_ends_at: inDays(4) })))
    const { container } = render(<Billing barberiaId={1} />)
    expect(await screen.findByRole('heading', { name: 'Prueba gratuita · 4 días restantes' })).toBeInTheDocument()
    const notice = container.querySelector('[data-billing-return="cancel"]')
    expect(notice).toHaveAttribute('role', 'status')
    expect(notice).toHaveTextContent(/cancelado/)
  })

  it('demo: informativa, sin consultas ni botón de actualizar', () => {
    const { container } = render(<Billing demoMode />)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /actualizar/i })).not.toBeInTheDocument()
    expect(container.querySelector('.billing-notice')).toHaveTextContent(/15 días de prueba.*continuidad se coordina manualmente por WhatsApp/)
    expect(container.querySelectorAll('.billing-plan')).toHaveLength(1)
    expect(container.querySelector('.billing-plan h3')).toHaveTextContent('Austral')
    expect(screen.getByRole('heading', { name: 'Estás en la prueba gratuita' })).toBeInTheDocument()
    expect(screen.queryByText(/\b(?:Starter|Pro|Premium)\b/i)).not.toBeInTheDocument()
  })
})

it('el título del estado recibe foco programático sin sumarse al orden de tabulación', async () => {
  fetchMock.mockResolvedValueOnce(ok(portalWith()))
  render(<Billing barberiaId={1} />)
  const heading = await screen.findByRole('heading', { name: 'Tu plan está activo' })
  expect(heading).toHaveAttribute('tabindex', '-1')
})
