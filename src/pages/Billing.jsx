import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, CreditCard, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react'
import { supabase, supabaseUrl, isSupabaseConfigured } from '../lib/supabaseClient'
import { classifyBillingFailure } from '../lib/runtimeStability.js'
import { getBillingReturnState } from '../lib/billingReturnState.js'

const MercadoPagoCardTokenForm = lazy(() => import('../components/billing/MercadoPagoCardTokenForm.jsx'))

const STATUS_LABELS = {
  trialing: 'Prueba gratuita',
  active: 'Activa',
  past_due: 'Pago pendiente',
  grace_period: 'Período de gracia',
  suspended: 'Suspendida',
  canceled: 'Cancelada',
  incomplete: 'Pendiente de activar',
  payment_review: 'Pago en revisión',
  refunded: 'Reembolsada',
  paused: 'Pausada',
  expired: 'Vencida',
}

const PROVIDER_LABELS = { mercadopago: 'Mercado Pago', paypal: 'PayPal' }

function statusLabel(value) {
  return STATUS_LABELS[value] || value || 'Sin estado'
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(value))
}

function formatMoney(value, currency) {
  if (value == null) return '—'
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency || 'USD' }).format(Number(value))
  } catch {
    return `${value} ${currency || ''}`.trim()
  }
}

