import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Clock3, Coins, Globe2, ImagePlus, LoaderCircle, MailCheck, MapPin, Palette, Store, Sparkles } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import { sanitizeAuthError } from '../lib/authErrors'
import { buildAuthRedirect } from '../lib/authRedirect'
import { saveWorkspacePreference } from '../lib/workspacePreference.js'
import { markWorkspaceTransition } from '../lib/workspaceTransition.js'
import { COMMERCIAL_TRIAL_DAYS } from '../lib/commercialCatalog'
import { AuthAlert, AuthBrand, AuthPage, usePublicTheme } from './AuthLayout.jsx'

const STEPS = [
  { title: '¿Cómo se llama tu negocio?', short: 'Nombre', description: 'Es el nombre que van a ver tus clientes. Podés cambiarlo más adelante.', icon: Store },
  { title: 'Elegí tu rubro', short: 'Rubro', description: 'Adapta las etiquetas y recomendaciones del panel.', icon: Sparkles },
  { title: '¿Dónde está tu negocio?', short: 'País', description: 'Usamos el país para sugerir moneda y formatos.', icon: MapPin },
  { title: 'Idioma del panel', short: 'Idioma', description: 'La configuración regional se guarda por negocio.', icon: Globe2 },
  { title: 'Zona horaria', short: 'Zona horaria', description: 'Así los turnos siempre se muestran en la hora correcta.', icon: Clock3 },
  { title: 'Moneda', short: 'Moneda', description: 'La moneda de precios y reportes de tu negocio.', icon: Coins },
  { title: 'Personalizá tu marca', short: 'Marca', description: 'Opcional: podés completarlo ahora o más adelante desde Configuración.', icon: Palette },
  { title: 'Todo listo para empezar', short: 'Revisión', description: 'Revisá los datos y activá tu prueba gratuita.', icon: CheckCircle2 },
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

const TIMEZONES = [
  ['America/Argentina/Buenos_Aires', 'Argentina (Buenos Aires)'],
  ['America/Montevideo', 'Uruguay (Montevideo)'],
  ['America/Santiago', 'Chile (Santiago)'],
  ['America/Mexico_City', 'México (Ciudad de México)'],
  ['Europe/Madrid', 'España (Madrid)'],
  ['UTC', 'UTC'],
]

// Algunos navegadores informan el alias histórico America/Buenos_Aires.
const TIMEZONE_ALIASES = { 'America/Buenos_Aires': 'America/Argentina/Buenos_Aires' }
const defaultTimezone = () => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Argentina/Buenos_Aires'
    return TIMEZONE_ALIASES[zone] || zone
  } catch { return 'America/Argentina/Buenos_Aires' }
}

// Los mensajes propios de la RPC llegan en español; los errores técnicos de
// Postgres/PostgREST no se muestran tal cual al usuario.
function errorMessage(error) {
  const raw = String(error?.message || '').replace(/^.*?ERROR:\s*/i, '').replace(/\s*DETAIL:.*$/i, '').trim()
  if (!raw || /violates|constraint|function|permission denied|jwt|null value|relation|syntax|schema|fetch|network/i.test(raw)) return 'No pudimos crear tu negocio. Reintentá en unos segundos.'
  return raw
}

function nameFrom(list, code) {
  return list?.find((item) => item.codigo === code)?.nombre || code
}

function CenteredState({ children }) {
  return <AuthPage cardClassName="auth-center">{children}</AuthPage>
}

