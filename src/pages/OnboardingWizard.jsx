import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Globe2, ImagePlus, LoaderCircle, MapPin, Palette, Scissors, ShieldCheck, Sparkles } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { sanitizeAuthError } from '../lib/authErrors'
import { buildAuthRedirect } from '../lib/authRedirect'

const STEPS = [
  { title: '¿Cómo se llama tu negocio?', description: 'Podés cambiarlo más adelante.', icon: Scissors },
  { title: 'Elegí tu rubro', description: 'Esto adapta etiquetas y recomendaciones del panel.', icon: Sparkles },
  { title: '¿Dónde está tu negocio?', description: 'Usamos el país para sugerir moneda y formatos.', icon: MapPin },
  { title: 'Idioma del panel', description: 'La configuración regional se guarda por negocio.', icon: Globe2 },
  { title: 'Zona horaria', description: 'Así los turnos siempre se muestran en la hora correcta.', icon: Clock3 },
  { title: 'Moneda', description: 'La moneda de precios y reportes de tu negocio.', icon: Sparkles },
  { title: 'Personalizá tu marca', description: 'Estos datos son opcionales y podés completarlos después.', icon: Palette },
  { title: 'Todo listo para empezar', description: 'Revisá los datos y activá tu prueba gratuita.', icon: CheckCircle2 },
]

const FALLBACK_CATALOG = {
  verticales: [
    { codigo: 'barberia', nombre: 'Barbería' }, { codigo: 'peluqueria', nombre: 'Peluquería' },
    { codigo: 'salon', nombre: 'Salón de belleza' }, { codigo: 'spa', nombre: 'Centro de estética' },
    { codigo: 'veterinaria', nombre: 'Veterinaria' }, { codigo: 'gimnasio', nombre: 'Gimnasio' },
    { codigo: 'clinica', nombre: 'Clínica' }, { codigo: 'taller', nombre: 'Taller' }, { codigo: 'custom', nombre: 'Otro' },
  ],
  paises: [{ codigo: 'AR', nombre: 'Argentina' }, { codigo: 'UY', nombre: 'Uruguay' }, { codigo: 'CL', nombre: 'Chile' }, { codigo: 'MX', nombre: 'México' }, { codigo: 'ES', nombre: 'España' }, { codigo: 'OTRO', nombre: 'Otro' }],
  idiomas: [{ codigo: 'es-AR', nombre: 'Español' }, { codigo: 'en', nombre: 'English' }, { codigo: 'pt-BR', nombre: 'Português' }],
  monedas: [{ codigo: 'ARS', nombre: 'Peso argentino' }, { codigo: 'USD', nombre: 'Dólar estadounidense' }, { codigo: 'UYU', nombre: 'Peso uruguayo' }, { codigo: 'CLP', nombre: 'Peso chileno' }, { codigo: 'MXN', nombre: 'Peso mexicano' }, { codigo: 'EUR', nombre: 'Euro' }],
}

const defaultTimezone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Argentina/Buenos_Aires' } catch { return 'America/Argentina/Buenos_Aires' }
}

function errorMessage(error) {
  const raw = error?.message || 'No pudimos guardar el onboarding.'
  return raw.replace(/^.*?ERROR:\s*/i, '').replace(/\s*DETAIL:.*$/i, '')
}

