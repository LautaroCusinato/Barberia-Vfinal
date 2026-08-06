import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, CreditCard, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

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

function idempotencyKey() {
  if (globalThis.crypto?.randomUUID) return `checkout-${globalThis.crypto.randomUUID()}`
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function Billing({ barberiaId }) {
  const [portal, setPortal] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [provider, setProvider] = useState('mercadopago')
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) { setLoading(false); return }
    setLoading(true)
    setError('')
    const [{ data: portalData, error: portalError }, { data: catalogData, error: catalogError }] = await Promise.all([
      supabase.rpc('get_billing_portal', { p_barberia_id: barberiaId }),
      supabase.rpc('get_billing_catalog'),
    ])
    if (portalError || catalogError) setError(portalError?.message || catalogError?.message || 'No se pudo cargar facturación')
    setPortal(portalData || null)
    setCatalog(Array.isArray(catalogData) ? catalogData : [])
    setLoading(false)
  }, [barberiaId])

  useEffect(() => { load() }, [load])

  const subscription = portal?.subscription
  const plan = subscription?.plan
  const providers = useMemo(() => portal?.providers || [], [portal])
  const selectedProvider = providers.find((item) => item.codigo === provider)

  const startCheckout = async (planCode) => {
    if (!isSupabaseConfigured) return
    setSaving(true)
    setError('')
    setNotice('')
    const { data, error: rpcError } = await supabase.rpc('create_billing_checkout_intent', {
      p_barberia_id: barberiaId,
      p_plan_codigo: planCode,
      p_proveedor_codigo: provider,
      p_idempotency_key: idempotencyKey(),
    })
    if (rpcError) setError(rpcError.message)
    else if (data?.checkout_url) {
      setNotice('Checkout creado. Se abrirá el proveedor en una pestaña nueva.')
      window.open(data.checkout_url, '_blank', 'noopener,noreferrer')
    } else {
      setNotice(data?.message || 'El checkout quedó preparado; falta configurar el backend sandbox.')
    }
    setSaving(false)
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
      {notice && <div className="billing-notice" role="status"><CheckCircle2 size={16} /> {notice}</div>}

      <section className="billing-summary-grid">
        <div className="panel billing-current-card">
          <div className="billing-card-heading"><div><p className="panel-kicker">Plan actual</p><h2>{plan?.nombre || subscription?.plan_codigo || 'Sin plan'}</h2></div><span className={`status-pill billing-status-${subscription?.estado || 'unknown'}`}>{statusLabel(subscription?.estado)}</span></div>
          <p className="billing-price">{formatMoney(subscription?.precio ?? plan?.precio_mensual, subscription?.moneda || plan?.moneda)} <small>/ {subscription?.periodicidad === 'yearly' ? 'año' : 'mes'}</small></p>
          <dl className="billing-facts">
            <div><dt>Acceso</dt><dd>{statusLabel(portal?.access_state)}</dd></div>
            <div><dt>Trial vence</dt><dd>{formatDate(subscription?.trial_ends_at)}</dd></div>
            <div><dt>Período actual</dt><dd>{formatDate(subscription?.current_period_end)}</dd></div>
          </dl>
        </div>
        <div className="panel billing-provider-card">
          <p className="panel-kicker">Proveedor para el checkout</p>
          <h2>Elegí cómo pagar</h2>
          <p className="panel-subtitle">Esta etapa sólo prepara intents sandbox. No se realizan cobros desde el navegador.</p>
          <div className="billing-provider-options">
            {providers.map((item) => <label className={`billing-provider-option ${provider === item.codigo ? 'selected' : ''}`} key={item.codigo}><input type="radio" name="billing-provider" value={item.codigo} checked={provider === item.codigo} onChange={(event) => setProvider(event.target.value)} /><span><strong>{PROVIDER_LABELS[item.codigo] || item.nombre}</strong><small>{item.activo ? 'Sandbox configurado' : 'Pendiente de configuración'}</small></span></label>)}
          </div>
          {selectedProvider && !selectedProvider.activo && <p className="billing-helper">El administrador deberá agregar las credenciales sandbox en el backend antes de generar la URL.</p>}
        </div>
      </section>

      <section className="panel billing-plans-panel">
        <div className="panel-header"><div><h2 className="panel-title">Cambiar de plan</h2><p className="panel-subtitle">El precio se toma de Supabase; no se acepta desde el cliente.</p></div></div>
        <div className="billing-plans-grid">{catalog.map((item) => <article className={`billing-plan ${item.codigo === subscription?.plan_codigo ? 'current' : ''}`} key={item.codigo}><div className="billing-plan-heading"><h3>{item.nombre}</h3>{item.codigo === subscription?.plan_codigo && <span className="status-pill">Actual</span>}</div><p className="billing-plan-description">{item.descripcion}</p><p className="billing-plan-price">{formatMoney(item.precio_mensual, item.moneda)} <small>/ mes</small></p><ul>{Object.entries(item.limites || {}).slice(0, 4).map(([key, value]) => <li key={key}><CheckCircle2 size={14} /> {key}: {value}</li>)}</ul><button className="btn btn-primary billing-plan-action" disabled={saving || item.codigo === subscription?.plan_codigo} onClick={() => startCheckout(item.codigo)}>{item.codigo === subscription?.plan_codigo ? 'Plan actual' : saving ? 'Preparando…' : `Elegir con ${PROVIDER_LABELS[provider] || provider}`}</button></article>)}</div>
      </section>

      <section className="billing-history-grid">
        <div className="panel"><div className="panel-header"><div><h2 className="panel-title">Pagos</h2><p className="panel-subtitle">Confirmados por el proveedor mediante webhook verificado.</p></div></div>{portal?.payments?.length ? <div className="billing-history-list">{portal.payments.map((payment) => <div className="billing-history-row" key={payment.id}><span>{PROVIDER_LABELS[payment.provider] || payment.provider}</span><strong>{formatMoney(payment.amount, payment.currency)}</strong><span className="status-pill">{payment.status}</span><small>{formatDate(payment.paid_at)}</small></div>)}</div> : <div className="empty-state">Todavía no hay pagos registrados.</div>}</div>
        <div className="panel"><div className="panel-header"><div><h2 className="panel-title">Comprobantes</h2><p className="panel-subtitle">Los enlaces provienen del proveedor; nunca guardamos tarjetas.</p></div></div>{portal?.invoices?.length ? <div className="billing-history-list">{portal.invoices.map((invoice) => <div className="billing-history-row" key={invoice.id}><span>{invoice.provider}</span><strong>{formatMoney(invoice.amount, invoice.currency)}</strong><span className="status-pill">{invoice.status}</span>{invoice.invoice_url ? <a href={invoice.invoice_url} target="_blank" rel="noreferrer" aria-label="Abrir comprobante"><ExternalLink size={15} /></a> : <small>{formatDate(invoice.issued_at)}</small>}</div>)}</div> : <div className="empty-state">Todavía no hay comprobantes.</div>}</div>
      </section>
    </div>
  )
}