function normalizeCountryCode(value) {
  const raw = String(value || '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(raw)) return raw
  const aliases = { ARGENTINA: 'AR', BRASIL: 'BR', BRAZIL: 'BR', CHILE: 'CL', MEXICO: 'MX', 'MÉXICO': 'MX', URUGUAY: 'UY' }
  return aliases[raw] || 'GLOBAL'
}

async function billingApi(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Tu sesión expiró. Volvé a iniciar sesión.')
  const response = await fetch(`${supabaseUrl}/functions/v1/billing-api/${path}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Error temporal de facturación.')
    error.status = response.status
    error.code = payload?.error?.code || null
    throw error
  }
  return payload
}

export default function Billing({ barberiaId: _barberiaId }) {
  const [portal, setPortal] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [provider, setProvider] = useState('mercadopago')
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [subscriptionMissing, setSubscriptionMissing] = useState(false)
  const [cardPlanCode, setCardPlanCode] = useState(null)
  const productionAttemptKey = useRef(null)
  const [returnState] = useState(() => getBillingReturnState())

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    setError('')
    setSubscriptionMissing(false)
    const [portalResult, catalogResult] = await Promise.allSettled([
      billingApi('status'),
      supabase.rpc('get_billing_catalog'),
    ])
    const portalFailed = portalResult.status === 'rejected'
    const catalogFailed = catalogResult.status === 'rejected' || Boolean(catalogResult.value?.error)
    const portalError = portalFailed ? portalResult.reason : null
    const catalogError = catalogFailed ? (catalogResult.reason || catalogResult.value?.error) : null
    const portalFailure = portalError ? classifyBillingFailure(portalError) : null
    const catalogFailure = catalogError ? classifyBillingFailure(catalogError) : null
    const commercialMissing = portalFailure?.kind === 'subscription_missing' || catalogFailure?.kind === 'subscription_missing'
    // La ausencia de suscripción es un estado comercial válido. No debe
    // presentarse como un fallo técnico ni exponer el mensaje del RPC.
    if (commercialMissing) {
      setSubscriptionMissing(true)
      setError('')
    } else if (portalFailed || catalogFailed) {
      setError('No se pudo consultar facturación en este momento. Intentá nuevamente en unos segundos.')
    }
    setPortal(portalResult.status === 'fulfilled' ? portalResult.value : null)
    setCatalog(catalogResult.status === 'fulfilled' && Array.isArray(catalogResult.value.data) ? catalogResult.value.data : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const subscription = portal?.subscription
  const plan = subscription?.plan
  const providers = useMemo(() => portal?.providers || [], [portal])
  const displayProviders = providers.length ? providers : (subscriptionMissing ? [{ codigo: provider, nombre: PROVIDER_LABELS[provider] || provider, activo: false, unavailable: true }] : [])
  const selectedProvider = displayProviders.find((item) => item.codigo === provider)
  const productionCheckoutReady = selectedProvider?.codigo === 'mercadopago' && selectedProvider?.entorno === 'production' && portal?.production_checkout_ready === true
  const tenantCountry = normalizeCountryCode(portal?.tenant?.pais)
  const findExternalPrice = (item) => {
    const prices = (item?.precios_externos || []).filter((price) => price.proveedor_codigo === provider && price.activo !== false && price.habilitado !== false && (!selectedProvider?.entorno || price.entorno === selectedProvider.entorno))
    return prices.sort((left, right) => {
      const leftExact = left.pais_codigo === tenantCountry ? 0 : 1
      const rightExact = right.pais_codigo === tenantCountry ? 0 : 1
      return leftExact - rightExact
    })[0] || null
  }

  const startCheckout = async (planCode) => {
    if (!isSupabaseConfigured) return
    if (!selectedProvider?.activo) {
      setError('El proveedor seleccionado todavía no está habilitado para este entorno.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const data = await billingApi('checkout', { method: 'POST', body: { plan_codigo: planCode, proveedor_codigo: provider } })
      if (data?.checkout_url) {
        setNotice('Checkout creado. Se abrirá el proveedor en una pestaña nueva.')
        window.open(data.checkout_url, '_blank', 'noopener,noreferrer')
      } else setNotice(data?.message || 'El checkout quedó preparado; falta configuración sandbox.')
    } catch (apiError) {
      const failure = classifyBillingFailure(apiError)
      setError(failure.kind === 'subscription_missing'
        ? 'La cuenta todavía no tiene una suscripción habilitada para iniciar el checkout.'
        : 'No se pudo iniciar el checkout. No se generó ningún cobro.')
    }
    setSaving(false)
  }

  const submitProductionSubscription = async (planCode, cardTokenId) => {
    if (!cardTokenId || !portal?.production_checkout_ready) return
    productionAttemptKey.current ||= `ui-${crypto.randomUUID()}`
    setSaving(true)
    setError('')
    setNotice('Verificando la suscripción con Mercado Pago…')
    try {
      const data = await billingApi('subscription', { method: 'POST', headers: { 'Idempotency-Key': productionAttemptKey.current }, body: { plan_codigo: planCode, card_token_id: cardTokenId } })
      setNotice(data?.status === 'verifying' ? 'Tarjeta recibida. La activación queda pendiente de verificación del webhook.' : 'Solicitud recibida. La activación se confirmará por webhook.')
    } catch (apiError) {
      const failure = classifyBillingFailure(apiError)
      setError(failure.kind === 'subscription_missing' ? 'La cuenta todavía no tiene una suscripción habilitada.' : 'No se pudo procesar la tarjeta. No se activó ningún plan.')
      setNotice('')
    } finally {
      setSaving(false)
    }
  }

  if (!isSupabaseConfigured) return <div className="panel billing-empty"><CreditCard size={18} /><p>Conectá Supabase para consultar el estado de facturación.</p></div>
  if (loading) return <div className="panel billing-empty"><LoaderCircle className="spin" size={18} /> Cargando facturación…</div>

  return (
    <div className="fade-in billing-page">
      <div className="page-header">
        <div>
          <p className="page-kicker">Cuenta SaaS</p>
          <h1 className="page-title">Facturación</h1>
          <p className="page-date">Tu plan, prueba gratuita y pagos, sin exponer credenciales.</p>
        </div>
        <div className="billing-security"><ShieldCheck size={15} /> Procesamiento seguro</div>
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}
      {returnState && <div className="billing-notice" role="status" data-billing-return={returnState.kind}><ShieldCheck size={16} /> {returnState.message}</div>}
      {subscriptionMissing && <div className="billing-notice" role="status"><ShieldCheck size={16} /> Todavía no tenés una suscripción activa. El trial y el plan aparecen cuando el onboarding termina de crear la suscripción.</div>}
      {notice && <div className="billing-notice" role="status"><CheckCircle2 size={16} /> {notice}</div>}

      <section className="billing-summary-grid">
        <div className="panel billing-current-card">
          <div className="billing-card-heading"><div><p className="panel-kicker">Plan actual</p><h2>{subscriptionMissing ? 'Sin suscripción activa' : plan?.nombre || subscription?.plan_codigo || 'Sin plan'}</h2></div><span className={`status-pill billing-status-${subscription?.estado || 'unknown'}`}>{subscriptionMissing ? 'Pendiente de iniciar' : statusLabel(subscription?.estado)}</span></div>
          <p className="billing-price">{subscriptionMissing ? '—' : formatMoney(subscription?.precio ?? plan?.precio_mensual, subscription?.moneda || plan?.moneda)} {!subscriptionMissing && <small>/ {subscription?.periodicidad === 'yearly' ? 'año' : 'mes'}</small>}</p>
          <dl className="billing-facts">
            <div><dt>Acceso</dt><dd>{subscriptionMissing ? 'Pendiente de activar' : statusLabel(portal?.access_state)}</dd></div>
            <div><dt>Trial vence</dt><dd>{formatDate(subscription?.trial_ends_at)}</dd></div>
            <div><dt>Período actual</dt><dd>{formatDate(subscription?.current_period_end)}</dd></div>
          </dl>
        </div>
        <div className="panel billing-provider-card">
          <p className="panel-kicker">Proveedor para el checkout</p>
          <h2>Elegí cómo pagar</h2>
          <p className="panel-subtitle">El checkout se solicita al backend sandbox desplegado. El navegador nunca maneja credenciales.</p>
          <div className="billing-provider-options">
            {displayProviders.map((item) => <label className={`billing-provider-option ${provider === item.codigo ? 'selected' : ''}`} key={item.codigo}><input type="radio" name="billing-provider" value={item.codigo} checked={provider === item.codigo} onChange={(event) => setProvider(event.target.value)} /><span><strong>{PROVIDER_LABELS[item.codigo] || item.nombre}</strong><small>{item.activo ? 'Configurado' : 'Pagos todavía no habilitados para esta cuenta'}</small></span></label>)}
          </div>
          {selectedProvider && !selectedProvider.activo && <p className="billing-helper">Los pagos todavía no están habilitados para esta cuenta. No se generará ningún cobro.</p>}
        </div>
      </section>

      <section className="panel billing-plans-panel">
        <div className="panel-header"><div><h2 className="panel-title">Cambiar de plan</h2><p className="panel-subtitle">El precio se toma de Supabase; no se acepta desde el cliente.</p><p className="billing-currency-note">Cuando el proveedor no tiene un precio configurado, mostramos sólo la referencia base del catálogo y el checkout permanece bloqueado.</p></div></div>
        <div className="billing-plans-grid">{catalog.map((item) => {
          const externalPrice = findExternalPrice(item)
          const providerUnavailable = !selectedProvider?.activo
          const basePrice = formatMoney(item.precio_mensual, item.moneda)
          const displayPrice = externalPrice ? formatMoney(externalPrice.importe, externalPrice.moneda) : basePrice
          const priceMeta = externalPrice
            ? `/ ${externalPrice.periodicidad === 'yearly' ? 'año' : 'mes'} · ${externalPrice.pais_codigo}`
            : `/ ${item.periodicidad === 'yearly' ? 'año' : 'mes'} · referencia base ${item.moneda || 'USD'}`
          return <article className={`billing-plan ${item.codigo === subscription?.plan_codigo ? 'current' : ''}`} key={item.codigo}>
            <div className="billing-plan-heading"><h3>{item.nombre}</h3>{item.codigo === subscription?.plan_codigo && <span className="status-pill">Actual</span>}</div>
            <p className="billing-plan-description">{item.descripcion}</p>
            <p className="billing-plan-price">{displayPrice} <small>{priceMeta}</small></p>
            <ul>{Object.entries(item.limites || {}).slice(0, 4).map(([key, value]) => <li key={key}><CheckCircle2 size={14} /> {key}: {value}</li>)}</ul>
            <button className="btn btn-primary billing-plan-action" disabled={saving || item.codigo === subscription?.plan_codigo || !externalPrice || providerUnavailable} onClick={() => { if (productionCheckoutReady) { productionAttemptKey.current = null; setCardPlanCode(item.codigo) } else startCheckout(item.codigo) }}>{item.codigo === subscription?.plan_codigo ? 'Plan actual' : providerUnavailable ? 'Proveedor no habilitado' : !externalPrice ? 'Precio no disponible' : saving ? 'Preparando…' : productionCheckoutReady ? 'Continuar con tarjeta' : `Elegir con ${PROVIDER_LABELS[provider] || provider}`}</button>
            {productionCheckoutReady && cardPlanCode === item.codigo && <Suspense fallback={<div className="billing-card-disabled" role="status">Preparando formulario seguro…</div>}><MercadoPagoCardTokenForm publicKey={import.meta.env.VITE_MERCADOPAGO_PUBLIC_KEY} amount={externalPrice.importe} currency={externalPrice.moneda} email={portal?.tenant?.billing_email || ''} disabled={saving} onCancel={() => setCardPlanCode(null)} onToken={(token) => submitProductionSubscription(item.codigo, token)} /></Suspense>}
          </article>
        })}</div>
      </section>

      <section className="billing-history-grid">
        <div className="panel"><div className="panel-header"><div><h2 className="panel-title">Pagos</h2><p className="panel-subtitle">Confirmados por el proveedor mediante webhook verificado.</p></div></div>{portal?.payments?.length ? <div className="billing-history-list">{portal.payments.map((payment) => <div className="billing-history-row" key={payment.id}><span>{PROVIDER_LABELS[payment.provider] || payment.provider}</span><strong>{formatMoney(payment.amount, payment.currency)}</strong><span className="status-pill">{payment.status}</span><small>{formatDate(payment.paid_at)}</small></div>)}</div> : <div className="empty-state">Todavía no hay pagos registrados.</div>}</div>
        <div className="panel"><div className="panel-header"><div><h2 className="panel-title">Comprobantes</h2><p className="panel-subtitle">Los enlaces provienen del proveedor; nunca guardamos tarjetas.</p></div></div>{portal?.invoices?.length ? <div className="billing-history-list">{portal.invoices.map((invoice) => <div className="billing-history-row" key={invoice.id}><span>{invoice.provider}</span><strong>{formatMoney(invoice.amount, invoice.currency)}</strong><span className="status-pill">{invoice.status}</span>{invoice.invoice_url ? <a href={invoice.invoice_url} target="_blank" rel="noreferrer" aria-label="Abrir comprobante"><ExternalLink size={15} /></a> : <small>{formatDate(invoice.issued_at)}</small>}</div>)}</div> : <div className="empty-state">Todavía no hay comprobantes.</div>}</div>
      </section>
    </div>
  )
}