export default function OnboardingWizard() {
  usePublicTheme()
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
  const [resendState, setResendState] = useState('idle')
  const [resendCooldown, setResendCooldown] = useState(0)
  const completedRef = useRef(false)

  const storageKey = user ? `saas-onboarding:${user.id}` : null
  const currentStep = STEPS[step]
  const StepIcon = currentStep.icon
  const isLastStep = step === STEPS.length - 1

  useEffect(() => {
    if (!isSupabaseConfigured) { setChecking(false); return undefined }
    let active = true
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      setUser(data.user || null)
      setVerified(Boolean(data.user?.email_confirmed_at))
    }).catch(() => { if (active) setUser(null) }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (resendCooldown <= 0) return undefined
    const timer = window.setInterval(() => setResendCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendCooldown])

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
    }, () => { if (active) setCatalogLoading(false) })
    return () => { active = false }
  }, [user, verified])

  useEffect(() => {
    if (!storageKey || !verified) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ form, step, updatedAt: new Date().toISOString() }))
      setSaved(true)
      const timeout = window.setTimeout(() => setSaved(false), 1400)
      return () => window.clearTimeout(timeout)
    } catch { return undefined }
  }, [form, step, storageKey, verified])

  useEffect(() => {
    if (!user || !verified || !isSupabaseConfigured) return
    supabase.rpc('track_self_service_onboarding', { p_event_name: 'step_viewed', p_step: step, p_source: form.source, p_metadata: { path: window.location.pathname } }).then(() => {}, () => {})
  }, [step, user, verified, form.source])

  useEffect(() => {
    if (!user || !verified || !isSupabaseConfigured) return undefined
    const markAbandoned = () => {
      if (completedRef.current) return
      supabase.rpc('track_self_service_onboarding', { p_event_name: 'onboarding_abandoned', p_step: step, p_source: form.source, p_metadata: { path: window.location.pathname } }).then(() => {}, () => {})
    }
    window.addEventListener('pagehide', markAbandoned)
    return () => window.removeEventListener('pagehide', markAbandoned)
  }, [step, user, verified, form.source])

  const setValue = (key, value) => { setError(''); setForm((previous) => ({ ...previous, [key]: value })) }

  const validateStep = () => {
    if (step === 0 && (form.nombre.trim().length < 2 || form.nombre.trim().length > 80)) return 'Escribí un nombre de negocio válido (entre 2 y 80 caracteres).'
    if (step === 1 && !form.vertical) return 'Elegí un rubro para continuar.'
    if (step === 2 && !form.pais) return 'Elegí un país para continuar.'
    if (step === 3 && !form.idioma) return 'Elegí un idioma para continuar.'
    if (step === 4 && !form.zona_horaria) return 'Elegí una zona horaria para continuar.'
    if (step === 5 && !form.moneda) return 'Elegí una moneda para continuar.'
    if (step === 6 && form.logo_url && !/^https?:\/\//i.test(form.logo_url.trim())) return 'La URL del logo debe comenzar con http:// o https://.'
    return ''
  }

  const next = async (event) => {
    event?.preventDefault()
    if (loading) return
    setError('')
    const validation = validateStep()
    if (validation) { setError(validation); return }
    if (!isLastStep) {
      setStep((value) => value + 1)
      return
    }
    setLoading(true)
    let data
    let completionError
    try {
      ;({ data, error: completionError } = await supabase.rpc('complete_self_service_onboarding', {
        p_nombre: form.nombre.trim(), p_vertical: form.vertical, p_pais: form.pais, p_idioma: form.idioma,
        p_zona_horaria: form.zona_horaria, p_moneda: form.moneda, p_logo_url: form.logo_url.trim() || null,
        p_color_principal: form.color_principal || null, p_color_secundario: form.color_secundario || null, p_source: form.source,
      }))
    } catch (requestError) {
      completionError = requestError || new Error('network')
    }
    if (completionError) { setLoading(false); setError(errorMessage(completionError)); return }
    if (!data?.barberia_id) { setLoading(false); setError('La cuenta se creó, pero no recibimos el negocio. Reintentá en unos segundos.'); return }
    completedRef.current = true
    saveWorkspacePreference('business', data.barberia_id)
    markWorkspaceTransition()
    try { localStorage.removeItem(storageKey) } catch { /* ignore */ }
    // El botón queda en "Activando…" hasta que navega al panel.
    window.location.assign('/')
  }

  const back = () => { setError(''); setStep((value) => Math.max(0, value - 1)) }

  const resendVerification = async () => {
    if (!user?.email || resendState === 'loading' || resendCooldown > 0) return
    setError('')
    setResendState('loading')
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: user.email, options: { emailRedirectTo: buildAuthRedirect('/auth/confirm?next=/onboarding') } })
      if (resendError) { setResendState('idle'); setError(sanitizeAuthError(resendError, 'No pudimos reenviar el email.')); setResendCooldown(10); return }
      setResendState('sent')
      setResendCooldown(30)
    } catch {
      setResendState('idle')
      setError('No pudimos conectarnos. Revisá tu conexión e intentá nuevamente.')
    }
  }

  const selectedVertical = useMemo(() => catalog.verticales?.find((item) => item.codigo === form.vertical), [catalog.verticales, form.vertical])
  const detectedTimezone = useMemo(() => defaultTimezone(), [])
  // Si el navegador detecta una zona que no está en la lista, la agregamos para
  // que el select muestre exactamente el valor que se va a guardar.
  const timezoneOptions = useMemo(() => {
    const known = TIMEZONES.some(([value]) => value === form.zona_horaria)
    return known ? TIMEZONES : [[form.zona_horaria, `${form.zona_horaria} (detectada)`], ...TIMEZONES]
  }, [form.zona_horaria])
  const timezoneLabel = timezoneOptions.find(([value]) => value === form.zona_horaria)?.[1] || form.zona_horaria

  if (checking) return <CenteredState><div className="auth-loading" role="status"><LoaderCircle className="spin" size={24} aria-hidden="true" /><p className="auth-copy">Cargando tu cuenta…</p></div></CenteredState>
  if (!user) return (
    <CenteredState>
      <p className="auth-kicker">Configuración inicial</p>
      <h1 className="auth-title">Iniciá sesión para continuar</h1>
      <p className="auth-copy">Primero necesitamos identificar tu cuenta para crear tu negocio.</p>
      <div className="auth-actions">
        <a className="btn btn-primary auth-full-button" href="/ingresar?redirect=%2Fonboarding">Ir a iniciar sesión <ArrowRight size={15} aria-hidden="true" /></a>
        <a className="auth-link auth-center-link" href="/registro">Crear una cuenta</a>
      </div>
    </CenteredState>
  )
  if (!verified) return (
    <CenteredState>
      <div className="auth-icon-badge"><MailCheck size={23} aria-hidden="true" /></div>
      <p className="auth-kicker">Un paso más</p>
      <h1 className="auth-title">Verificá tu email</h1>
      <p className="auth-copy">Te enviamos un enlace a <strong>{user.email}</strong>. Por seguridad, vas a poder crear el negocio después de verificarlo.</p>
      <p className="auth-field-hint">¿No llegó? Revisá la carpeta de spam o promociones.</p>
      <div className="auth-actions">
        <AuthAlert>{error}</AuthAlert>
        {resendState === 'sent' && <AuthAlert tone="success"><CheckCircle2 size={15} aria-hidden="true" /> Te enviamos un nuevo enlace.</AuthAlert>}
        <button type="button" className="btn btn-primary auth-full-button" onClick={resendVerification} disabled={resendState === 'loading' || resendCooldown > 0} aria-busy={resendState === 'loading'}>{resendState === 'loading' ? 'Enviando…' : resendCooldown > 0 ? `Podés reenviar en ${resendCooldown} s` : 'Reenviar email'}</button>
        <a className="auth-link auth-center-link" href="/">Volver al inicio</a>
      </div>
    </CenteredState>
  )

  return (
    <div className="auth-page onboarding-page onboarding-shell">
      <header className="onboarding-topbar"><AuthBrand /><span className="autosave-label" aria-live="polite">{saved ? <>Guardado <Check size={13} aria-hidden="true" /></> : 'Guardado automático'}</span></header>
      <main className="onboarding-layout">
        <aside className="onboarding-progress" aria-label="Progreso de configuración">
          <p className="auth-kicker">Tu prueba gratuita</p><h1 className="onboarding-heading">Empezá en minutos</h1><p className="auth-copy">Sin tarjeta. {COMMERCIAL_TRIAL_DAYS} días para probar toda la operación.</p>
          <div className="progress-track" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Avance de la configuración"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div><p className="progress-caption">Paso {step + 1} de {STEPS.length}</p>
          <ol className="step-list">{STEPS.map((item, index) => <li className={`step-list-item ${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`} key={item.title} aria-current={index === step ? 'step' : undefined}><span className="step-list-number" aria-hidden="true">{index < step ? <Check size={13} /> : index + 1}</span><span>{item.short}</span></li>)}</ol>
        </aside>
        <form className="onboarding-card fade-in" key={step} onSubmit={next} noValidate aria-labelledby="onboarding-step-title">
          <div className="onboarding-card-heading"><div className="onboarding-step-icon" aria-hidden="true"><StepIcon size={22} /></div><div><p className="auth-kicker">Paso {step + 1} de {STEPS.length}</p><h2 id="onboarding-step-title">{currentStep.title}</h2><p>{currentStep.description}</p></div></div>
          {step === 0 && <div className="auth-field"><label className="auth-field-label" htmlFor="onboarding-name">Nombre del negocio</label><input id="onboarding-name" className="text-input onboarding-input" value={form.nombre} onChange={(event) => setValue('nombre', event.target.value)} maxLength={80} autoFocus autoComplete="organization" placeholder="Ej.: Barbería Central" aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'onboarding-error' : undefined} /></div>}
          {step === 1 && <div className="choice-grid" role="group" aria-label="Rubro">{(catalog.verticales || []).map((item) => <button type="button" className={`choice-card ${form.vertical === item.codigo ? 'selected' : ''}`} key={item.codigo} aria-pressed={form.vertical === item.codigo} onClick={() => setValue('vertical', item.codigo)}><span>{item.nombre}</span>{form.vertical === item.codigo && <CheckCircle2 size={17} aria-hidden="true" />}</button>)}</div>}
          {step === 2 && <div className="choice-grid" role="group" aria-label="País">{(catalog.paises || []).map((item) => <button type="button" className={`choice-card ${form.pais === item.codigo ? 'selected' : ''}`} key={item.codigo} aria-pressed={form.pais === item.codigo} onClick={() => setValue('pais', item.codigo)}><span>{item.nombre}</span>{form.pais === item.codigo && <CheckCircle2 size={17} aria-hidden="true" />}</button>)}</div>}
          {step === 3 && <div className="choice-grid" role="group" aria-label="Idioma">{(catalog.idiomas || []).map((item) => <button type="button" className={`choice-card ${form.idioma === item.codigo ? 'selected' : ''}`} key={item.codigo} aria-pressed={form.idioma === item.codigo} onClick={() => setValue('idioma', item.codigo)}><span>{item.nombre}</span>{form.idioma === item.codigo && <CheckCircle2 size={17} aria-hidden="true" />}</button>)}</div>}
          {step === 4 && <div className="auth-field"><label className="auth-field-label" htmlFor="onboarding-timezone">Zona horaria</label><select id="onboarding-timezone" className="text-input onboarding-input" value={form.zona_horaria} onChange={(event) => setValue('zona_horaria', event.target.value)} aria-describedby="onboarding-timezone-hint">{timezoneOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="auth-field-hint" id="onboarding-timezone-hint">Detectamos la zona de tu dispositivo: {detectedTimezone}.</span></div>}
          {step === 5 && <div className="choice-grid" role="group" aria-label="Moneda">{(catalog.monedas || []).map((item) => <button type="button" className={`choice-card ${form.moneda === item.codigo ? 'selected' : ''}`} key={item.codigo} aria-pressed={form.moneda === item.codigo} onClick={() => setValue('moneda', item.codigo)}><span><strong>{item.codigo}</strong> · {item.nombre}</span>{form.moneda === item.codigo && <CheckCircle2 size={17} aria-hidden="true" />}</button>)}</div>}
          {step === 6 && <div className="branding-fields"><div className="auth-field"><label className="auth-field-label" htmlFor="onboarding-logo"><ImagePlus size={13} aria-hidden="true" /> URL del logo <span className="auth-field-optional">(opcional)</span></label><input id="onboarding-logo" className="text-input onboarding-input" type="url" inputMode="url" value={form.logo_url} onChange={(event) => setValue('logo_url', event.target.value)} placeholder="https://…" autoCapitalize="none" spellCheck={false} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'onboarding-error' : undefined} /></div><div className="color-row"><label className="color-field"><span>Color principal</span><input type="color" value={form.color_principal || '#9B6A2F'} onChange={(event) => setValue('color_principal', event.target.value)} /></label><label className="color-field"><span>Color secundario</span><input type="color" value={form.color_secundario || '#EDE6D8'} onChange={(event) => setValue('color_secundario', event.target.value)} /></label></div></div>}
          {step === 7 && <div className="review-card"><div className="review-row"><span>Negocio</span><strong>{form.nombre || '—'}</strong></div><div className="review-row"><span>Rubro</span><strong>{selectedVertical?.nombre || form.vertical}</strong></div><div className="review-row"><span>Ubicación</span><strong>{nameFrom(catalog.paises, form.pais)}</strong></div><div className="review-row"><span>Idioma y moneda</span><strong>{nameFrom(catalog.idiomas, form.idioma)} · {form.moneda}</strong></div><div className="review-row"><span>Zona horaria</span><strong>{timezoneLabel}</strong></div><div className="trial-callout"><Sparkles size={17} aria-hidden="true" /><span><strong>Se activa una prueba gratuita de {COMMERCIAL_TRIAL_DAYS} días</strong><small>Incluye configuración inicial, agenda y reservas. No se crea información ficticia.</small></span></div></div>}
          {error && <p className="login-error onboarding-error auth-alert" id="onboarding-error" role="alert">{error}</p>}
          <div className="onboarding-actions">{step > 0 ? <button type="button" className="btn" onClick={back} disabled={loading}><ArrowLeft size={15} aria-hidden="true" /> Atrás</button> : <span />}{catalogLoading && step === 1 ? <span className="auth-field-hint" role="status">Cargando opciones…</span> : <button type="submit" className="btn btn-primary" disabled={loading} aria-busy={loading}>{loading ? <><LoaderCircle className="spin" size={15} aria-hidden="true" /> Activando…</> : isLastStep ? <>Crear mi negocio <ArrowRight size={15} aria-hidden="true" /></> : <>Continuar <ArrowRight size={15} aria-hidden="true" /></>}</button>}</div>
        </form>
      </main>
    </div>
  )
}
