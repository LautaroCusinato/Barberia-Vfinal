import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, MapPin, Moon, Scissors, Sun, UserRound } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import PhoneField from '../components/PhoneField'
import { Badge, Button, Card, EmptyState, FormField, IconButton, Input, LiveRegion, Skeleton, Spinner, StatusBadge } from '../components/ui'
import { PREFIJO_AR, soloDigitos } from '../lib/text'
import './PublicBooking.css'

const STEPS = [{ label: 'Servicio', short: 'Servicio' }, { label: 'Profesional', short: 'Profesional' }, { label: 'Fecha y hora', short: 'Fecha/hora' }, { label: 'Tus datos', short: 'Datos' }, { label: 'Confirmación', short: 'Confirmar' }]
const PHONE_HINT = 'Formato: +54 9 11 0000-0000. Completá los 8 dígitos locales.'
const PHONE_ERROR = 'Ingresá tu número completo: 8 dígitos después de +54 9 11. ' + PHONE_HINT
const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const formatTime = (time) => String(time || '').slice(0, 5)
const normalizeCurrency = (currency) => /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'ARS'
const formatMoney = (amount, currency) => `${normalizeCurrency(currency)} ${Number(amount || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
const formatDateLabel = (date) => date ? new Date(`${date}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Elegí una fecha'
const formatTimezone = (timezone) => timezone === 'America/Argentina/Buenos_Aires' ? 'Argentina · Buenos Aires' : timezone || 'zona horaria del negocio'
const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

