import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, Clock3, CreditCard, ExternalLink, Info, LogIn, MessageCircle, Receipt, RefreshCw, ShieldCheck, Sparkles, WifiOff, X } from 'lucide-react'
import { supabase, supabaseUrl, isSupabaseConfigured } from '../lib/supabaseClient'
import { classifyBillingFailure } from '../lib/runtimeStability.js'
import { getBillingReturnState } from '../lib/billingReturnState.js'
import { billingStatusTone, classifyBillingLoadFailure, failureAllowsRetry, formatBillingDate, formatBillingTime, LOAD_FAILURE_COPY, paymentStatusTone } from '../lib/billingView.js'
import { COMMERCIAL_BILLING_MODE, COMMERCIAL_CATALOG, COMMERCIAL_TRIAL_DAYS, catalogPlan, getTrialContinuationWhatsAppHref } from '../lib/commercialCatalog.js'
import { trialHasExpired, trialRemainingDays } from '../lib/trial.js'
import { EmptyState, Skeleton } from '../components/ui'
import { formatPrecio } from '../lib/text'
import './Billing.css'

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

// Títulos y explicaciones del resumen. Describen el estado que informa el
// servidor; no anticipan cambios ni prometen acceso.
const STATUS_COPY = {
  trialing: ['Estás en la prueba gratuita', 'No se cobra nada durante la prueba.'],
  active: ['Tu plan está activo', 'Tu suscripción está al día.'],
  past_due: ['Hay un pago pendiente', 'Escribinos si necesitás ayuda para regularizarlo.'],
  grace_period: ['Hay un pago pendiente', 'La cuenta está en período de gracia mientras se regulariza el pago.'],
  payment_review: ['Estamos revisando un pago', 'El estado cambia cuando el proveedor confirma el pago.'],
  incomplete: ['La suscripción no terminó de activarse', 'Escribinos si necesitás ayuda para completarla.'],
  suspended: ['La cuenta está suspendida', 'Escribinos al equipo de Austral para reactivarla.'],
  canceled: ['La suscripción fue cancelada', 'Escribinos si querés volver a usar Austral.'],
  refunded: ['El pago fue reembolsado', 'Escribinos si tenés dudas sobre el reembolso.'],
  paused: ['La suscripción está pausada', 'Escribinos si querés reanudarla.'],
  expired: ['La suscripción venció', 'Escribinos al equipo de Austral para continuar.'],
}

const TONE_ICONS = { info: Sparkles, success: CheckCircle2, warning: Clock3, danger: AlertTriangle, neutral: Info }
const FAILURE_ICONS = { session: LogIn, forbidden: CircleSlash, tenant_selection: Info, network: WifiOff, technical: AlertTriangle }

const PROVIDER_LABELS = { mercadopago: 'Mercado Pago', paypal: 'PayPal' }

const DEMO_PORTAL = {
  tenant: { pais: 'AR', billing_email: '' },
  access_state: 'trialing',
  subscription: { estado: 'trialing', plan_codigo: 'starter', precio: 50000, moneda: 'ARS', periodicidad: 'monthly', trial_ends_at: null, current_period_end: null, plan: { nombre: 'Austral', precio_mensual: 50000, moneda: 'ARS' } },
  providers: [{ codigo: 'mercadopago', nombre: 'Mercado Pago', activo: false, unavailable: true, entorno: 'demo' }],
  payments: [],
  invoices: [],
  production_checkout_ready: false,
}

const DEMO_CATALOG = COMMERCIAL_CATALOG.map((plan) => ({ ...plan, limites: { funciones: plan.funcionalidades.join(' · ') }, precios_externos: [] }))

function statusLabel(value) {
  return STATUS_LABELS[value] || value || 'Sin estado'
}

// Estados que devuelven Mercado Pago/PayPal para pagos y comprobantes.
const PROVIDER_STATUS_LABELS = {
  approved: 'Aprobado', authorized: 'Autorizado', paid: 'Pagado', completed: 'Completado', accredited: 'Acreditado',
  pending: 'Pendiente', in_process: 'En proceso', in_mediation: 'En mediación', open: 'Abierto', draft: 'Borrador',
  rejected: 'Rechazado', cancelled: 'Cancelado', canceled: 'Cancelado', refunded: 'Reintegrado', charged_back: 'Contracargo',
  void: 'Anulado', failed: 'Fallido', expired: 'Vencido',
}

