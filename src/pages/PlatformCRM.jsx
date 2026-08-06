import { useCallback, useEffect, useMemo, useState } from 'react'
import { BriefcaseBusiness, Bot, CreditCard, LogOut, Plus, RefreshCw, Search, UsersRound, X } from 'lucide-react'
import { logout } from '../components/Login.jsx'
import { supabase } from '../lib/supabaseClient'
import CommercialAgent from './CommercialAgent.jsx'

const STAGES = ['discovered', 'qualified', 'contacted', 'replied', 'interested', 'demo', 'trial', 'negotiating', 'won', 'lost', 'do_not_contact']

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
    setLoading(false)
  }, [role])

  useEffect(() => { load() }, [load])

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
    <div className="app-shell platform-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><BriefcaseBusiness size={18} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-name">Austral SaaS</div>
            <div className="brand-sub">Operacion de plataforma</div>
          </div>
        </div>
        <nav className="nav">
          <div className="nav-section">
            <p className="nav-section-label">Plataforma</p>
            <button type="button" className={`nav-item ${view === 'businesses' ? 'active' : ''}`} onClick={() => setView('businesses')}><BriefcaseBusiness size={17} /><span>CRM comercial</span></button>
            <button type="button" className={`nav-item ${view === 'leads' ? 'active' : ''}`} onClick={() => setView('leads')}><UsersRound size={17} /><span>Negocios y leads</span></button>
            <button type="button" className={`nav-item ${view === 'agent' ? 'active' : ''}`} onClick={() => setView('agent')}><Bot size={17} /><span>Agente comercial</span></button>
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
        <div className="page-header">
          <div>
            <p className="page-kicker">Workspace interno</p>
            <h1 className="page-title">{view === 'billing' ? 'Facturacion SaaS' : view === 'agent' ? 'Agente comercial' : 'CRM comercial'}</h1>
            <p className="page-date">{view === 'billing' ? 'Estado de suscripciones, trials y eventos del billing.' : view === 'agent' ? 'Borradores comerciales con aprobación humana.' : 'Prospectos, pruebas y negocios convertidos en un solo lugar.'}</p>
          </div>
          <div className="page-actions">
            <button className="btn" onClick={load} disabled={loading}><RefreshCw size={15} /> Actualizar</button>
            {view !== 'billing' && <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={15} /> Nuevo negocio</button>}
          </div>
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <section className="stats-grid platform-stats" aria-label="Resumen del CRM">
          <div className="stat-card"><span className="stat-label">Negocios</span><strong>{stats.total}</strong></div>
          <div className="stat-card"><span className="stat-label">En demo/prueba</span><strong>{stats.active}</strong></div>
          <div className="stat-card"><span className="stat-label">Leads interesados</span><strong>{stats.interested}</strong></div>
          <div className="stat-card"><span className="stat-label">Acciones vencidas</span><strong>{stats.nextActions}</strong></div>
        </section>

        {view === 'agent' ? <CommercialAgent /> : view === 'billing' ? <section className="panel platform-crm-panel">
          <div className="panel-header"><div><h2 className="panel-title">Salud de las cuentas</h2><p className="panel-subtitle">Sólo lectura. Las transiciones se ejecutan por RPC y webhook verificado.</p></div></div>
          {!billingOverview ? <div className="empty-state">No se pudo cargar el resumen de billing.</div> : <>
            <div className="stats-grid platform-stats billing-platform-stats">{Object.entries(billingOverview.subscriptions_by_state || {}).map(([state, count]) => <div className="stat-card" key={state}><span className="stat-label">{stageLabel(state)}</span><strong>{count}</strong></div>)}</div>
            <div className="table-scroll"><table className="table platform-table"><thead><tr><th>Negocio</th><th>Plan</th><th>Estado</th><th>Acceso</th><th>Trial</th><th>Periodo</th></tr></thead><tbody>{(billingOverview.tenants || []).map((tenant) => <tr key={tenant.barberia_id}><td><strong>{tenant.nombre}</strong></td><td>{tenant.plan_codigo}</td><td><span className="status-pill">{stageLabel(tenant.estado)}</span></td><td><span className="status-pill">{stageLabel(tenant.access_state)}</span></td><td>{formatDate(tenant.trial_ends_at)}</td><td>{formatDate(tenant.current_period_end)}</td></tr>)}</tbody></table></div>
            <p className="panel-subtitle billing-platform-footnote">Webhooks pendientes: {billingOverview.pending_webhooks || 0} · Eventos internos pendientes: {billingOverview.pending_events || 0}</p>
          </>}
        </section> : <section className="panel platform-crm-panel">
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
