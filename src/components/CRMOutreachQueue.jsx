import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Clock3, MessageSquareText, RefreshCw, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabaseClient'
import { EmptyState } from './ui'

const OUTREACH_TYPES = [
  ['initial_contact', 'Contacto inicial'],
  ['follow_up_1', 'Seguimiento 1'],
  ['follow_up_2', 'Seguimiento 2'],
  ['replied', 'Respuesta recibida'],
  ['interested', 'Interesado'],
  ['demo_sent', 'Demo enviada'],
  ['trial_requested', 'Trial solicitado'],
]

export default function CRMOutreachQueue({ role = 'owner' }) {
  const [environment, setEnvironment] = useState('production')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [form, setForm] = useState({ type: 'initial_contact', channel: 'manual', result: '', notes: '' })
  const canWrite = ['owner', 'admin', 'sales', 'automation'].includes(role)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    const { data, error: loadError } = await supabase.rpc('get_crm_outreach_queue', { p_environment: environment, p_limit: 100 })
    if (loadError) setError(loadError.message || 'No se pudo cargar la cola comercial.')
    else { setError(''); setItems(Array.isArray(data) ? data : []) }
    setLoading(false)
  }, [environment])

  useEffect(() => { load() }, [load])

  const registerActivity = async (event) => {
    event.preventDefault()
    if (!selected || !canWrite || saving) return
    setSaving(true)
    try {
      const { data, error: activityError } = await supabase.rpc('record_crm_outreach_activity', {
        p_lead_id: selected.lead_id,
        p_type: form.type,
        p_channel: form.channel,
        p_result: form.result.trim() || null,
        p_notes: form.notes.trim() || null,
      })
      if (activityError) setError(activityError.message || 'No se pudo registrar la actividad.')
      else {
        setNotice(data?.external_send_performed === false ? 'Actividad registrada. No se envió ningún mensaje.' : 'Actividad registrada.')
        setSelected(null)
        setForm({ type: 'initial_contact', channel: 'manual', result: '', notes: '' })
        await load()
      }
    } finally {
      setSaving(false)
    }
  }

  return <section className="crm-outreach-queue" aria-labelledby="crm-outreach-title">
    {error && <div className="error-banner" role="alert">{error}</div>}
    {notice && <div className="settings-notice" role="status"><CheckCircle2 size={15} /> {notice}</div>}
    <div className="crm-toolbar">
      <label className="crm-filter"><span className="sr-only">Entorno de la cola</span><select value={environment} onChange={(event) => setEnvironment(event.target.value)} aria-label="Entorno de la cola"><option value="production">Producción</option><option value="sandbox">Sandbox</option><option value="demo">Demo</option><option value="internal">Interno</option></select></label>
      <button className="btn" type="button" onClick={load} disabled={loading}><RefreshCw size={14} /> Actualizar</button>
      <span className="platform-inline-note"><ShieldCheck size={14} /> La cola no envía mensajes.</span>
    </div>
    {loading ? <div role="status" aria-live="polite"><EmptyState description="Cargando leads listos para revisar…" /></div> : items.length === 0 ? <EmptyState icon={<MessageSquareText size={22} />} title="No hay leads listos para contactar" description="Un lead entra cuando está calificado, verificado y tiene un mensaje preparado." /> : <div className="crm-outreach-grid">{items.map((item) => <article className="crm-outreach-card" key={item.lead_id}>
      <div className="crm-outreach-card__header"><div><strong>{item.negocio}</strong><small>{item.ciudad || 'Ciudad pendiente'}{item.pais ? ` · ${item.pais}` : ''}</small></div><span className="score-badge score-high">{item.score || 0} · score</span></div>
      <div className="crm-outreach-card__meta"><span><MessageSquareText size={13} /> {item.canal || 'Manual'}</span><span><Clock3 size={13} /> {item.verified_at ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(new Date(item.verified_at)) : 'Sin verificación'}</span></div>
      <p>{item.message_prepared}</p>
      <div className="crm-outreach-card__footer"><span>{item.contacto || 'Contacto pendiente'}</span><span className="status-pill">{item.verification_quality || 'unknown'}</span>{canWrite && <button className="btn btn-primary" type="button" onClick={() => setSelected(item)}>Registrar actividad</button>}</div>
    </article>)}</div>}
    {selected && <div className="modal-overlay" onClick={() => { if (!saving) setSelected(null) }}><form className="modal-box" onSubmit={registerActivity} onClick={(event) => event.stopPropagation()} aria-busy={saving}>
      <div className="modal-header"><div><h2 className="panel-title">Registrar actividad</h2><p className="panel-subtitle">{selected.negocio}. Sólo se registra en el CRM; no se envía nada.</p></div><button type="button" className="btn-icon-plain" onClick={() => setSelected(null)} aria-label="Cerrar">×</button></div>
      <label className="modal-label">Tipo<select className="text-input" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{OUTREACH_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="modal-label">Canal<input className="text-input" value={form.channel} onChange={(event) => setForm({ ...form, channel: event.target.value })} maxLength={40} /></label>
      <label className="modal-label">Resultado<input className="text-input" value={form.result} onChange={(event) => setForm({ ...form, result: event.target.value })} maxLength={160} /></label>
      <label className="modal-label">Notas<textarea className="text-input" rows="3" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} maxLength={1000} /></label>
      <div className="modal-actions"><button type="button" className="btn" onClick={() => setSelected(null)} disabled={saving}>Cancelar</button><button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Guardando…' : 'Guardar registro'}</button></div>
    </form></div>}
  </section>
}