function providerStatusLabel(value) {
  const key = String(value || '').toLowerCase()
  return PROVIDER_STATUS_LABELS[key] || (key ? key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ') : 'Sin estado')
}

function providerLabel(value) {
  return PROVIDER_LABELS[value] || value || 'Proveedor'
}

function formatMoney(value, currency) {
  if (value == null) return '—'
  try {
    return formatPrecio(value, currency || 'ARS')
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

function planFeatures(item) {
  if (Array.isArray(item?.funcionalidades) && item.funcionalidades.length) return item.funcionalidades
  return Object.values(item?.limites || {}).map(String)
}

function daysLabel(days) {
  return `${days} ${days === 1 ? 'día restante' : 'días restantes'}`
}

function BillingHeader({ onRefresh, refreshing, showSecurity }) {
  return (
    <div className="page-header billing-header">
      <div>
        <p className="page-kicker">Tu plan</p>
        <h1 className="page-title">Facturación</h1>
        <p className="page-date">Tu plan, la prueba gratuita y tus pagos.</p>
      </div>
      <div className="billing-header-actions">
        {showSecurity && <span className="billing-security"><ShieldCheck size={15} aria-hidden="true" /> Procesamiento seguro</span>}
        {onRefresh && (
          <button type="button" className="btn billing-refresh" onClick={onRefresh} aria-disabled={refreshing || undefined} aria-busy={refreshing || undefined}>
            <RefreshCw size={15} aria-hidden="true" className={refreshing ? 'billing-spin' : ''} />
            {refreshing ? 'Actualizando…' : 'Actualizar'}
          </button>
        )}
      </div>
    </div>
  )
}

function BillingAlert({ tone = 'info', icon: Icon = Info, role = 'status', title, children, actions, ...props }) {
  return (
    <div className={`billing-alert billing-notice billing-alert--${tone}`} role={role} {...props}>
      <Icon size={17} aria-hidden="true" className="billing-alert-icon" />
      <div className="billing-alert-body">
        {title && <strong>{title}</strong>}
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="billing-alert-actions">{actions}</div>}
    </div>
  )
}

function FailureAction({ kind, onRetry, refreshing }) {
  if (kind === 'session') return <a className="btn btn-primary" href="/ingresar"><LogIn size={15} aria-hidden="true" /> Iniciar sesión</a>
  if (!failureAllowsRetry(kind)) return null
  return (
    <button type="button" className="btn btn-primary" onClick={onRetry} aria-disabled={refreshing || undefined} aria-busy={refreshing || undefined}>
      <RefreshCw size={15} aria-hidden="true" className={refreshing ? 'billing-spin' : ''} />
      {refreshing ? 'Reintentando…' : 'Reintentar'}
    </button>
  )
}

function BillingLoadingState() {
  return (
    <div className="billing-page billing-loading-state" role="status" aria-busy="true" aria-label="Cargando facturación">
      <span className="sr-only">Cargando facturación…</span>
      <header className="billing-loading-header">
        <div className="settings-loading-stack">
          <Skeleton width="96px" height={10} />
          <Skeleton width="190px" height={30} />
          <Skeleton width="min(420px, 82vw)" height={12} />
        </div>
        <Skeleton width="110px" height={36} />
      </header>

      <section className="panel billing-overview billing-loading-card">
        <div className="billing-loading-card-heading">
          <div className="settings-loading-stack"><Skeleton width="120px" height={10} /><Skeleton width="min(320px, 70vw)" height={24} /><Skeleton width="min(380px, 76vw)" height={12} /></div>
          <Skeleton width="96px" height={24} />
        </div>
        <div className="billing-loading-facts"><Skeleton width="100%" height={52} /><Skeleton width="100%" height={52} /><Skeleton width="100%" height={52} /><Skeleton width="100%" height={52} /></div>
      </section>

      <div className="billing-main-grid">
        <section className="panel billing-loading-card"><Skeleton width="140px" height={18} /><Skeleton width="180px" height={30} /><Skeleton width="100%" height={12} /><Skeleton width="80%" height={12} /><Skeleton width="70%" height={12} /></section>
        <section className="panel billing-loading-card"><Skeleton width="120px" height={10} /><Skeleton width="200px" height={22} /><Skeleton width="100%" height={12} /><Skeleton width="150px" height={36} /></section>
      </div>

      <div className="billing-history-grid">
        <section className="panel billing-loading-card"><Skeleton width="72px" height={18} /><div className="billing-loading-history"><Skeleton width="100%" height={44} /><Skeleton width="100%" height={44} /></div></section>
        <section className="panel billing-loading-card"><Skeleton width="112px" height={18} /><div className="billing-loading-history"><Skeleton width="100%" height={44} /><Skeleton width="100%" height={44} /></div></section>
      </div>
    </div>
  )
}

async function billingApi(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw Object.assign(new Error('Tu sesión expiró. Volvé a iniciar sesión.'), { status: 401, code: 'session_expired' })
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

export default function Billing({ barberiaId: _barberiaId, demoMode = false }) {
  const [portal, setPortal] = useState(() => (demoMode ? DEMO_PORTAL : null))
  const [catalog, setCatalog] = useState(() => (demoMode ? DEMO_CATALOG : []))
  const [provider, setProvider] = useState('mercadopago')
  const [loading, setLoading] = useState(isSupabaseConfigured && !demoMode)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Fallo al consultar (con o sin datos previos) y error de una acción del
  // usuario son independientes: uno no debe tapar ni borrar al otro.
  const [loadFailure, setLoadFailure] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [liveMessage, setLiveMessage] = useState('')
  const [lastLoadedAt, setLastLoadedAt] = useState(null)
  const [subscriptionMissing, setSubscriptionMissing] = useState(false)
  const [cardPlanCode, setCardPlanCode] = useState(null)
  const productionAttemptKey = useRef(null)
  const requestSeq = useRef(0)
  const hasLoaded = useRef(false)
  const focusOverviewAfterLoad = useRef(false)
  const announceAfterLoad = useRef(false)
  const overviewHeadingRef = useRef(null)
  const planActionRefs = useRef({})
  const [returnState] = useState(() => getBillingReturnState())

  const load = useCallback(async () => {
    if (demoMode) { setPortal(DEMO_PORTAL); setCatalog(DEMO_CATALOG); setLoading(false); return }
    if (!isSupabaseConfigured) { setLoading(false); return }
    const seq = ++requestSeq.current
    setRefreshing(true)
    setLiveMessage('')
    const [portalResult, catalogResult] = await Promise.allSettled([
      billingApi('status'),
      supabase.rpc('get_billing_catalog'),
    ])
    // Una respuesta atrasada no pisa a una consulta más nueva.
    if (seq !== requestSeq.current) return
    const portalFailed = portalResult.status === 'rejected'
    const catalogFailed = catalogResult.status === 'rejected' || Boolean(catalogResult.value?.error)
    const portalError = portalFailed ? portalResult.reason : null
    const catalogError = catalogFailed ? (catalogResult.reason || catalogResult.value?.error) : null
    const portalFailure = portalError ? classifyBillingFailure(portalError) : null
    const catalogFailure = catalogError ? classifyBillingFailure(catalogError) : null
    const commercialMissing = portalFailure?.kind === 'subscription_missing' || catalogFailure?.kind === 'subscription_missing'
    // El catálogo comercial canónico se mantiene en el frontend mientras el
    // proveedor de pagos está pausado. No mostrar precios stale del RPC.
    setCatalog(COMMERCIAL_CATALOG.map((plan) => ({ ...plan, limites: { funciones: plan.funcionalidades.join(' · ') }, precios_externos: [] })))
    if (commercialMissing) {
      // La ausencia de suscripción es un estado comercial válido. No debe
      // presentarse como un fallo técnico ni exponer el mensaje del RPC.
      hasLoaded.current = true
      setSubscriptionMissing(true)
      setLoadFailure(null)
      setPortal(portalFailed ? null : portalResult.value)
      setLastLoadedAt(new Date())
    } else if (portalFailed) {
      // Conservar lo último que confirmó el servidor: un fallo transitorio no
      // debe vaciar el plan ni el historial que ya estaban en pantalla.
      setLoadFailure({ kind: classifyBillingLoadFailure(portalError), stale: hasLoaded.current })
    } else {
      // El catálogo del RPC no se muestra; su caída no bloquea el estado.
      hasLoaded.current = true
      setSubscriptionMissing(false)
      setLoadFailure(null)
      setPortal(portalResult.value)
      setLastLoadedAt(new Date())
      if (announceAfterLoad.current) setLiveMessage('Facturación actualizada.')
    }
    setLoading(false)
    setRefreshing(false)
  }, [demoMode])

  useEffect(() => {
    load()
    return () => { requestSeq.current += 1 }
  }, [load])

  const refresh = useCallback((fromRecovery = false) => {
    if (refreshing) return
    focusOverviewAfterLoad.current = fromRecovery
    announceAfterLoad.current = true
    load()
  }, [load, refreshing])

  useEffect(() => {
    if (refreshing || loadFailure || !focusOverviewAfterLoad.current) return
    focusOverviewAfterLoad.current = false
    overviewHeadingRef.current?.focus()
  }, [refreshing, loadFailure])

  const subscription = portal?.subscription
  const plan = subscription?.plan_codigo ? { ...(subscription.plan || {}), ...catalogPlan(subscription.plan_codigo) } : subscription?.plan
  const providers = useMemo(() => portal?.providers || [], [portal])
  const displayProviders = providers.length ? providers : (subscriptionMissing ? [{ codigo: provider, nombre: PROVIDER_LABELS[provider] || provider, activo: false, unavailable: true }] : [])
  const selectedProvider = displayProviders.find((item) => item.codigo === provider)
  const productionCheckoutReady = selectedProvider?.codigo === 'mercadopago' && selectedProvider?.entorno === 'production' && portal?.production_checkout_ready === true
  const sandboxPublicKey = import.meta.env.VITE_MERCADOPAGO_SANDBOX_PUBLIC_KEY || ''
  const sandboxCheckoutReady = selectedProvider?.codigo === 'mercadopago'
    && selectedProvider?.entorno === 'sandbox'
    && portal?.sandbox_checkout_ready === true
    && Boolean(sandboxPublicKey)
  // A current-plan sandbox rerun is a QA-only server decision. The browser
  // only renders the control when the backend has already resolved the
  // tenant binding, project ref and explicit QA flag; it never sends a
  // bypass, tenant id or environment back to billing-api.
  const samePlanSandboxE2EReady = sandboxCheckoutReady && portal?.sandbox_e2e_same_plan_ready === true
  const currentAmount = plan?.precio_mensual ?? subscription?.precio
  const manualBilling = COMMERCIAL_BILLING_MODE === 'manual'
  const trialEndsAt = subscription?.trial_ends_at
  const trialExpiredByDate = trialHasExpired(trialEndsAt)
  const trialExpired = !subscriptionMissing
    && trialExpiredByDate
    && (subscription?.estado === 'trialing'
      || subscription?.estado === 'expired'
      || (subscription?.estado === 'past_due' && subscription?.status_reason === 'trial_expired'))
  const trialActive = !subscriptionMissing && Boolean(trialEndsAt) && subscription?.estado === 'trialing' && !trialExpiredByDate
  const trialDaysRemaining = trialActive ? trialRemainingDays(trialEndsAt) : 0
  const trialContinuationHref = getTrialContinuationWhatsAppHref()
  const currentIsTrial = !subscriptionMissing && Boolean(trialEndsAt) && subscription?.estado === 'trialing' && !trialExpiredByDate
  const currentPrice = currentIsTrial ? 'Sin cargo durante la prueba' : formatMoney(currentAmount, plan?.moneda || 'ARS')
  const periodLabel = subscription?.periodicidad === 'yearly' ? 'año' : 'mes'
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
    if (manualBilling) {
      setNotice('Para continuar, coordinamos el pago por WhatsApp. No se realizó ningún cobro.')
      return
    }
    if (demoMode) {
      window.location.assign('/registro?source=demo-billing')
      return
    }
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
        setNotice('Listo. Vamos a abrir Mercado Pago en una pestaña nueva para completar el pago.')
        window.open(data.checkout_url, '_blank', 'noopener,noreferrer')
      } else setNotice(data?.message || 'El pago quedó preparado, pero el modo de prueba no está configurado.')
    } catch (apiError) {
      const failure = classifyBillingFailure(apiError)
      setError(failure.kind === 'subscription_missing'
        ? 'Tu cuenta todavía no tiene un plan habilitado para pagar.'
        : 'No pudimos iniciar el pago. No se realizó ningún cobro.')
    }
    setSaving(false)
  }

  const submitSubscription = async (planCode, cardTokenId, environment) => {
    if (manualBilling) return
    const ready = environment === 'sandbox' ? sandboxCheckoutReady : productionCheckoutReady
    if (!cardTokenId || !ready) return
    productionAttemptKey.current ||= `ui-${crypto.randomUUID()}`
    setSaving(true)
    setError('')
    setNotice('Verificando la suscripción con Mercado Pago…')
    try {
      const data = await billingApi('subscription', { method: 'POST', headers: { 'Idempotency-Key': productionAttemptKey.current }, body: { plan_codigo: planCode, card_token_id: cardTokenId } })
      setNotice(environment === 'sandbox'
        ? 'Tarjeta de prueba recibida. La suscripción se activa cuando Mercado Pago confirme el pago.'
        : (data?.status === 'verifying' ? 'Tarjeta recibida. Tu plan se activa en cuanto Mercado Pago confirme el pago.' : 'Solicitud recibida. Tu plan se activa en cuanto Mercado Pago confirme el pago.'))
    } catch (apiError) {
      const failure = classifyBillingFailure(apiError)
      setError(failure.kind === 'subscription_missing' ? 'La cuenta todavía no tiene una suscripción habilitada.' : 'No se pudo procesar la tarjeta. No se activó ningún plan.')
      setNotice('')
    } finally {
      setSaving(false)
    }
  }

  const cancelCardForm = (planCode) => {
    setCardPlanCode(null)
    // Devolver el foco al botón que abrió el formulario.
    window.requestAnimationFrame(() => planActionRefs.current[planCode]?.focus())
  }

  const canRefresh = isSupabaseConfigured && !demoMode
  const header = <BillingHeader onRefresh={canRefresh ? () => refresh(false) : null} refreshing={refreshing} showSecurity={!manualBilling} />

  if (!isSupabaseConfigured && !demoMode) {
    return (
      <div className="fade-in billing-page">
        {header}
        <section className="panel billing-empty" aria-labelledby="billing-unavailable-title">
          <EmptyState
            icon={<span className="billing-empty-icon"><CreditCard size={20} aria-hidden="true" /></span>}
            title={<span id="billing-unavailable-title">Facturación no disponible</span>}
            description="La facturación no está disponible en este momento. Probá de nuevo en unos minutos."
          />
        </section>
      </div>
    )
  }
  if (loading) return <BillingLoadingState />

  const liveRegion = <p className="sr-only" role="status" aria-live="polite">{liveMessage}</p>

  // Sin datos confirmados no hay nada que mostrar como propio de la cuenta:
  // sólo el motivo, cómo recuperarse y el plan de referencia público.
  if (loadFailure && !loadFailure.stale) {
    const copy = LOAD_FAILURE_COPY[loadFailure.kind] || LOAD_FAILURE_COPY.technical
    const FailureIcon = FAILURE_ICONS[loadFailure.kind] || AlertTriangle
    const showReference = failureAllowsRetry(loadFailure.kind)
    return (
      <div className="fade-in billing-page" aria-busy={refreshing || undefined}>
        {header}
        {liveRegion}
        <section className="panel billing-overview billing-tone--danger billing-failure" role="alert" aria-labelledby="billing-failure-title" data-billing-failure={loadFailure.kind}>
          <div className="billing-overview-head">
            <span className="billing-overview-icon"><FailureIcon size={20} aria-hidden="true" /></span>
            <div className="billing-overview-titles">
              <p className="panel-kicker">Estado de tu cuenta</p>
              <h2 id="billing-failure-title">{copy.title}</h2>
              <p className="billing-overview-description">{copy.description}</p>
            </div>
          </div>
          <div className="billing-overview-actions"><FailureAction kind={loadFailure.kind} onRetry={() => refresh(true)} refreshing={refreshing} /></div>
        </section>
        {showReference && (
          <section className="panel billing-plans-panel" aria-labelledby="billing-plan-title">
            <div className="panel-header"><div><h2 className="panel-title" id="billing-plan-title">Plan Austral</h2><p className="panel-subtitle">Precio de referencia. El estado de tu cuenta aparece cuando el servicio responda.</p></div></div>
            <div className="billing-plans-grid">{catalog.map((item) => (
              <article className="billing-plan" key={item.codigo}>
                <p className="billing-plan-price">{formatMoney(item.precio_mensual, item.moneda)} <small>/ {item.periodicidad === 'yearly' ? 'año' : 'mes'}</small></p>
                <p className="billing-plan-description">{item.descripcion}</p>
                <ul className="billing-feature-list">{planFeatures(item).map((feature) => <li key={feature}><CheckCircle2 size={15} aria-hidden="true" /> {feature}</li>)}</ul>
              </article>
            ))}</div>
          </section>
        )}
      </div>
    )
  }

  let overview
  if (subscriptionMissing) {
    overview = { tone: 'warning', pill: 'Pendiente de iniciar', title: 'Tu suscripción todavía no está creada', description: 'Todavía no tenés una suscripción activa. La prueba gratuita y el plan aparecen cuando el onboarding termina de crear la suscripción.' }
  } else if (trialExpired) {
    overview = { tone: 'danger', pill: 'Prueba finalizada', title: 'Tu período de prueba terminó.', description: 'Tus datos quedan guardados. Para seguir usando Austral, coordinamos la continuidad con el equipo.' }
  } else if (trialActive) {
    overview = { tone: 'info', pill: statusLabel('trialing'), title: `Prueba gratuita · ${daysLabel(trialDaysRemaining)}`, description: `Vence el ${formatBillingDate(trialEndsAt)}. No se cobra nada durante la prueba.` }
  } else {
    const estado = subscription?.estado
    const [title, description] = STATUS_COPY[estado] || ['Estado de la suscripción', 'No pudimos interpretar el estado informado. Escribinos si necesitás ayuda.']
    overview = { tone: billingStatusTone(estado), pill: statusLabel(estado), title, description }
  }
  const OverviewIcon = TONE_ICONS[overview.tone] || Info
  const staleCopy = loadFailure ? (LOAD_FAILURE_COPY[loadFailure.kind] || LOAD_FAILURE_COPY.technical) : null
  const staleTime = lastLoadedAt ? formatBillingTime(lastLoadedAt) : ''
  const payments = portal?.payments || []
  const invoices = portal?.invoices || []

  return (
    <div className="fade-in billing-page" aria-busy={refreshing || undefined}>
      {header}
      {liveRegion}

      <div className="billing-alerts">
        {loadFailure && (
          <BillingAlert
            tone="warning"
            role="alert"
            icon={FAILURE_ICONS[loadFailure.kind] || AlertTriangle}
            title={staleCopy.title}
            data-billing-stale="true"
            actions={<FailureAction kind={loadFailure.kind} onRetry={() => refresh(true)} refreshing={refreshing} />}
          >
            {staleCopy.description} {staleTime ? `Mostramos los datos consultados a las ${staleTime}.` : 'Mostramos los últimos datos consultados.'}
          </BillingAlert>
        )}
        {error && (
          <BillingAlert
            tone="danger"
            role="alert"
            icon={AlertTriangle}
            actions={<button type="button" className="btn-icon-plain billing-alert-dismiss" onClick={() => setError('')} aria-label="Cerrar aviso"><X size={16} aria-hidden="true" /></button>}
          >{error}</BillingAlert>
        )}
        {returnState && <div className={`billing-alert billing-notice billing-alert--${returnState.kind === 'success' ? 'info' : 'warning'}`} role="status" data-billing-return={returnState.kind}><ShieldCheck size={17} aria-hidden="true" className="billing-alert-icon" /><div className="billing-alert-body"><p>{returnState.message}</p></div></div>}
        {demoMode && <BillingAlert tone="info" icon={Info}>La facturación de la demo es informativa: Austral incluye {COMMERCIAL_TRIAL_DAYS} días de prueba y cuesta {formatPrecio(catalogPlan('austral')?.precio_mensual ?? 50000)} por mes. La continuidad se coordina manualmente por WhatsApp.</BillingAlert>}
        {notice && <BillingAlert tone="success" icon={CheckCircle2}>{notice}</BillingAlert>}
      </div>

      <section className={`panel billing-overview billing-tone--${overview.tone}`} aria-labelledby="billing-overview-title" data-billing-tone={overview.tone}>
        <div className="billing-overview-head">
          <span className="billing-overview-icon"><OverviewIcon size={20} aria-hidden="true" /></span>
          <div className="billing-overview-titles">
            <p className="panel-kicker">Estado de tu cuenta</p>
            <h2 id="billing-overview-title" ref={overviewHeadingRef} tabIndex={-1}>{overview.title}</h2>
            <p className="billing-overview-description">{overview.description}</p>
          </div>
          <span className={`billing-pill billing-pill--${overview.tone}`}>{overview.pill}</span>
        </div>
        <dl className="billing-facts">
          <div><dt>Plan</dt><dd>{subscriptionMissing ? '—' : plan?.nombre || subscription?.plan_codigo || 'Sin plan'}</dd></div>
          <div><dt>Precio</dt><dd>{subscriptionMissing ? '—' : currentIsTrial ? currentPrice : `${currentPrice} / ${periodLabel}`}</dd></div>
          <div><dt>Acceso</dt><dd>{subscriptionMissing ? 'Pendiente de activar' : statusLabel(portal?.access_state)}</dd></div>
          <div><dt>Prueba gratuita</dt><dd>{trialActive ? `Vence ${formatBillingDate(trialEndsAt)}` : trialEndsAt ? `Terminó ${formatBillingDate(trialEndsAt)}` : '—'}</dd></div>
          {subscription?.current_period_end && <div><dt>Período actual</dt><dd>Hasta {formatBillingDate(subscription.current_period_end)}</dd></div>}
        </dl>
        {trialExpired && (trialContinuationHref
          ? <div className="billing-overview-actions"><a className="btn btn-primary billing-continuation-cta" href={trialContinuationHref} target="_blank" rel="noreferrer"><MessageCircle size={15} aria-hidden="true" /> Quiero seguir usando Austral<span className="sr-only"> (abre WhatsApp en otra pestaña)</span></a></div>
          : <p className="billing-helper">Tu prueba terminó. Escribinos al equipo de Austral para continuar: tus datos quedan guardados.</p>)}
      </section>

      <div className="billing-main-grid">
        <section className="panel billing-plans-panel" aria-labelledby="billing-plan-title">
          <div className="panel-header billing-plan-header">
            <div><h2 className="panel-title" id="billing-plan-title">Plan Austral</h2><p className="panel-subtitle">La propuesta comercial vigente para tu cuenta.</p></div>
            {catalog.length === 1 && catalog[0].codigo === subscription?.plan_codigo && <span className="billing-pill billing-pill--accent">Tu plan</span>}
          </div>
          <div className="billing-plans-grid">{catalog.map((item) => {
            const externalPrice = findExternalPrice(item)
            const providerUnavailable = !selectedProvider?.activo && !sandboxCheckoutReady && !productionCheckoutReady
            const isCurrentPlan = item.codigo === subscription?.plan_codigo
            const itemSandboxCheckoutReady = sandboxCheckoutReady && (!isCurrentPlan || samePlanSandboxE2EReady)
            const itemCheckoutReady = productionCheckoutReady || itemSandboxCheckoutReady
            const basePrice = formatMoney(item.precio_mensual, item.moneda)
            const displayPrice = !manualBilling && externalPrice ? formatMoney(externalPrice.importe, externalPrice.moneda) : basePrice
            const itemPeriod = item.periodicidad === 'yearly' ? 'año' : 'mes'
            const priceMeta = manualBilling
              ? `/ ${itemPeriod}`
              : externalPrice
                ? `/ ${externalPrice.periodicidad === 'yearly' ? 'año' : 'mes'} · ${externalPrice.pais_codigo}`
                : `/ ${itemPeriod} · referencia base ${item.moneda || 'ARS'}`
            return <article className={`billing-plan ${isCurrentPlan ? 'current' : ''}`} key={item.codigo}>
              {catalog.length > 1
                ? <div className="billing-plan-heading"><h3>{item.nombre}</h3>{isCurrentPlan && <span className="billing-pill billing-pill--accent">Tu plan</span>}</div>
                : <h3 className="sr-only">{item.nombre}</h3>}
              <p className={`billing-plan-price ${!manualBilling && !externalPrice ? 'billing-plan-price--reference' : ''}`}>{displayPrice} <small>{priceMeta}</small></p>
              <p className="billing-plan-description">{item.descripcion}</p>
              {!manualBilling && !externalPrice && <p className="billing-plan-unavailable">Referencia informativa: no hay un precio externo habilitado para {PROVIDER_LABELS[provider] || provider}.</p>}
              <ul className="billing-feature-list">{planFeatures(item).map((feature) => <li key={feature}><CheckCircle2 size={15} aria-hidden="true" /> {feature}</li>)}</ul>
              {!manualBilling && <button ref={(node) => { planActionRefs.current[item.codigo] = node }} type="button" className="btn btn-primary billing-plan-action" disabled={saving || (isCurrentPlan && !demoMode && !samePlanSandboxE2EReady) || (!demoMode && (!externalPrice || providerUnavailable))} onClick={() => { if (demoMode) startCheckout(item.codigo); else if (itemCheckoutReady) { productionAttemptKey.current = null; setCardPlanCode(item.codigo) } else startCheckout(item.codigo) }}>{demoMode ? 'Probar gratis 15 días' : isCurrentPlan && !samePlanSandboxE2EReady ? 'Plan actual' : providerUnavailable ? 'No disponible todavía' : !externalPrice ? 'Precio no disponible' : saving ? 'Preparando…' : itemSandboxCheckoutReady ? 'Continuar con tarjeta TEST' : productionCheckoutReady ? 'Continuar con tarjeta' : `Elegir con ${PROVIDER_LABELS[provider] || provider}`}</button>}
              {!manualBilling && itemCheckoutReady && cardPlanCode === item.codigo && <Suspense fallback={<div className="billing-card-disabled" role="status">Preparando formulario seguro…</div>}><MercadoPagoCardTokenForm publicKey={sandboxCheckoutReady ? sandboxPublicKey : import.meta.env.VITE_MERCADOPAGO_PUBLIC_KEY} amount={externalPrice.importe} currency={externalPrice.moneda} email={portal?.tenant?.billing_email || ''} environment={sandboxCheckoutReady ? 'sandbox' : 'production'} disabled={saving} onCancel={() => cancelCardForm(item.codigo)} onToken={(token) => submitSubscription(item.codigo, token, sandboxCheckoutReady ? 'sandbox' : 'production')} /></Suspense>}
            </article>
          })}</div>
        </section>

        {manualBilling ? <section className="panel billing-provider-card billing-manual-card" aria-labelledby="billing-payment-title">
          <p className="panel-kicker">Cómo se paga</p>
          <h2 id="billing-payment-title">Continuá por WhatsApp</h2>
          <p className="panel-subtitle">Durante esta etapa no se ofrecen Mercado Pago, PayPal, tarjetas ni suscripciones automáticas. Conservamos tus datos y coordinamos la continuidad con el equipo.</p>
          <ol className="billing-steps">
            <li>Escribinos cuando quieras continuar.</li>
            <li>Coordinamos el pago con el equipo de Austral.</li>
            <li>Tu plan se actualiza cuando lo confirmamos.</li>
          </ol>
          <span className="billing-pill billing-pill--neutral">Sin cobros automáticos</span>
          {trialContinuationHref && !trialExpired && <a className="btn btn-primary billing-continuation-cta" href={trialContinuationHref} target="_blank" rel="noreferrer"><MessageCircle size={15} aria-hidden="true" /> Hablar con el equipo<span className="sr-only"> (abre WhatsApp en otra pestaña)</span></a>}
        </section> : <section className="panel billing-provider-card" aria-labelledby="billing-payment-title">
          <p className="panel-kicker">Medio de pago</p>
          <h2 id="billing-payment-title">Elegí cómo pagar</h2>
          <p className="panel-subtitle">El pago se procesa de forma segura a través de Mercado Pago.</p>
          {displayProviders.length > 0 && <fieldset className="billing-provider-options">
            <legend className="sr-only">Medio de pago</legend>
            {displayProviders.map((item) => <label className={`billing-provider-option ${provider === item.codigo ? 'selected' : ''}`} key={item.codigo}><input type="radio" name="billing-provider" value={item.codigo} checked={provider === item.codigo} onChange={(event) => setProvider(event.target.value)} /><span><strong>{PROVIDER_LABELS[item.codigo] || item.nombre}</strong><small>{item.activo ? 'Configurado' : 'Pagos todavía no habilitados'}</small></span></label>)}
          </fieldset>}
          {selectedProvider && !selectedProvider.activo && !sandboxCheckoutReady && <div className="billing-provider-empty" role="status"><div className="billing-provider-empty-icon"><CreditCard size={17} aria-hidden="true" /></div><div><strong>{PROVIDER_LABELS[selectedProvider.codigo] || selectedProvider.nombre} todavía no está disponible</strong><p>Podés ver los planes; los pagos online se habilitan en breve.</p><span className="billing-pill billing-pill--neutral">Sin cobros habilitados</span></div></div>}
          {sandboxCheckoutReady && <BillingAlert tone="warning" icon={ShieldCheck}>Modo de prueba: usá sólo tarjetas de prueba; no se realizan cobros reales.</BillingAlert>}
          {!selectedProvider && <div className="billing-provider-empty" role="status"><div className="billing-provider-empty-icon"><ShieldCheck size={17} aria-hidden="true" /></div><div><strong>Pagos online próximamente</strong><p>Cuando se habilite un medio de pago, aparecerá acá sin modificar tu plan actual.</p><span className="billing-pill billing-pill--neutral">Configuración pendiente</span></div></div>}
        </section>}
      </div>

      <div className="billing-history-grid">
        <section className="panel billing-history-panel" aria-labelledby="billing-payments-title">
          <div className="panel-header"><div><h2 className="panel-title" id="billing-payments-title">Pagos</h2><p className="panel-subtitle">{manualBilling ? 'Pagos registrados para tu cuenta.' : 'Pagos confirmados por Mercado Pago.'}</p></div></div>
          {payments.length ? <ul className="billing-history-list">{payments.map((payment) => (
            <li className="billing-history-row" key={payment.id}>
              <div className="billing-history-main"><strong>{formatMoney(payment.amount, payment.currency)}</strong><span>{providerLabel(payment.provider)} · {formatBillingDate(payment.paid_at)}</span></div>
              <span className={`billing-pill billing-pill--${paymentStatusTone(payment.status)}`}>{providerStatusLabel(payment.status)}</span>
            </li>
          ))}</ul> : <EmptyState className="billing-history-empty" icon={<CreditCard size={18} aria-hidden="true" />} description="Todavía no hay pagos registrados." />}
        </section>
        <section className="panel billing-history-panel" aria-labelledby="billing-invoices-title">
          <div className="panel-header"><div><h2 className="panel-title" id="billing-invoices-title">Comprobantes</h2><p className="panel-subtitle">{manualBilling ? 'Comprobantes emitidos para tu cuenta. Nunca guardamos datos de tarjetas.' : 'Los comprobantes los emite Mercado Pago; nunca guardamos datos de tarjetas.'}</p></div></div>
          {invoices.length ? <ul className="billing-history-list">{invoices.map((invoice) => {
            const amount = formatMoney(invoice.amount, invoice.currency)
            const issued = formatBillingDate(invoice.issued_at)
            return (
              <li className="billing-history-row" key={invoice.id}>
                <div className="billing-history-main"><strong>{amount}</strong><span>{providerLabel(invoice.provider)} · {issued}</span></div>
                <span className={`billing-pill billing-pill--${paymentStatusTone(invoice.status)}`}>{providerStatusLabel(invoice.status)}</span>
                {invoice.invoice_url && <a className="btn-icon-plain billing-history-link" href={invoice.invoice_url} target="_blank" rel="noreferrer" aria-label={`Abrir comprobante de ${amount} del ${issued} (otra pestaña)`}><ExternalLink size={16} aria-hidden="true" /></a>}
              </li>
            )
          })}</ul> : <EmptyState className="billing-history-empty" icon={<Receipt size={18} aria-hidden="true" />} description="Todavía no hay comprobantes." />}
        </section>
      </div>
    </div>
  )
}