const initialTheme = (slug) => {
  try {
    const saved = localStorage.getItem(`public-booking-theme:${slug}`)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* storage is optional */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const normalizeHex = (value, fallback = '#9b6a2f') => {
  const raw = String(value || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
  if (/^#[0-9a-f]{3}$/i.test(raw)) return '#' + raw.slice(1).split('').map((part) => part + part).join('')
  return fallback
}

const accentForeground = (hex) => {
  const value = normalizeHex(hex).slice(1)
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  const luminance = (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
  return (1.05 / (luminance + 0.05)) >= 4.5 ? '#fff' : '#201b17'
}

const safeRpcError = (rpcError) => {
  const message = String(rpcError?.message || '').toLowerCase()
  if (rpcError?.code === '23P01' || /ocup|disponible/.test(message)) return 'Ese horario acaba de ocuparse. Elegí otro horario.'
  if (/pasó|pasado/.test(message)) return 'Ese horario ya pasó. Elegí una nueva opción.'
  if (/bloqueado/.test(message)) return 'Ese horario está bloqueado. Elegí otro horario.'
  if (/servicio|profesional|trabaja/.test(message)) return 'La disponibilidad cambió. Revisá el servicio y el profesional.'
  return 'No pudimos confirmar la reserva. Revisá los datos e intentá nuevamente.'
}

function BookingProgress({ activeStep }) {
  return (
    <nav className="booking-progress" aria-label="Progreso de la reserva">
      <ol>
        {STEPS.map((label, index) => {
          const step = index + 1
          const state = step < activeStep ? 'complete' : step === activeStep ? 'current' : 'pending'
          return <li className={`booking-progress-step ${state}`} key={label.label} aria-current={state === 'current' ? 'step' : undefined}><span>{step}</span><small><span className="booking-progress-full">{label.label}</span><span className="booking-progress-short">{label.short}</span></small></li>
        })}
      </ol>
    </nav>
  )
}

function BookingSummary({ service, professional, date, time, currency }) {
  return (
    <Card as="aside" className="booking-summary" aria-labelledby="booking-summary-title">
      <div className="booking-summary-heading"><div><p className="booking-eyebrow">Tu reserva</p><h2 id="booking-summary-title">Resumen</h2></div><Badge variant={time ? 'success' : 'muted'}>{time ? 'Lista para confirmar' : 'En preparación'}</Badge></div>
      <dl className="booking-summary-list">
        <div><dt>Servicio</dt><dd>{service?.nombre || 'Elegí un servicio'}</dd></div>
        <div><dt>Profesional</dt><dd>{professional?.barbero_nombre || 'Elegí un profesional'}</dd></div>
        <div><dt>Fecha</dt><dd>{date ? formatDateLabel(date) : 'Elegí una fecha'}</dd></div>
        <div><dt>Hora</dt><dd>{time ? formatTime(time) : 'Elegí un horario'}</dd></div>
        <div><dt>Duración</dt><dd>{service && professional ? `${professional.duracion_min} min` : '—'}</dd></div>
        <div className="booking-summary-total"><dt>Total</dt><dd>{service ? formatMoney(service.precio, currency) : '—'}</dd></div>
      </dl>
      <p className="booking-summary-note"><Clock3 size={14} /> Horarios en la zona del negocio</p>
    </Card>
  )
}

function BookingSkeleton() {
  return <div className="booking-loading-card" aria-label="Cargando reservas" role="status"><div className="booking-skeleton-intro"><Skeleton width="92px" height={10} /><Skeleton width="72%" height={30} /><Skeleton width="88%" height={14} /></div>{[1, 2, 3].map((section) => <div className="booking-skeleton-section" key={section}><Skeleton width="120px" height={18} /><div className="booking-skeleton-grid"><Skeleton height={54} /><Skeleton height={54} /><Skeleton height={54} /></div></div>)}<span className="booking-loading-label"><Spinner size={16} /> Cargando disponibilidad…</span></div>
}

function BookingError({ message, onRetry }) {
  return <Card className="booking-state-card" role="alert"><EmptyState title="No pudimos abrir esta reserva" description={message || 'El negocio no está disponible en este momento.'} action={<Button variant="secondary" onClick={onRetry}>Intentar nuevamente</Button>} /></Card>
}

function BookingSuccess({ success, business, theme, accent, secondary, accentText, onThemeToggle }) {
  const service = success.servicio
  const professional = success.barbero
  return <main className="public-booking" data-theme={theme} style={{ '--booking-accent': accent, '--booking-secondary': secondary, '--booking-accent-foreground': accentText }}>
    <header className="booking-header"><div className="booking-brand">{business?.logo_url ? <img src={business.logo_url} alt="" /> : <Scissors size={24} />}<span>{business?.nombre || 'Reservas online'}</span></div><IconButton className="booking-theme-toggle" label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={onThemeToggle}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</IconButton></header>
    <Card as="section" className="booking-success" aria-labelledby="booking-success-title"><StatusBadge status="success" label="Reserva confirmada" /><CheckCircle2 className="booking-success-icon" size={52} aria-hidden="true" /><h1 id="booking-success-title">¡Turno reservado!</h1><p>Te esperamos en <strong>{business?.nombre}</strong>.</p><div className="booking-success-details"><div><span>Servicio</span><strong>{service?.nombre || 'Tu servicio'}</strong></div><div><span>Profesional</span><strong>{professional?.barbero_nombre || 'Tu profesional'}</strong></div><div><span>Fecha y hora</span><strong>{formatDateLabel(success.fecha)} · {formatTime(success.hora)}</strong></div><div><span>Duración</span><strong>{professional?.duracion_min || success.duracion_min} min</strong></div><div><span>Total</span><strong>{formatMoney(service?.precio, success.moneda)}</strong></div></div>{business?.direccion && <p className="booking-success-note"><MapPin size={16} /> {business.direccion}</p>}<p className="booking-success-timezone">Horario local: {formatTimezone(business?.zona_horaria)}.</p><Button variant="secondary" className="booking-button booking-button-secondary" onClick={() => window.location.reload()}>Reservar otro turno</Button></Card>
  </main>
}

export default function PublicBooking({ slug }) {
  const [catalogo, setCatalogo] = useState(null)
  const [servicio, setServicio] = useState(null)
  const [fecha, setFecha] = useState(dateKey)
  const [slots, setSlots] = useState([])
  const [barberoId, setBarberoId] = useState(null)
  const [hora, setHora] = useState(null)
  const [nombre, setNombre] = useState('')
  const [telefono, setTelefono] = useState(PREFIJO_AR)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [availabilityNotice, setAvailabilityNotice] = useState('')
  const [success, setSuccess] = useState(null)
  const [theme, setTheme] = useState(() => initialTheme(slug))
  const selectionRef = useRef({ barberoId: null, hora: null })
  const previousSlotsContextRef = useRef(null)

  useEffect(() => { selectionRef.current = { barberoId, hora } }, [barberoId, hora])
  useEffect(() => {
    try { localStorage.setItem(`public-booking-theme:${slug}`, theme) } catch { /* storage is optional */ }
  }, [slug, theme])

  const cargarCatalogo = useCallback(async () => {
    if (!isSupabaseConfigured) { setError('La página de reservas no está configurada.'); setLoading(false); return }
    const { data, error: rpcError } = await supabase.rpc('catalogo_reserva_publica', { p_slug: slug })
    if (rpcError || !data?.barberia) { setError('No encontramos esta barbería o negocio. Las reservas pueden estar temporalmente pausadas.'); setLoading(false); return }
    const nextCatalog = { ...data, servicios: Array.isArray(data.servicios) ? data.servicios : [] }
    setCatalogo(nextCatalog)
    setServicio((current) => current && nextCatalog.servicios.some((s) => s.id === current.id) ? current : nextCatalog.servicios[0] ?? null)
    setError('')
    setLoading(false)
  }, [slug])

  const cargarSlots = useCallback(async () => {
    if (!servicio || !fecha || !isSupabaseConfigured) return
    setLoadingSlots(true)
    const { data, error: rpcError } = await supabase.rpc('horarios_disponibles_reserva_publica', {
      p_slug: slug, p_servicio_id: servicio.id, p_fecha: fecha,
    })
    if (rpcError) {
      setError('No pudimos actualizar la disponibilidad. Intentá nuevamente.')
    } else {
      const nextSlots = data ?? []
      const previous = selectionRef.current
      const sameContext = previousSlotsContextRef.current?.serviceId === servicio.id && previousSlotsContextRef.current?.fecha === fecha
      const stillAvailable = nextSlots.some((slot) => slot.barbero_id === previous.barberoId && slot.hora === previous.hora)
      if (sameContext && previous.hora && !stillAvailable) setAvailabilityNotice('La disponibilidad se actualizó y el horario seleccionado dejó de estar disponible. Elegí otro horario.')
      setSlots(nextSlots)
      setBarberoId((id) => nextSlots.some((slot) => slot.barbero_id === id) ? id : (nextSlots[0]?.barbero_id ?? null))
      setHora((current) => nextSlots.some((slot) => slot.barbero_id === previous.barberoId && slot.hora === current) ? current : null)
      previousSlotsContextRef.current = { serviceId: servicio.id, fecha }
    }
    setLoadingSlots(false)
  }, [slug, servicio, fecha])

  useEffect(() => { cargarCatalogo() }, [cargarCatalogo])
  useEffect(() => { cargarSlots() }, [cargarSlots])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') { cargarCatalogo(); cargarSlots() } }
    window.addEventListener('focus', refresh)
    let timer = null
    const syncTimer = () => {
      if (timer) window.clearInterval(timer)
      timer = document.visibilityState === 'visible' ? window.setInterval(refresh, 30000) : null
    }
    document.addEventListener('visibilitychange', syncTimer)
    syncTimer()
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', syncTimer)
      if (timer) window.clearInterval(timer)
    }
  }, [cargarCatalogo, cargarSlots])

  const profesionales = useMemo(() => {
    const seen = new Map()
    slots.forEach((slot) => { if (!seen.has(slot.barbero_id)) seen.set(slot.barbero_id, slot) })
    return [...seen.values()]
  }, [slots])
  const horarios = useMemo(() => slots.filter((slot) => slot.barbero_id === barberoId), [slots, barberoId])
  const barbero = profesionales.find((professional) => professional.barbero_id === barberoId)
  const currency = normalizeCurrency(catalogo?.barberia?.moneda || servicio?.moneda)
  const accent = normalizeHex(catalogo?.barberia?.color_principal)
  const secondary = normalizeHex(catalogo?.barberia?.color_secundario, '#ede6d8')
  const accentText = accentForeground(accent)
  const phoneIsValid = soloDigitos(telefono).length === 13
  const activeStep = !servicio ? 1 : !barbero ? 2 : !hora ? 3 : !nombre.trim() || !phoneIsValid ? 4 : 5

  const seleccionarServicio = (nextService) => { setServicio(nextService); setBarberoId(null); setHora(null); setAvailabilityNotice(''); setFieldErrors({}); setError('') }
  const seleccionarFecha = (event) => { setFecha(event.target.value); setBarberoId(null); setHora(null); setAvailabilityNotice(''); setFieldErrors({}); setError('') }
  const seleccionarProfesional = (id) => { setBarberoId(id); setHora(null); setAvailabilityNotice(''); setError('') }
  const seleccionarHora = (nextHour) => { setHora(nextHour); setAvailabilityNotice(''); setFieldErrors({}); setError('') }

  const confirmar = async (event) => {
    event.preventDefault()
    if (!servicio || !barbero || !hora) { setError('Elegí un profesional y un horario para continuar.'); return }
    const nextErrors = {}
    if (!nombre.trim()) nextErrors.nombre = 'Ingresá tu nombre y apellido.'
    if (!phoneIsValid) nextErrors.telefono = PHONE_ERROR
    if (!isValidEmail(email)) nextErrors.email = 'Revisá el formato del email.'
    if (Object.keys(nextErrors).length) { setFieldErrors(nextErrors); setError('Revisá los datos marcados antes de confirmar.'); return }
    setFieldErrors({})
    setError('')
    setLoadingSlots(true)
    // Reconsultamos primero, para no confirmar una opción que cambió mientras el formulario estaba abierto.
    await cargarSlots()
    const { data, error: rpcError } = await supabase.rpc('crear_reserva_publica', {
      p_slug: slug, p_servicio_id: servicio.id, p_barbero_id: barbero.barbero_id,
      p_fecha: fecha, p_hora: hora, p_nombre: nombre, p_telefono: soloDigitos(telefono), p_email: email || null,
    })
    setLoadingSlots(false)
    if (rpcError) { setError(safeRpcError(rpcError)); await cargarSlots(); return }
    setSuccess({ ...(data?.[0] ?? { fecha, hora, duracion_min: barbero.duracion_min }), servicio, barbero, nombre: nombre.trim(), telefono: soloDigitos(telefono), moneda: currency })
  }

  const retry = () => { setError(''); setLoading(true); cargarCatalogo() }

  if (success) return <BookingSuccess success={success} business={catalogo?.barberia} theme={theme} accent={accent} secondary={secondary} accentText={accentText} onThemeToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
  if (loading) return <main className="public-booking" data-theme={theme} style={{ '--booking-accent': accent, '--booking-secondary': secondary, '--booking-accent-foreground': accentText }}><BookingSkeleton /></main>
  if (error && !catalogo) return <main className="public-booking" data-theme={theme} style={{ '--booking-accent': accent, '--booking-secondary': secondary, '--booking-accent-foreground': accentText }}><BookingError message={error} onRetry={retry} /></main>

  const business = catalogo.barberia
  return (
    <main className="public-booking" data-theme={theme} style={{ '--booking-accent': accent, '--booking-secondary': secondary, '--booking-accent-foreground': accentText }}>
      <header className="booking-header"><div className="booking-brand">{business.logo_url ? <img src={business.logo_url} alt="" /> : <Scissors size={24} />}<span>{business.nombre}</span></div><div className="booking-header-actions">{business.direccion && <span className="booking-address"><MapPin size={16} /> {business.direccion}</span>}<IconButton className="booking-theme-toggle" label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</IconButton></div></header>
      <div className="booking-layout">
        <BookingSummary service={servicio} professional={barbero} date={fecha} time={hora} currency={currency} />
        <Card as="section" className="booking-card booking-main-card" aria-labelledby="booking-title">
          <div className="booking-intro"><p className="booking-eyebrow">Reservas online</p><h1 id="booking-title">Elegí tu próximo turno</h1><p>Una reserva simple, con disponibilidad actualizada y sin sorpresas.</p></div>
          <BookingProgress activeStep={activeStep} />
          <LiveRegion className={`booking-live-region ${availabilityNotice ? 'has-message' : ''}`}>{availabilityNotice}</LiveRegion>
          {error && <LiveRegion assertive className="booking-error">{error}</LiveRegion>}

          <div className="booking-section" aria-labelledby="booking-service-title"><div className="booking-section-heading"><div><p className="booking-step-label">Paso 1</p><h2 id="booking-service-title"><Scissors size={18} /> Servicio</h2></div><span className="booking-section-meta">{catalogo.servicios.length} disponibles</span></div>{catalogo.servicios.length === 0 ? <EmptyState title="No hay servicios disponibles" description="Este negocio todavía no publicó servicios para reservar." action={<Button variant="secondary" onClick={retry}>Actualizar</Button>} /> : <div className="service-list">{catalogo.servicios.map((service) => <button type="button" key={service.id} className={servicio?.id === service.id ? 'selected' : ''} aria-pressed={servicio?.id === service.id} onClick={() => seleccionarServicio(service)}><span className="booking-option-check" aria-hidden="true">{servicio?.id === service.id ? '✓' : ''}</span><span className="booking-option-content"><strong>{service.nombre}</strong>{service.descripcion && <small>{service.descripcion}</small>}<span>{service.duracion_min} min · {formatMoney(service.precio, currency)}</span></span></button>)}</div>}</div>

          <div className="booking-section" aria-labelledby="booking-date-title"><div className="booking-section-heading"><div><p className="booking-step-label">Paso 2</p><h2 id="booking-date-title"><CalendarDays size={18} /> Fecha y hora</h2></div><span className="booking-section-meta">Hora local</span></div><FormField label="Fecha elegida" hint={`Disponible desde hoy · ${formatTimezone(business.zona_horaria)}.`} id="booking-date"><Input className="booking-date" type="date" min={dateKey()} value={fecha} onChange={seleccionarFecha} /></FormField><div className="booking-subsection"><div className="booking-subsection-heading"><h3><UserRound size={17} /> Profesional</h3><span>{profesionales.length ? `${profesionales.length} disponibles` : 'Sin disponibilidad'}</span></div>{loadingSlots ? <div className="booking-inline-loading" role="status"><Spinner size={16} /> Actualizando disponibilidad…</div> : profesionales.length === 0 ? <EmptyState title="No hay profesionales disponibles" description="Probá con otra fecha o servicio para ver nuevas opciones." /> : <div className="professional-list">{profesionales.map((professional) => <button type="button" key={professional.barbero_id} className={barberoId === professional.barbero_id ? 'selected' : ''} aria-pressed={barberoId === professional.barbero_id} onClick={() => seleccionarProfesional(professional.barbero_id)}><span className="booking-avatar" style={{ '--avatar-color': normalizeHex(professional.barbero_color, accent) }}>{initials(professional.barbero_nombre)}</span><span><strong>{professional.barbero_nombre}</strong><small>Disponible para {servicio?.nombre || 'este servicio'}</small></span><span className="booking-option-check" aria-hidden="true">{barberoId === professional.barbero_id ? '✓' : ''}</span></button>)}</div>}</div><div className="booking-subsection"><div className="booking-subsection-heading"><h3><Clock3 size={17} /> Horario</h3><span>{barbero ? `${horarios.length} opciones` : 'Elegí un profesional'}</span></div>{loadingSlots ? <div className="time-skeleton-grid">{[1, 2, 3, 4, 5, 6].map((item) => <Skeleton height={50} key={item} />)}</div> : !barbero ? <p className="booking-muted">Seleccioná un profesional para ver sus horarios.</p> : horarios.length === 0 ? <EmptyState title="No quedan horarios libres" description="Elegí otra fecha o profesional para continuar." /> : <div className="time-list">{horarios.map((slot) => <button type="button" key={slot.hora} className={hora === slot.hora ? 'selected' : ''} aria-pressed={hora === slot.hora} onClick={() => seleccionarHora(slot.hora)}>{formatTime(slot.hora)}</button>)}</div>}</div></div>

          <form className="booking-section booking-form" onSubmit={confirmar} noValidate aria-labelledby="booking-data-title"><div className="booking-section-heading"><div><p className="booking-step-label">Paso 3</p><h2 id="booking-data-title">Tus datos</h2></div><span className="booking-section-meta">Sólo para confirmar</span></div><div className="booking-form-grid"><FormField label="Nombre y apellido" required error={fieldErrors.nombre} id="booking-name"><Input value={nombre} onChange={(event) => { setNombre(event.target.value); setFieldErrors((current) => ({ ...current, nombre: '' })) }} placeholder="Ej. Lautaro Cusinato" autoComplete="name" enterKeyHint="next" /></FormField><FormField label="Teléfono" required hint={PHONE_HINT} error={fieldErrors.telefono} id="booking-phone"><PhoneField data-booking-phone value={telefono} onChange={(value) => { setTelefono(value); setFieldErrors((current) => ({ ...current, telefono: '' })) }} className="booking-phone-field" aria-label="Teléfono" enterKeyHint="next" /></FormField><FormField label="Email (opcional)" hint="Te lo pedimos sólo si querés recibir el detalle." error={fieldErrors.email} id="booking-email"><Input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: '' })) }} placeholder="tu@email.com" autoComplete="email" /></FormField></div><div className="booking-final-summary"><div><p className="booking-step-label">Paso 4 · Confirmación</p><h3>Revisá tu reserva</h3></div><dl><div><dt>Negocio</dt><dd>{business.nombre}</dd></div><div><dt>Servicio</dt><dd>{servicio?.nombre || 'Pendiente'}</dd></div><div><dt>Profesional</dt><dd>{barbero?.barbero_nombre || 'Pendiente'}</dd></div><div><dt>Fecha y hora</dt><dd>{fecha ? `${formatDateLabel(fecha)} · ${formatTime(hora) || 'Pendiente'}` : 'Pendiente'}</dd></div><div><dt>Duración y total</dt><dd>{barbero && servicio ? `${barbero.duracion_min} min · ${formatMoney(servicio.precio, currency)}` : 'Pendiente'}</dd></div><div><dt>Cliente</dt><dd>{nombre.trim() || 'Pendiente'}{phoneIsValid ? ` · ${telefono}` : ''}</dd></div></dl></div><Button type="submit" variant="primary" size="lg" className="booking-button" disabled={!hora || loadingSlots} loading={loadingSlots}>{loadingSlots ? 'Validando disponibilidad' : 'Confirmar reserva'}</Button><p className="booking-form-note">Al confirmar, verificamos nuevamente que el horario siga libre.</p></form>
        </Card>
      </div>
    </main>
  )
}
