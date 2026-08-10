import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bell, BriefcaseBusiness, Bot, CheckSquare, CreditCard, LogOut, Plus, RefreshCw, Search, UsersRound, X } from 'lucide-react'
import { logout } from '../components/Login.jsx'
import { supabase, supabaseUrl } from '../lib/supabaseClient'
import CommercialAgent from './CommercialAgent.jsx'
import CRMLeadsWorkspace from '../components/CRMLeadsWorkspace.jsx'
import CRMActionInbox from '../components/CRMActionInbox.jsx'
import CommercialPilot from './CommercialPilot.jsx'

const STAGES = ['discovered', 'qualified', 'contacted', 'replied', 'interested', 'demo', 'trial', 'negotiating', 'won', 'lost', 'do_not_contact']

// This console is deliberately fixed to the isolated technical tenant. Do
// not turn these values into user-controlled inputs: the Edge Function also
// validates the sandbox metadata and platform role on every request.
const SANDBOX_BILLING = Object.freeze({
  tenantId: 6,
  planCode: 'starter',
  provider: 'mercadopago',
  environment: 'sandbox',
  preapprovalId: 'f031bb4cdde44e78badbd6da4b5caa67',
})
const SANDBOX_PRICE_LABEL = 'ARS 15.000 / mes'

const SANDBOX_BILLING_MESSAGES = {
  auth_required: 'La sesión expiró. Volvé a iniciar sesión.',
  invalid_session: 'La sesión no es válida. Volvé a iniciar sesión.',
  platform_admin_required: 'Sólo owner/admin de plataforma puede usar este control.',
  provider_not_configured: 'Faltan variables privadas de Mercado Pago sandbox.',
  sandbox_seller_mismatch: 'La credencial no pertenece al vendedor TEST autorizado.',
  production_provider_disabled: 'Mercado Pago de producción permanece bloqueado.',
  sandbox_scope_required: 'La operación sólo está permitida para el tenant sandbox técnico.',
  plan_mapping_missing: 'Falta el mapeo del plan starter en Supabase.',
  external_price_not_configured: 'No hay un precio externo configurado para ese proveedor y país.',
  external_price_persist_failed: 'No se pudo guardar el precio externo sincronizado.',
  plan_not_found: 'El plan starter no existe o está inactivo.',
  checkout_intent_failed: 'No se pudo preparar el intento de checkout sandbox.',
  checkout_persist_failed: 'El checkout se creó pero no se pudo registrar en Supabase.',
  approval_url_missing: 'Mercado Pago no devolvió una URL de checkout.',
  external_status_failed: 'No se pudo consultar el estado externo del checkout.',
  sandbox_preapproval_inconsistent: 'La suscripción externa no coincide con el contrato sandbox autorizado.',
  sandbox_plan_inconsistent: 'El plan externo no coincide con el vendedor, aplicación o precio sandbox autorizado.',
  sandbox_subscription_conflict: 'La suscripción externa ya está vinculada a otro registro.',
  sandbox_price_inconsistent: 'El precio sandbox actual no coincide con el plan autorizado.',
  sandbox_tenant_inconsistent: 'El tenant técnico sandbox no cumple el contrato de billing.',
  sandbox_audit_failed: 'La reconciliación terminó sin auditoría completa.',
  network_error: 'No se pudo conectar con billing sandbox. Reintentá en unos segundos.',
}

function sanitizeSandboxError(error, fallback = 'No se pudo completar la operación sandbox.') {
  const code = String(error?.code || '').trim()
  return SANDBOX_BILLING_MESSAGES[code] || fallback
}