export default function OnboardingWizard() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  const [step, setStep] = useState(0)
  const [catalog, setCatalog] = useState(FALLBACK_CATALOG)
  const [form, setForm] = useState({ nombre: '', vertical: 'barberia', pais: 'AR', idioma: 'es-AR', zona_horaria: defaultTimezone(), moneda: 'ARS', logo_url: '', color_principal: '', color_secundario: '', source: 'direct' })
  const [loading, setLoading] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [verified, setVerified] = useState(false)
  const completedRef = useRef(false)

  const storageKey = user ? `saas-onboarding:${user.id}` : null
  const currentStep = STEPS[step]
  const StepIcon = currentStep.icon

  useEffect(() => {
    if (!isSupabaseConfigured) { setChecking(false); return undefined }
    let active = true
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      setUser(data.user || null)
      setVerified(Boolean(data.user?.email_confirmed_at))
      setChecking(false)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!storageKey) return
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed.form) setForm((previous) => ({ ...previous, ...parsed.form }))
        if (Number.isInteger(parsed.step)) setStep(Math.max(0, Math.min(7, parsed.step)))
      }
    } catch { /* localStorage is optional */ }
  }, [storageKey])

  useEffect(() => {
    if (!user || !verified || !isSupabaseConfigured) return
    let active = true
    setCatalogLoading(true)
    supabase.rpc('get_self_service_catalog').then(({ data, error: catalogError }) => {
      if (!active) return
      if (!catalogError && data) setCatalog(data)
      setCatalogLoading(false)
    })
    return () => { active = false }
  }, [user, verified])

  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ form, step, updatedAt: new Date().toISOString() }))
      setSaved(true)
      const timeout = window.setTimeout(() => setSaved(false), 1400)
      return () => window.clearTimeout(timeout)
    } catch { return undefined }
  }, [form, step, storageKey])

  useEffect(() => {
    if (!user || !verified || !isSupabaseConfigured) return
    supabase.rpc('track_self_service_onboarding', { p_event_name: 'step_viewed', p_step: step, p_source: form.source, p_metadata: { path: window.location.pathname } }).then(() => {})
  }, [step, user, verified, form.source])

  useEffect(() => {
    if (!user || !verified || !isSupabaseConfigured) return undefined
    const markAbandoned = () => {
      if (completedRef.current) return
      supabase.rpc('track_self_service_onboarding', { p_event_name: 'onboarding_abandoned', p_step: step, p_source: form.source, p_metadata: { path: window.location.pathname } }).then(() => {})
    }
    window.addEventListener('pagehide', markAbandoned)
    return () => window.removeEventListener('pagehide', markAbandoned)
  }, [step, user, verified, form.source])

  const setValue = (key, value) => setForm((previous) => ({ ...previous, [key]: value }))

  const validateStep = () => {
    if (step === 0 && (form.nombre.trim().length < 2 || form.nombre.trim().length > 80)) return 'Escribí un nombre de negocio válido (entre 2 y 80 caracteres).'
    if (step === 1 && !form.vertical) return 'Elegí un rubro para continuar.'
    if (step === 2 && !form.pais) return 'Elegí un país para continuar.'
    if (step === 3 && !form.idioma) return 'Elegí un idioma para continuar.'
    if (step === 4 && !form.zona_horaria) return 'Elegí una zona horaria para continuar.'
    if (step === 5 && !form.moneda) return 'Elegí una moneda para continuar.'
    if (step === 6 && form.logo_url && !/^https?:\/\//i.test(form.logo_url)) return 'La URL del logo debe comenzar con http:// o https://.'
    return ''
  }

  const next = async () => {
    setError('')
    const validation = validateStep()
    if (validation) { setError(validation); return }
    if (step < STEPS.length - 1) {
      setStep((value) => value + 1)
      return
    }
    setLoading(true)
    const { data, error: completionError } = await supabase.rpc('complete_self_service_onboarding', {
      p_nombre: form.nombre.trim(), p_vertical: form.vertical, p_pais: form.pais, p_idioma: form.idioma,
      p_zona_horaria: form.zona_horaria, p_moneda: form.moneda, p_logo_url: form.logo_url.trim() || null,
      p_color_principal: form.color_principal || null, p_color_secundario: form.color_secundario || null, p_source: form.source,
    })
    setLoading(false)
    if (completionError) { setError(errorMessage(completionError)); return }
    if (!data?.barberia_id) { setError('La cuenta se creó, pero no recibimos el negocio. Reintentá en unos segundos.'); return }
    completedRef.current = true
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    window.location.assign('/')
  }

  const resendVerification = async () => {
    if (!user?.email) return
    setError('')
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: user.email, options: { emailRedirectTo: buildAuthRedirect('/auth/confirm?next=/onboarding') } })
    if (resendError) setError(sanitizeAuthError(resendError, 'No pudimos reenviar el email.'))
    else setSaved(true)
  }

  const selectedVertical = useMemo(() => catalog.verticales?.find((item) => item.codigo === form.vertical), [catalog.verticales, form.vertical])

  if (checking) return <div className="auth-shell"><div className="auth-card"><LoaderCircle className="spin" size={24} /><p className="auth-copy">Cargando tu cuenta…</p></div></div>
  if (!user) return <div className="auth-shell"><div className="auth-card"><p className="auth-kicker">Onboarding</p><h1 className="auth-title">Iniciá sesión para continuar</h1><p className="auth-copy">Primero necesitamos identificar tu cuenta.</p><button className="btn btn-primary auth-full-button" onClick={() => window.location.assign('/')}>Ir a iniciar sesión <ArrowRight size={15} /></button></div></div>
  if (!verified) return (
    <div className="auth-shell"><div className="auth-card fade-in">
      <div className="auth-success-icon"><ShieldCheck size={23} /></div><p className="auth-kicker">Un paso más</p><h1 className="auth-title">Verificá tu email</h1>
      <p className="auth-copy">Enviamos un enlace a <strong>{user.email}</strong>. Por seguridad, recién después de verificarlo vas a poder crear el negocio.</p>
      {error && <p className="login-error" role="alert">{error}</p>}
      {saved && <p className="auth-message"><CheckCircle2 size={15} /> Email enviado.</p>}
      <button className="btn btn-primary auth-full-button" onClick={resendVerification}>Reenviar email</button>
      <button className="auth-link auth-center-link" onClick={() => window.location.assign('/')}>Volver al inicio</button>
    </div></div>
  )

  return (
    <div className="onboarding-shell">
      <div className="onboarding-topbar"><div className="auth-brand"><div className="brand-mark"><Scissors size={18} /></div><div className="brand-name">Configurá tu negocio</div></div><span className="autosave-label">{saved ? 'Guardado' : 'Guardado automático'} <Check size={13} /></span></div>
      <main className="onboarding-layout">
        <aside className="onboarding-progress" aria-label="Progreso de configuración">
          <p className="auth-kicker">Tu prueba gratuita</p><h1 className="onboarding-heading">Empezá en minutos</h1><p className="auth-copy">Sin tarjeta. 14 días para probar toda la operación.</p>
          <div className="progress-track"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div><p className="progress-caption">Paso {step + 1} de {STEPS.length}</p>
          <div className="step-list">{STEPS.map((item, index) => <div className={`step-list-item ${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`} key={item.title}><span className="step-list-number">{index < step ? <Check size={13} /> : index + 1}</span><span>{item.title}</span></div>)}</div>
        </aside>
        <section className="onboarding-card fade-in" key={step}>
          <div className="onboarding-card-heading"><div className="onboarding-step-icon"><StepIcon size={22} /></div><div><p className="auth-kicker">Configuración inicial</p><h2>{currentStep.title}</h2><p>{currentStep.description}</p></div></div>
          {step === 0 && <div className="modal-field"><label className="modal-label" htmlFor="onboarding-name">Nombre del negocio</label><input id="onboarding-name" className="text-input onboarding-input" value={form.nombre} onChange={(event) => setValue('nombre', event.target.value)} maxLength={80} autoFocus placeholder="Ej. Barbería Central" /></div>}
          {step === 1 && <div className="choice-grid">{(catalog.verticales || []).map((item) => <button type="button" className={`choice-card ${form.vertical === item.codigo ? 'selected' : ''}`} key={item.codigo} onClick={() => setValue('vertical', item.codigo)}><span>{item.nombre}</span>{form.vertical === item.codigo && <CheckCircle2 size={17} />}</button>)}</div>}
          {step === 2 && <div className="choice-grid">{(catalog.paises || []).map((item) => <button type="button" className={`choice-card ${form.pais === item.codigo ? 'selected' : ''}`} key={item.codigo} onClick={() => setValue('pais', item.codigo)}><span>{item.nombre}</span>{form.pais === item.codigo && <CheckCircle2 size={17} />}</button>)}</div>}
          {step === 3 && <div className="choice-grid">{(catalog.idiomas || []).map((item) => <button type="button" className={`choice-card ${form.idioma === item.codigo ? 'selected' : ''}`} key={item.codigo} onClick={() => setValue('idioma', item.codigo)}><span>{item.nombre}</span>{form.idioma === item.codigo && <CheckCircle2 size={17} />}</button>)}</div>}
          {step === 4 && <div className="modal-field"><label className="modal-label" htmlFor="onboarding-timezone">Zona horaria</label><select id="onboarding-timezone" className="text-input onboarding-input" value={form.zona_horaria} onChange={(event) => setValue('zona_horaria', event.target.value)}><option value="America/Argentina/Buenos_Aires">Argentina (Buenos Aires)</option><option value="America/Montevideo">Uruguay (Montevideo)</option><option value="America/Santiago">Chile (Santiago)</option><option value="America/Mexico_City">México (Ciudad de México)</option><option value="Europe/Madrid">España (Madrid)</option><option value="UTC">UTC</option></select><span className="field-hint">Detectamos: {defaultTimezone()}</span></div>}
          {step === 5 && <div className="choice-grid">{(catalog.monedas || []).map((item) => <button type="button" className={`choice-card ${form.moneda === item.codigo ? 'selected' : ''}`} key={item.codigo} onClick={() => setValue('moneda', item.codigo)}><span><strong>{item.codigo}</strong> · {item.nombre}</span>{form.moneda === item.codigo && <CheckCircle2 size={17} />}</button>)}</div>}
          {step === 6 && <div className="branding-fields"><div className="modal-field"><label className="modal-label" htmlFor="onboarding-logo"><ImagePlus size={13} /> URL del logo (opcional)</label><input id="onboarding-logo" className="text-input onboarding-input" type="url" value={form.logo_url} onChange={(event) => setValue('logo_url', event.target.value)} placeholder="https://…" /></div><div className="color-row"><label className="color-field"><span>Color principal</span><input type="color" value={form.color_principal || '#9B6A2F'} onChange={(event) => setValue('color_principal', event.target.value)} /></label><label className="color-field"><span>Color secundario</span><input type="color" value={form.color_secundario || '#EDE6D8'} onChange={(event) => setValue('color_secundario', event.target.value)} /></label></div></div>}
          {step === 7 && <div className="review-card"><div className="review-row"><span>Negocio</span><strong>{form.nombre || '—'}</strong></div><div className="review-row"><span>Rubro</span><strong>{selectedVertical?.nombre || form.vertical}</strong></div><div className="review-row"><span>Ubicación</span><strong>{catalog.paises?.find((item) => item.codigo === form.pais)?.nombre || form.pais}</strong></div><div className="review-row"><span>Configuración</span><strong>{form.idioma} · {form.moneda}</strong></div><div className="trial-callout"><Sparkles size={17} /><span><strong>Se activa una prueba gratuita de 14 días</strong><small>Incluye configuración inicial, agenda y reservas. No se crea información ficticia.</small></span></div></div>}
          {error && <p className="login-error onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-actions">{step > 0 ? <button className="btn" onClick={() => { setError(''); setStep((value) => value - 1) }} disabled={loading}><ArrowLeft size={15} /> Atrás</button> : <span />}{catalogLoading && step === 1 ? <span className="field-hint">Cargando opciones…</span> : <button className="btn btn-primary" onClick={next} disabled={loading}>{loading ? <><LoaderCircle className="spin" size={15} /> Activando…</> : step === 7 ? 'Crear mi negocio' : <>Continuar <ArrowRight size={15} /></>}</button>}</div>
        </section>
      </main>
    </div>
  )
}
