import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronRight, ChevronUp, CircleHelp, LoaderCircle, MessageCircle, Sparkles, X } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'

const ROUTES = { datos_negocio: 'configuracion', logo: 'configuracion', servicios: 'operacion', empleados: 'operacion', horarios: 'operacion', pagina_publica: 'configuracion', reserva: 'agenda', colaboradores: 'configuracion', whatsapp: null, plan: 'facturacion' }

export default function OnboardingChecklist({ barberiaId, onNavigate }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [guideOpen, setGuideOpen] = useState(false)
  const [preferenceKey, setPreferenceKey] = useState(null)
  const [collapsed, setCollapsed] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let active = true
    const loadPreference = async () => {
      let userId = 'anonymous'
      if (isSupabaseConfigured) {
        const { data } = await supabase.auth.getUser()
        userId = data?.user?.id || userId
      }
      if (!active) return
      const key = `austral:onboarding-checklist:${barberiaId}:${userId}`
      setPreferenceKey(key)
      setCollapsed(window.localStorage.getItem(`${key}:collapsed`) === '1')
      setDismissed(window.localStorage.getItem(`${key}:dismissed`) === '1')
    }
    loadPreference()
    return () => { active = false }
  }, [barberiaId])

  const persistPreference = (kind, value) => {
    if (!preferenceKey) return
    if (value) window.localStorage.setItem(`${preferenceKey}:${kind}`, '1')
    else window.localStorage.removeItem(`${preferenceKey}:${kind}`)
  }

  useEffect(() => {
    let active = true
    if (!isSupabaseConfigured) { setLoading(false); return undefined }
    supabase.rpc('get_onboarding_status', { p_barberia_id: barberiaId }).then(({ data, error }) => {
      if (!active) return
      if (!error) setStatus(data)
      setLoading(false)
    })
    return () => { active = false }
  }, [barberiaId])

  if (loading) return <div className="onboarding-checklist panel"><LoaderCircle className="spin" size={16} /> Cargando recomendaciones…</div>
  if (!status?.items?.length) return null
  if (dismissed) return null

  const openItem = (item) => {
    if (item.key === 'whatsapp') { setGuideOpen(true); return }
    const destination = ROUTES[item.key]
    if (destination && onNavigate) onNavigate(destination)
  }

  return (
    <div className="onboarding-checklist panel fade-in">
      <div className="checklist-heading"><div><p className="panel-kicker"><Sparkles size={13} /> Primeros pasos</p><h2>{status.progress >= 100 ? 'Tu negocio ya está listo' : 'Terminá de configurar tu negocio'}</h2></div><div className="checklist-heading-actions"><strong>{status.progress}%</strong><button className="btn-icon-plain" type="button" onClick={() => { const next = !collapsed; setCollapsed(next); persistPreference('collapsed', next) }} aria-label={collapsed ? 'Expandir primeros pasos' : 'Minimizar primeros pasos'} title={collapsed ? 'Expandir' : 'Minimizar'}>{collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}</button>{status.progress >= 100 && <button className="btn-icon-plain" type="button" onClick={() => { setDismissed(true); persistPreference('dismissed', true) }} aria-label="Ocultar primeros pasos" title="Ocultar"><X size={16} /></button>}</div></div>
      {!collapsed && <><div className="checklist-progress"><span style={{ width: `${status.progress}%` }} /></div>
      <div className="checklist-items">{status.items.map((item) => <button className={`checklist-item ${item.done ? 'done' : ''}`} key={item.key} onClick={() => openItem(item)}><span className="checklist-check">{item.done ? <Check size={14} /> : null}</span><span>{item.label}</span>{!item.done && item.key === 'whatsapp' ? <MessageCircle size={15} /> : !item.done ? <ChevronRight size={15} /> : null}</button>)}</div></>}
      {guideOpen && <div className="guide-panel"><div className="guide-heading"><MessageCircle size={17} /><strong>Conectar WhatsApp</strong><button className="btn-icon-plain" onClick={() => setGuideOpen(false)} aria-label="Cerrar">×</button></div><p>La conexión es manual y segura. Necesitás crear o elegir una instancia en Evolution, copiar su URL y pedir al administrador que configure el webhook en n8n.</p><ol><li>Confirmá que tu número de WhatsApp esté conectado en Evolution.</li><li>Compartí con soporte únicamente el nombre de la instancia y el número normalizado.</li><li>Probamos la resolución del tenant en modo shadow antes de activar mensajes.</li></ol><div className="guide-note"><CircleHelp size={15} /> Este asistente no envía mensajes ni modifica el workflow productivo.</div></div>}
    </div>
  )
}