async function sandboxBillingApi(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw Object.assign(new Error(SANDBOX_BILLING_MESSAGES.auth_required), { code: 'auth_required' })
  let response
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/billing-api/${path}`, {
      method: options.method || 'GET',
      headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw Object.assign(new Error(SANDBOX_BILLING_MESSAGES.network_error), { code: 'network_error' })
  }
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const code = payload?.error?.code || `http_${response.status}`
    throw Object.assign(new Error(SANDBOX_BILLING_MESSAGES[code] || 'Error temporal de billing sandbox.'), { code })
  }
  return payload
}

async function auditSandboxAction(action, status, metadata = {}) {
  const safeMetadata = {
    tenant_id: SANDBOX_BILLING.tenantId,
    plan_codigo: SANDBOX_BILLING.planCode,
    proveedor_codigo: SANDBOX_BILLING.provider,
    environment: SANDBOX_BILLING.environment,
    status,
    ...metadata,
  }
  const { error } = await supabase.rpc('record_billing_sandbox_audit', {
    p_action: action,
    p_status: status,
    p_metadata: safeMetadata,
  })
  if (error) throw new Error('No se pudo registrar la auditoría de la operación sandbox.')
}

const emptyBusiness = {
  nombre: '',
  rubro: 'custom',
  pais: '',
  idioma: 'es',
  canal_origen: '',
  etapa: 'prospecto',
  interes: '',
  precio_ofrecido: '',
  moneda: 'USD',
  email: '',
  telefono: '',
  sitio_web: '',
  notas: '',
}

function stageLabel(value) {
  return value ? value.replaceAll('_', ' ') : 'sin etapa'
}

function formatDate(value) {
  if (!value) return 'Sin proxima accion'
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(value))
}

function formatMoney(value, currency) {
  if (value == null) return 'Sin precio'
  try { return new Intl.NumberFormat('es-AR', { style: 'currency', currency: currency || 'USD' }).format(Number(value)) } catch { return `${value} ${currency || ''}`.trim() }
}

function SandboxBillingConsole({ role, snapshot, busy, error, notice, auditWarning, confirmAction, onAction }) {
  if (!['owner', 'admin'].includes(role)) return null
  const config = snapshot?.configStatus
  const provider = snapshot?.provider
  const price = snapshot?.price
  const checkout = snapshot?.checkout
  const external = snapshot?.externalStatus
  const tenantReady = snapshot?.tenant?.metadata?.environment === SANDBOX_BILLING.environment
    && snapshot?.tenant?.metadata?.technical === true

  return (
    <section className="panel sandbox-billing-console" aria-labelledby="sandbox-billing-title">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Herramienta técnica</p>
          <h2 className="panel-title" id="sandbox-billing-title">Mercado Pago · Sandbox</h2>
          <p className="panel-subtitle">Operación fija para tenant técnico #{SANDBOX_BILLING.tenantId}, plan {SANDBOX_BILLING.planCode}. No modifica negocios reales ni habilita producción.</p>
        </div>
        <span className="status-pill">Sólo owner/admin</span>
      </div>

      {(error || auditWarning) && <div className="error-banner" role="alert">{error || auditWarning}</div>}
      {notice && <div className="billing-notice" role="status">{notice}</div>}

      {confirmAction && <div className="sandbox-confirmation" role="alert">
        <strong>{confirmAction === 'sync-plans' ? 'Confirmar sincronización' : confirmAction === 'reconcile-sandbox' ? 'Confirmar reconciliación' : 'Confirmar checkout sandbox'}</strong>
        <span>{confirmAction === 'sync-plans'
          ? 'Se actualizará únicamente el plan starter de Mercado Pago sandbox.'
          : confirmAction === 'reconcile-sandbox'
            ? `Se consultará la suscripción existente ${SANDBOX_BILLING.preapprovalId} y se vinculará únicamente al tenant técnico #6. No se crea ningún pago.`
            : 'Se generará un checkout para el tenant técnico #6. No se cobrará dinero real.'}</span>
        <div className="sandbox-confirmation-actions">
          <button type="button" className="btn btn-primary" onClick={() => onAction(confirmAction)} disabled={busy}>Confirmar</button>
          <button type="button" className="btn" onClick={() => onAction('cancel-confirmation')} disabled={busy}>Cancelar</button>
        </div>
      </div>}

      <div className="sandbox-billing-actions">
        <button type="button" className="btn" onClick={() => onAction('config-status')} disabled={busy || Boolean(confirmAction)}>Consultar config-status</button>
        <button type="button" className="btn btn-primary" onClick={() => onAction('sync-plans')} disabled={busy || Boolean(confirmAction)}>Sincronizar starter</button>
        <button type="button" className="btn btn-primary" onClick={() => onAction('checkout')} disabled={busy || Boolean(confirmAction)}>Generar checkout sandbox</button>
        <button type="button" className="btn" onClick={() => onAction('reconcile-sandbox')} disabled={busy || Boolean(confirmAction)}>Reconciliar suscripción existente</button>
        <button type="button" className="btn" onClick={() => onAction('external-status')} disabled={busy || Boolean(confirmAction) || !checkout?.external_checkout_id}>Consultar estado externo</button>
      </div>

      <div className="sandbox-billing-grid">
        <div><span className="stat-label">Tenant técnico</span><strong>{tenantReady ? 'id=6 · válido' : snapshot?.tenant === null ? 'id=6 · backend valida' : 'No validado'}</strong></div>
        <div><span className="stat-label">Proveedor</span><strong>{provider ? `${provider.codigo} · ${provider.entorno}` : 'Sin consultar'}</strong><small>{provider?.activo ? 'Activo global' : 'Global deshabilitado (correcto)'}</small></div>
        <div><span className="stat-label">Precio externo</span><strong>{price ? `${price.moneda} ${formatMoney(price.importe, price.moneda)} / ${price.periodicidad === 'yearly' ? 'año' : 'mes'}` : SANDBOX_PRICE_LABEL}</strong><small>{price?.habilitado && price.external_plan_id ? `Habilitado · ${price.external_plan_id}` : 'Pendiente de sincronizar'}</small></div>
        <div><span className="stat-label">Producción</span><strong>{config?.production_enabled === false ? 'Bloqueada' : 'No validada'}</strong><small>{config?.sandbox_token_valid ? 'Vendedor TEST validado (token oculto)' : 'Token no validado'}</small></div>
      </div>

      <div className="sandbox-billing-details">
        <div><span>Secretos configurados</span><strong>{config ? (config.token_configured && config.webhook_secret_configured ? 'Sí' : 'Incompletos') : 'Sin consultar'}</strong></div>
        <div><span>Último checkout</span><strong>{checkout?.id ? `#${checkout.id} · ${checkout.estado}` : 'Todavía no existe'}</strong></div>
        <div><span>Preapproval a reconciliar</span><strong>{SANDBOX_BILLING.preapprovalId}</strong></div>
        <div><span>Estado externo</span><strong>{external?.status || 'Sin consultar'}</strong></div>
        <div><span>Suscripción</span><strong>No se activa por URL de retorno</strong></div>
      </div>

      {config?.external_plan_check?.reachable && <div className="sandbox-billing-details">
        <div><span>Plan externo verificado</span><strong>{config.external_plan_check.matches_internal_price ? 'Coincide con ARS 15.000' : 'Difiere del precio interno'}</strong></div>
        <div><span>Vendedor externo</span><strong>User ID {config.external_plan_check.collector_id || 'no informado'}</strong></div>
        <div><span>Vendedor del token actual</span><strong>{config.external_plan_check.current_token_user_id || 'no informado'}{config.external_plan_check.seller_matches_current_token ? ' · coincide' : ' · revisar'}</strong></div>
        <div><span>Aplicación externa</span><strong>{config.external_plan_check.application_id || 'no informada'}</strong></div>
      </div>}
      {!config?.external_plan_check?.reachable && config?.external_plan_check?.current_token_user_id && <div className="sandbox-billing-details">
        <div><span>Usuario de la credencial</span><strong>{config.external_plan_check.current_token_user_id}</strong></div>
        <div><span>Vendedor sandbox esperado</span><strong>{config.external_plan_check.expected_sandbox_seller_id || '3595396521'}</strong></div>
        <div><span>Validación</span><strong>{config.external_plan_check.error_code === 'sandbox_seller_mismatch' ? 'No coincide · operación detenida' : 'Pendiente'}</strong></div>
      </div>}

      {checkout?.checkout_url && !['expired', 'obsolete', 'failed'].includes(checkout.estado) && <div className="sandbox-checkout-url"><span>checkout_url</span><a href={checkout.checkout_url} target="_blank" rel="noreferrer">{checkout.checkout_url}</a></div>}
      {config?.missing_for_checkout?.length > 0 && <p className="panel-subtitle">Faltan para checkout: {config.missing_for_checkout.join(', ')}</p>}
      {busy && <p className="panel-subtitle">Procesando operación sandbox…</p>}
    </section>
  )
}

export default function PlatformCRM({ role = 'owner' }) {
  const [businesses, setBusinesses] = useState([])
  const [leads, setLeads] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyBusiness)
  const [view, setView] = useState('businesses')
  const [billingOverview, setBillingOverview] = useState(null)
  const [sandboxSnapshot, setSandboxSnapshot] = useState({ tenant: null, provider: null, plan: null, price: null, checkout: null, configStatus: null, externalStatus: null })
  const [sandboxBusy, setSandboxBusy] = useState(false)
  const [sandboxError, setSandboxError] = useState('')
  const [sandboxNotice, setSandboxNotice] = useState('')
  const [sandboxAuditWarning, setSandboxAuditWarning] = useState('')
  const [sandboxConfirmAction, setSandboxConfirmAction] = useState('')
  const canWrite = ['owner', 'admin', 'sales', 'automation'].includes(role)

  const loadSandboxSnapshot = useCallback(async () => {
    if (!['owner', 'admin'].includes(role)) return
    const [tenantResult, providerResult, planResult, priceResult, checkoutResult] = await Promise.all([
      supabase.from('barberias').select('id, metadata').eq('id', SANDBOX_BILLING.tenantId).maybeSingle(),
      supabase.from('saas_proveedores_pago').select('codigo, activo, entorno').eq('codigo', SANDBOX_BILLING.provider).maybeSingle(),
      supabase.from('saas_plan_proveedores').select('plan_codigo, external_plan_id, external_product_id, habilitado, metadata').eq('plan_codigo', SANDBOX_BILLING.planCode).eq('proveedor_codigo', SANDBOX_BILLING.provider).maybeSingle(),
      supabase.from('saas_plan_precios').select('id, plan_codigo, proveedor_codigo, pais_codigo, moneda, importe, periodicidad, entorno, external_plan_id, external_product_id, habilitado, activo').eq('plan_codigo', SANDBOX_BILLING.planCode).eq('proveedor_codigo', SANDBOX_BILLING.provider).eq('pais_codigo', 'AR').eq('entorno', 'sandbox').maybeSingle(),
      supabase.from('saas_billing_checkout_attempts').select('id, barberia_id, plan_codigo, proveedor_codigo, estado, checkout_url, external_checkout_id, created_at, updated_at').eq('barberia_id', SANDBOX_BILLING.tenantId).eq('plan_codigo', SANDBOX_BILLING.planCode).eq('proveedor_codigo', SANDBOX_BILLING.provider).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    setSandboxSnapshot((current) => ({
      ...current,
      tenant: tenantResult.data || null,
      provider: providerResult.data || null,
      plan: planResult.data || null,
      price: priceResult.data || null,
      checkout: checkoutResult.data || null,
    }))
  }, [role])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const [businessesResult, leadsResult, billingResult] = await Promise.all([
      supabase.from('crm_negocios').select('*').order('updated_at', { ascending: false }),
      supabase.from('crm_leads').select('id, negocio_id, nombre_contacto, email, telefono, canal_preferido, estado_conversacion, interes, proxima_accion_at').order('updated_at', { ascending: false }),
      ['owner', 'admin'].includes(role) ? supabase.rpc('get_platform_billing_overview') : Promise.resolve({ data: null, error: null }),
    ])
    if (businessesResult.error || leadsResult.error) {
      setError(businessesResult.error?.message || leadsResult.error?.message || 'No se pudo cargar el CRM')
    }
    setBusinesses(businessesResult.data || [])
    setLeads(leadsResult.data || [])
    setBillingOverview(billingResult.data || null)
    await loadSandboxSnapshot()
    setLoading(false)
  }, [loadSandboxSnapshot, role])

  useEffect(() => { load() }, [load])

  const executeSandboxAction = async (action) => {
    if (!['owner', 'admin'].includes(role)) return
    if (action === 'cancel-confirmation') {
      setSandboxConfirmAction('')
      return
    }
    if (['sync-plans', 'checkout', 'reconcile-sandbox'].includes(action) && sandboxConfirmAction !== action) {
      setSandboxConfirmAction(action)
      setSandboxError('')
      setSandboxNotice('')
      return
    }
    setSandboxConfirmAction('')

    setSandboxBusy(true)
    setSandboxError('')
    setSandboxNotice('')
    setSandboxAuditWarning('')
    let status = 'failed'
    const auditMetadata = { action }
    try {
      if (action === 'config-status') {
        const data = await sandboxBillingApi('config-status')
        setSandboxSnapshot((current) => ({ ...current, configStatus: data }))
        auditMetadata.token_kind = data?.token_kind || 'unknown'
        auditMetadata.sandbox_token_valid = Boolean(data?.sandbox_token_valid)
        auditMetadata.production_enabled = Boolean(data?.production_enabled)
        setSandboxNotice('Config-status consultado sin exponer secretos.')
      } else if (action === 'sync-plans') {
        const data = await sandboxBillingApi('sync-plans', { method: 'POST', body: { tenant_id: SANDBOX_BILLING.tenantId, proveedor_codigo: SANDBOX_BILLING.provider, plan_codigo: SANDBOX_BILLING.planCode } })
        auditMetadata.result = data?.results?.[0]?.status || 'unknown'
        setSandboxNotice('El plan starter fue sincronizado en sandbox.')
        await loadSandboxSnapshot()
      } else if (action === 'checkout') {
        const data = await sandboxBillingApi('checkout', { method: 'POST', body: { tenant_id: SANDBOX_BILLING.tenantId, plan_codigo: SANDBOX_BILLING.planCode, proveedor_codigo: SANDBOX_BILLING.provider } })
        auditMetadata.checkout_attempt_id = data?.checkout_attempt_id || null
        auditMetadata.has_checkout_url = Boolean(data?.checkout_url)
        auditMetadata.result = data?.status || 'unknown'
        setSandboxNotice(data?.checkout_url ? 'Checkout sandbox creado. La suscripción no se activa por la URL de retorno.' : 'El checkout quedó preparado sin URL.')
        await loadSandboxSnapshot()
      } else if (action === 'reconcile-sandbox') {
        const data = await sandboxBillingApi('reconcile-sandbox', { method: 'POST', body: { preapproval_id: SANDBOX_BILLING.preapprovalId } })
        auditMetadata.preapproval_id = SANDBOX_BILLING.preapprovalId
        auditMetadata.result = data?.normalized_status || data?.status || 'unknown'
        auditMetadata.idempotent = Boolean(data?.idempotent)
        setSandboxNotice(data?.idempotent ? 'La suscripción sandbox ya estaba reconciliada.' : 'Suscripción sandbox reconciliada y registrada como activa.')
        await load()
      } else if (action === 'external-status') {
        const attemptId = sandboxSnapshot.checkout?.id
        if (!attemptId) throw Object.assign(new Error('Todavía no existe un checkout sandbox.'), { code: 'external_status_failed' })
        const data = await sandboxBillingApi('external-status', { method: 'POST', body: { tenant_id: SANDBOX_BILLING.tenantId, checkout_attempt_id: attemptId, proveedor_codigo: SANDBOX_BILLING.provider } })
        auditMetadata.checkout_attempt_id = attemptId
        auditMetadata.result = data?.status || 'unknown'
        setSandboxSnapshot((current) => ({ ...current, externalStatus: data }))
        setSandboxNotice('Estado externo consultado; ninguna suscripción fue activada.')
      }
      status = 'succeeded'
    } catch (actionError) {
      auditMetadata.error_code = actionError?.code || 'sandbox_action_failed'
      setSandboxError(sanitizeSandboxError(actionError))
    } finally {
      try {
        await auditSandboxAction(action, status, auditMetadata)
      } catch {
        setSandboxAuditWarning('La operación terminó, pero no se pudo registrar su auditoría.')
      }
      setSandboxBusy(false)
    }
  }

  const filteredBusinesses = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return businesses
    return businesses.filter((business) => [
      business.nombre,
      business.pais,
      business.rubro,
      business.email,
      business.telefono,
      business.etapa,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)))
  }, [businesses, search])

  const stats = useMemo(() => ({
    total: businesses.length,
    active: businesses.filter((business) => ['demo', 'prueba', 'cliente'].includes(business.etapa)).length,
    interested: leads.filter((lead) => ['interesado', 'convertido'].includes(lead.estado_conversacion)).length,
    nextActions: businesses.filter((business) => business.proxima_accion_at && new Date(business.proxima_accion_at) <= new Date()).length,
  }), [businesses, leads])

  const businessById = useMemo(() => new Map(businesses.map((business) => [business.id, business])), [businesses])
  const filteredLeads = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return leads
    return leads.filter((lead) => [
      lead.nombre_contacto,
      lead.email,
      lead.telefono,
      lead.canal_preferido,
      lead.estado_conversacion,
      lead.interes,
      businessById.get(lead.negocio_id)?.nombre,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)))
  }, [businessById, leads, search])

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  const createBusiness = async (event) => {
    event.preventDefault()
    if (!form.nombre.trim()) return
    setSaving(true)
    setError('')
    const payload = {
      ...form,
      nombre: form.nombre.trim(),
      precio_ofrecido: form.precio_ofrecido === '' ? null : Number(form.precio_ofrecido),
      email: form.email.trim() || null,
      telefono: form.telefono.trim() || null,
      sitio_web: form.sitio_web.trim() || null,
      pais: form.pais.trim() || null,
      canal_origen: form.canal_origen.trim() || null,
      interes: form.interes.trim() || null,
      notas: form.notas.trim() || null,
    }
    const { error: insertError } = await supabase.from('crm_negocios').insert(payload)
    if (insertError) setError(insertError.message)
    else {
      setForm(emptyBusiness)
      setShowForm(false)
      await load()
    }
    setSaving(false)
  }

  return (
    <div className="app-shell platform-shell platform-screen">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><BriefcaseBusiness size={18} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-name">Austral SaaS</div>
            <div className="brand-sub">Operacion de plataforma</div>
          </div>
        </div>
        <nav className="nav platform-nav" aria-label="Navegación de plataforma">
          <div className="nav-section">
            <p className="nav-section-label">Plataforma</p>
            <button type="button" className={`nav-item ${view === 'businesses' ? 'active' : ''}`} onClick={() => setView('businesses')}><BriefcaseBusiness size={17} /><span>CRM comercial</span></button>
            <button type="button" className={`nav-item ${view === 'leads' ? 'active' : ''}`} onClick={() => setView('leads')}><UsersRound size={17} /><span>Negocios y leads</span></button>
            <button type="button" className={`nav-item ${view === 'agent' ? 'active' : ''}`} onClick={() => setView('agent')}><Bot size={17} /><span>Agente comercial</span></button>
            <button type="button" className={`nav-item ${view === 'pilot' ? 'active' : ''}`} onClick={() => setView('pilot')}><CheckSquare size={17} /><span>Piloto comercial</span></button>
            <button type="button" className={`nav-item ${view === 'actions' ? 'active' : ''}`} onClick={() => setView('actions')}><Bell size={17} /><span>Seguimientos</span></button>
            {['owner', 'admin'].includes(role) && <button type="button" className={`nav-item ${view === 'billing' ? 'active' : ''}`} onClick={() => setView('billing')}><CreditCard size={17} /><span>Facturacion SaaS</span></button>}
          </div>
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-status"><span className="live-dot" /> Rol: {role}</div>
          <button className="theme-toggle" onClick={logout}>
            <span className="theme-toggle-label"><LogOut size={14} /> Cerrar sesion</span>
          </button>
        </div>
      </aside>

      <main className="main platform-main">
        <div className="page-header platform-page-header">
          <div>
            <p className="page-kicker">Workspace interno</p>
            <h1 className="page-title">{view === 'billing' ? 'Facturacion SaaS' : view === 'agent' ? 'Agente comercial' : view === 'pilot' ? 'Piloto comercial' : view === 'actions' ? 'Seguimientos' : 'CRM comercial'}</h1>
            <p className="page-date">{view === 'billing' ? 'Estado de suscripciones, trials y eventos del billing.' : view === 'agent' ? 'Borradores comerciales con aprobación humana.' : view === 'pilot' ? 'Preparación local para cinco leads, sin contacto externo.' : view === 'actions' ? 'Próximas acciones y alertas internas del equipo.' : 'Prospectos, pruebas y negocios convertidos en un solo lugar.'}</p>
          </div>
          <div className="page-actions">
            <button className="btn" onClick={load} disabled={loading}><RefreshCw size={15} /> Actualizar</button>
            {canWrite && ['businesses', 'leads'].includes(view) && <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={15} /> Nuevo negocio</button>}
          </div>
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <section className="stats-grid platform-stats platform-kpis" aria-label="Resumen del CRM">
          <div className="stat-card platform-kpi"><span className="stat-label">Negocios</span><strong>{stats.total}</strong><small className="platform-kpi-caption">Total registrado</small></div>
          <div className="stat-card platform-kpi"><span className="stat-label">En demo/prueba</span><strong>{stats.active}</strong><small className="platform-kpi-caption">Cuentas activas</small></div>
          <div className="stat-card platform-kpi"><span className="stat-label">Leads interesados</span><strong>{stats.interested}</strong><small className="platform-kpi-caption">Oportunidades calientes</small></div>
          <div className="stat-card platform-kpi"><span className="stat-label">Acciones vencidas</span><strong>{stats.nextActions}</strong><small className="platform-kpi-caption">Requieren atención</small></div>
        </section>

        {view === 'pilot' ? <CommercialPilot /> : view === 'agent' ? <CommercialAgent /> : view === 'actions' ? <section className="panel platform-crm-panel platform-actions-panel"><CRMActionInbox role={role} /></section> : view === 'billing' ? <>
          <section className="panel platform-crm-panel platform-billing-panel">
            <div className="panel-header"><div><h2 className="panel-title">Salud de las cuentas</h2><p className="panel-subtitle">Sólo lectura. Las transiciones se ejecutan por RPC y webhook verificado.</p></div></div>
            {!billingOverview ? <div className="empty-state">No se pudo cargar el resumen de billing.</div> : <>
              <div className="stats-grid platform-stats billing-platform-stats">{Object.entries(billingOverview.subscriptions_by_state || {}).map(([state, count]) => <div className="stat-card" key={state}><span className="stat-label">{stageLabel(state)}</span><strong>{count}</strong></div>)}</div>
              <div className="table-scroll"><table className="table platform-table"><thead><tr><th>Negocio</th><th>Plan</th><th>Estado</th><th>Acceso</th><th>Trial</th><th>Periodo</th></tr></thead><tbody>{(billingOverview.tenants || []).map((tenant) => <tr key={tenant.barberia_id}><td><strong>{tenant.nombre}</strong></td><td>{tenant.plan_codigo}</td><td><span className="status-pill">{stageLabel(tenant.estado)}</span></td><td><span className="status-pill">{stageLabel(tenant.access_state)}</span></td><td>{formatDate(tenant.trial_ends_at)}</td><td>{formatDate(tenant.current_period_end)}</td></tr>)}</tbody></table></div>
              <p className="panel-subtitle billing-platform-footnote">Webhooks pendientes: {billingOverview.pending_webhooks || 0} · Eventos internos pendientes: {billingOverview.pending_events || 0}</p>
            </>}
          </section>
          <SandboxBillingConsole role={role} snapshot={sandboxSnapshot} busy={sandboxBusy} error={sandboxError} notice={sandboxNotice} auditWarning={sandboxAuditWarning} confirmAction={sandboxConfirmAction} onAction={executeSandboxAction} />
        </> : view === 'leads' ? <section className="panel platform-crm-panel platform-leads-panel">
          <div className="panel-header"><div><h2 className="panel-title">Leads comerciales</h2><p className="panel-subtitle">Pipeline, scoring, seguimiento y exclusiones con auditoría. El CRM global sólo es visible para usuarios de plataforma.</p></div></div>
          <CRMLeadsWorkspace role={role} />
        </section> : <section className={`panel platform-crm-panel platform-records-panel platform-records-${view}`}>
          <div className="panel-header">
            <div><h2 className="panel-title">{view === 'businesses' ? 'Negocios' : 'Leads'}</h2><p className="panel-subtitle">Los registros estan protegidos por RLS para miembros de plataforma.</p></div>
            <label className="crm-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === 'businesses' ? 'Buscar negocio...' : 'Buscar lead...'} aria-label={view === 'businesses' ? 'Buscar negocio' : 'Buscar lead'} /></label>
          </div>
          {loading ? <div className="empty-state">Cargando CRM...</div> : view === 'businesses' ? (filteredBusinesses.length === 0 ? (
            <div className="empty-state">No hay negocios que coincidan con la busqueda.</div>
          ) : (
            <div className="table-scroll">
              <table className="table platform-table">
                <thead><tr><th>Negocio</th><th>Rubro / pais</th><th>Etapa</th><th>Interes</th><th>Proxima accion</th></tr></thead>
                <tbody>{filteredBusinesses.map((business) => (
                  <tr key={business.id}>
                    <td><div className="table-name-cell"><span className="avatar avatar-sm">{business.nombre.slice(0, 1).toUpperCase()}</span><div><strong>{business.nombre}</strong><small>{business.email || business.telefono || 'Sin contacto'}</small></div></div></td>
                    <td>{business.rubro || 'custom'}{business.pais ? ` · ${business.pais}` : ''}</td>
                    <td><span className={`status-pill stage-${business.etapa}`}>{stageLabel(business.etapa)}</span></td>
                    <td>{business.interes || 'Sin clasificar'}</td>
                    <td>{formatDate(business.proxima_accion_at)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )) : filteredLeads.length === 0 ? (
            <div className="empty-state">No hay leads que coincidan con la busqueda.</div>
          ) : (
            <div className="table-scroll">
              <table className="table platform-table">
                <thead><tr><th>Contacto</th><th>Negocio</th><th>Canal</th><th>Estado</th><th>Interes</th><th>Proxima accion</th></tr></thead>
                <tbody>{filteredLeads.map((lead) => (
                  <tr key={lead.id}>
                    <td><div className="table-name-cell"><span className="avatar avatar-sm">{(lead.nombre_contacto || '?').slice(0, 1).toUpperCase()}</span><div><strong>{lead.nombre_contacto || 'Sin nombre'}</strong><small>{lead.email || lead.telefono || 'Sin contacto'}</small></div></div></td>
                    <td>{businessById.get(lead.negocio_id)?.nombre || `Negocio #${lead.negocio_id}`}</td>
                    <td>{lead.canal_preferido || 'Sin canal'}</td>
                    <td><span className="status-pill">{stageLabel(lead.estado_conversacion)}</span></td>
                    <td>{lead.interes || 'Sin clasificar'}</td>
                    <td>{formatDate(lead.proxima_accion_at)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>}
      </main>

      {showForm && <div className="modal-overlay" onClick={() => setShowForm(false)}>
        <form className="modal-box platform-crm-form" onSubmit={createBusiness} onClick={(event) => event.stopPropagation()}>
          <div className="modal-header"><div><h2 className="panel-title">Nuevo negocio</h2><p className="panel-subtitle">Solo guarda datos del CRM; no envia mensajes.</p></div><button type="button" className="btn-icon-plain" onClick={() => setShowForm(false)} aria-label="Cerrar"><X size={18} /></button></div>
          <div className="modal-row"><div className="modal-field"><label className="modal-label">Nombre *</label><input className="text-input" required value={form.nombre} onChange={(event) => updateForm('nombre', event.target.value)} autoFocus /></div><div className="modal-field"><label className="modal-label">Rubro</label><input className="text-input" value={form.rubro} onChange={(event) => updateForm('rubro', event.target.value)} /></div></div>
          <div className="modal-row"><div className="modal-field"><label className="modal-label">Pais</label><input className="text-input" value={form.pais} onChange={(event) => updateForm('pais', event.target.value)} /></div><div className="modal-field"><label className="modal-label">Idioma</label><input className="text-input" value={form.idioma} onChange={(event) => updateForm('idioma', event.target.value)} /></div></div>
          <div className="modal-row"><div className="modal-field"><label className="modal-label">Email</label><input className="text-input" type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} /></div><div className="modal-field"><label className="modal-label">Telefono</label><input className="text-input" inputMode="tel" value={form.telefono} onChange={(event) => updateForm('telefono', event.target.value)} /></div></div>
          <div className="modal-row"><div className="modal-field"><label className="modal-label">Canal de origen</label><input className="text-input" placeholder="web, referido, WhatsApp..." value={form.canal_origen} onChange={(event) => updateForm('canal_origen', event.target.value)} /></div><div className="modal-field"><label className="modal-label">Etapa</label><select className="text-input" value={form.etapa} onChange={(event) => updateForm('etapa', event.target.value)}>{STAGES.map((stage) => <option key={stage} value={stage}>{stageLabel(stage)}</option>)}</select></div></div>
          <div className="modal-row"><div className="modal-field"><label className="modal-label">Interes</label><input className="text-input" value={form.interes} onChange={(event) => updateForm('interes', event.target.value)} /></div><div className="modal-field"><label className="modal-label">Precio ofrecido ({form.moneda})</label><input className="text-input" type="number" min="0" step="0.01" value={form.precio_ofrecido} onChange={(event) => updateForm('precio_ofrecido', event.target.value)} /></div></div>
          <div className="modal-field"><label className="modal-label">Notas</label><textarea className="text-input" rows="3" value={form.notas} onChange={(event) => updateForm('notas', event.target.value)} /></div>
          <div className="modal-actions"><button type="button" className="btn" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando...' : 'Guardar negocio'}</button></div>
        </form>
      </div>}
    </div>
  )
}
