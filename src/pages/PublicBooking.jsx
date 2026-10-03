import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CalendarPlus, CheckCircle2, Clock3, MapPin, MessageCircle, Moon, Scissors, Sun, UserRound } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import PhoneField from '../components/PhoneField'
import { Badge, Button, Card, EmptyState, FormField, IconButton, Input, LiveRegion, Skeleton, Spinner } from '../components/ui'
import { PREFIJO_AR, capitalizar, soloDigitos, telefonoNacionalValido } from '../lib/text'
import { buildWhatsAppHref } from '../lib/commercialCatalog'
import './PublicBooking.css'

// Los pasos del indicador coinciden 1:1 con las secciones numeradas de la página.
const STEPS = [{ label: 'Servicio', short: 'Serv.' }, { label: 'Profesional', short: 'Prof.' }, { label: 'Horario', short: 'Hora' }, { label: 'Tus datos', short: 'Datos' }, { label: 'Confirmación', short: 'Listo' }]
const PHONE_HINT = 'Código de área sin 0 y número sin 15. Ej.: 11 5555-1234 o 351 555-1234.'
const PHONE_ERROR = 'Ingresá tu número completo: 10 dígitos después de +54 9.'
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'
const dateKey = (timezone = DEFAULT_TIMEZONE) => {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || DEFAULT_TIMEZONE }).format(new Date()) } catch { return new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(new Date()) }
}
const addDays = (key, days) => {
  const [year, month, day] = String(key).split('-').map(Number)
  if (!year || !month || !day) return ''
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}
const formatTime = (time) => String(time || '').slice(0, 5)
const normalizeCurrency = (currency) => /^[A-Z]{3}$/.test(String(currency || '').toUpperCase()) ? String(currency).toUpperCase() : 'ARS'
const formatMoney = (amount, currency) => `${normalizeCurrency(currency)} ${Number(amount || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`
const formatDateLabel = (date) => date ? capitalizar(new Date(`${date}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })) : 'Elegí una fecha'
const formatTimezone = (timezone) => timezone === 'America/Argentina/Buenos_Aires' ? 'Argentina · Buenos Aires' : timezone || 'zona horaria del negocio'
const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

// Enlace "Agregar a Google Calendar" en la zona horaria del negocio (ctz),
// sin conversiones manuales de huso.
const calendarHref = ({ fecha, hora, duracion, titulo, lugar, timezone }) => {
  if (!fecha || !hora) return ''
  const [h, m] = formatTime(hora).split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return ''
  const start = new Date(Date.UTC(2000, 0, 1, h, m))
  const end = new Date(start.getTime() + (Number(duracion) || 30) * 60000)
  const dayOffset = end.getUTCDate() - start.getUTCDate()
  const stamp = (key, date) => `${key.replaceAll('-', '')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}00`
  const params = new URLSearchParams({ action: 'TEMPLATE', text: titulo, dates: `${stamp(fecha, start)}/${stamp(addDays(fecha, dayOffset), end)}`, ctz: timezone || DEFAULT_TIMEZONE })
  if (lugar) params.set('location', lugar)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

// El WhatsApp del negocio puede estar guardado sin código de país (11 5555-1234).
const whatsappNumber = (value) => {
  const digits = soloDigitos(String(value || ''))
  if (digits.startsWith('54') && digits.length >= 12) return digits
  if (digits.length === 10) return `549${digits}`
  return digits.length >= 11 ? digits : ''
}

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

const luminanceOf = (hex) => {
  const value = normalizeHex(hex).slice(1)
  const channels = [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2])
}
const contrastRatio = (a, b) => {
  const [light, dark] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

const accentForeground = (hex) => (1.05 / (luminanceOf(hex) + 0.05)) >= 4.5 ? '#fff' : '#201b17'

// El color de marca se usa también como color de texto (etiquetas "Paso N",
// íconos). Con marcas claras (amarillo, celeste) el texto quedaba ilegible:
// lo mezclamos hacia la tinta del tema hasta llegar a 4.5:1 sobre la tarjeta.
const mixHex = (from, to, amount) => {
  const a = normalizeHex(from).slice(1)
  const b = normalizeHex(to).slice(1)
  return '#' + [0, 2, 4].map((index) => {
    const channel = Math.round(parseInt(a.slice(index, index + 2), 16) * (1 - amount) + parseInt(b.slice(index, index + 2), 16) * amount)
    return channel.toString(16).padStart(2, '0')
  }).join('')
}
const accentTextFor = (hex, theme) => {
  const surface = theme === 'dark' ? '#24201d' : '#ffffff'
  const ink = theme === 'dark' ? '#f4ede5' : '#251f19'
  for (let amount = 0; amount <= 1; amount += 0.1) {
    const candidate = mixHex(hex, ink, amount)
    if (contrastRatio(candidate, surface) >= 4.5) return candidate
  }
  return ink
}

// Mensajes que la RPC crear_reserva_publica emite para el cliente final: son
// seguros para mostrarse tal cual. Se comparan por prefijo (sin distinguir
// mayúsculas) y, si el error corresponde a un campo, se marca ese campo.
const KNOWN_BOOKING_ERRORS = [
  { prefix: 'ya tenés varias reservas activas con este teléfono', field: 'telefono' },
  { prefix: 'este negocio no acepta reservas online' },
  { prefix: 'ese horario no está disponible' },
  { prefix: 'ese horario ya pasó' },
  { prefix: 'ese horario fue bloqueado' },
  { prefix: 'ese horario acaba de ocuparse' },
  { prefix: 'el email no es válido', field: 'email' },
  { prefix: 'el nombre es demasiado largo', field: 'nombre' },
  { prefix: 'ingresá tu nombre y teléfono' },
  { prefix: 'el teléfono debe ser un celular argentino', field: 'telefono' },
]

const knownBookingError = (rpcError) => {
  const raw = String(rpcError?.message || '').replace(/^.*?ERROR:\s*/i, '').replace(/\s*DETAIL:.*$/is, '').trim()
  const match = KNOWN_BOOKING_ERRORS.find(({ prefix }) => raw.toLocaleLowerCase('es-AR').startsWith(prefix))
  return match ? { message: raw, field: match.field || '' } : null
}

const safeRpcError = (rpcError) => {
  const known = knownBookingError(rpcError)
  if (known) return known.message
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
          return <li className={`booking-progress-step ${state}`} key={label.label} aria-current={state === 'current' ? 'step' : undefined}><span aria-hidden="true">{state === 'complete' ? '✓' : step}</span><small><span className="booking-progress-full">{label.label}</span><span className="booking-progress-short" aria-hidden="true">{label.short}</span></small></li>
        })}
      </ol>
    </nav>
  )
}

function SummaryValue({ value, placeholder }) {
  return value ? <dd>{value}</dd> : <dd className="is-pending">{placeholder}</dd>
}

function BookingSummary({ service, professional, date, time, currency }) {
  return (
    <Card as="aside" className="booking-summary" aria-labelledby="booking-summary-title">
      <div className="booking-summary-heading"><div><p className="booking-eyebrow">Tu reserva</p><h2 id="booking-summary-title">Resumen</h2></div><Badge variant={time ? 'success' : 'muted'}>{time ? 'Lista para confirmar' : 'Pendiente'}</Badge></div>
      <dl className="booking-summary-list">
        <div><dt>Servicio</dt><SummaryValue value={service?.nombre} placeholder="Elegí un servicio" /></div>
        <div><dt>Profesional</dt><SummaryValue value={professional?.barbero_nombre} placeholder="Elegí un profesional" /></div>
        <div><dt>Fecha</dt><SummaryValue value={date ? formatDateLabel(date) : ''} placeholder="Elegí una fecha" /></div>
        <div><dt>Hora</dt><SummaryValue value={time ? formatTime(time) : ''} placeholder="Elegí un horario" /></div>
        <div><dt>Duración</dt><SummaryValue value={service && professional ? `${professional.duracion_min} min` : ''} placeholder="—" /></div>
        <div className="booking-summary-total"><dt>Total</dt><SummaryValue value={service ? formatMoney(service.precio, currency) : ''} placeholder="—" /></div>
      </dl>
      <p className="booking-summary-note"><Clock3 size={14} aria-hidden="true" /> Horarios en la zona del negocio</p>
    </Card>
  )
}

function BookingFooter() {
  return <footer className="booking-footer"><span>Reservas online con</span> <a href="/" target="_blank" rel="noreferrer">Austral</a></footer>
}

function BookingSkeleton() {
  return <div className="booking-loading-card" aria-label="Cargando reservas" role="status"><div className="booking-skeleton-intro"><Skeleton width="92px" height={10} /><Skeleton width="72%" height={30} /><Skeleton width="88%" height={14} /></div>{[1, 2, 3].map((section) => <div className="booking-skeleton-section" key={section}><Skeleton width="120px" height={18} /><div className="booking-skeleton-grid"><Skeleton height={54} /><Skeleton height={54} /><Skeleton height={54} /></div></div>)}<span className="booking-loading-label"><Spinner size={16} /> Cargando disponibilidad…</span></div>
}

function BookingError({ message, onRetry }) {
  return <Card className="booking-state-card" role="alert"><EmptyState icon={<CalendarDays size={28} aria-hidden="true" />} title="No pudimos abrir esta reserva" description={message || 'El negocio no está disponible en este momento.'} action={<Button variant="secondary" onClick={onRetry}>Intentar nuevamente</Button>} /></Card>
}

function BookingSuccess({ success, business, theme, brandStyle, onThemeToggle }) {
  const service = success.servicio
  const professional = success.barbero
  const duration = professional?.duracion_min || success.duracion_min
  const firstName = String(success.nombre || '').split(/\s+/)[0]
  const addToCalendar = calendarHref({ fecha: success.fecha, hora: success.hora, duracion: duration, titulo: `${service?.nombre || 'Turno'} · ${business?.nombre || 'Reserva'}`, lugar: business?.direccion, timezone: business?.zona_horaria })
  const contactHref = buildWhatsAppHref(whatsappNumber(business?.whatsapp), `Hola! Tengo un turno el ${formatDateLabel(success.fecha)} a las ${formatTime(success.hora)} (${service?.nombre || 'turno'}) y quería hacer una consulta.`)
  return <main className="public-booking" data-theme={theme} style={brandStyle}>
    <header className="booking-header"><div className="booking-brand">{business?.logo_url ? <img src={business.logo_url} alt="" /> : <Scissors size={24} aria-hidden="true" />}<span>{business?.nombre || 'Reservas online'}</span></div><IconButton className="booking-theme-toggle" label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={onThemeToggle}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</IconButton></header>
    <Card as="section" className="booking-success" aria-labelledby="booking-success-title">
      <CheckCircle2 className="booking-success-icon" size={52} aria-hidden="true" />
      <h1 id="booking-success-title">¡Turno reservado!</h1>
      <p>{firstName ? `${firstName}, te esperamos` : 'Te esperamos'} en <strong>{business?.nombre}</strong>.</p>
      <div className="booking-success-when"><CalendarDays size={20} aria-hidden="true" /><div><span>Fecha y hora</span><strong>{formatDateLabel(success.fecha)} · {formatTime(success.hora)}</strong></div></div>
      <div className="booking-success-details"><div><span>Servicio</span><strong>{service?.nombre || 'Tu servicio'}</strong></div><div><span>Profesional</span><strong>{professional?.barbero_nombre || 'Tu profesional'}</strong></div><div><span>Duración</span><strong>{duration} min</strong></div><div><span>Total</span><strong>{formatMoney(service?.precio, success.moneda)}</strong></div></div>
      {business?.direccion && <p className="booking-success-note"><MapPin size={16} aria-hidden="true" /> {business.direccion}</p>}
      <p className="booking-success-timezone">Horario local: {formatTimezone(business?.zona_horaria)}.</p>
      <div className="booking-success-actions">
        {addToCalendar && <a className="booking-button booking-link-button" href={addToCalendar} target="_blank" rel="noreferrer"><CalendarPlus size={18} aria-hidden="true" /> Agregar al calendario</a>}
        {contactHref && <a className="booking-button booking-button-secondary booking-link-button" href={contactHref} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> Escribir al negocio</a>}
        <Button variant="secondary" className="booking-button booking-button-secondary" onClick={() => window.location.reload()}>Reservar otro turno</Button>
      </div>
      {contactHref && <p className="booking-success-help">¿Necesitás cambiar o cancelar el turno? Escribinos por WhatsApp.</p>}
    </Card>
    <BookingFooter />
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
  const [submitError, setSubmitError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [availabilityNotice, setAvailabilityNotice] = useState('')
  const [success, setSuccess] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [theme, setTheme] = useState(() => initialTheme(slug))
  const selectionRef = useRef({ barberoId: null, hora: null })
  const previousSlotsContextRef = useRef(null)
  const slotsRequestRef = useRef(0)

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
    if (!servicio || !fecha || !isSupabaseConfigured) return null
    const requestId = ++slotsRequestRef.current
    setLoadingSlots(true)
    const { data, error: rpcError } = await supabase.rpc('horarios_disponibles_reserva_publica', {
      p_slug: slug, p_servicio_id: servicio.id, p_fecha: fecha,
    })
    // A service/date change can leave an older RPC in flight. Only the latest
    // response may update the visible availability; stale responses must not
    // replace valid slots with an empty result.
    if (requestId !== slotsRequestRef.current) return null
    let nextSlots = null
    if (rpcError) {
      setError('No pudimos actualizar la disponibilidad. Intentá nuevamente.')
    } else {
      nextSlots = data ?? []
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
    return nextSlots
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
  const brandStyle = { '--booking-accent': accent, '--booking-secondary': secondary, '--booking-accent-foreground': accentText, '--booking-accent-text': accentTextFor(accent, theme) }
  const phoneIsValid = telefonoNacionalValido(telefono)
  const activeStep = !servicio ? 1 : !barbero ? 2 : !hora ? 3 : !nombre.trim() || !phoneIsValid ? 4 : 5

  const clearFeedback = () => { setAvailabilityNotice(''); setError(''); setSubmitError('') }
  const seleccionarServicio = (nextService) => { setServicio(nextService); setBarberoId(null); setHora(null); setFieldErrors({}); clearFeedback() }
  const seleccionarFecha = (event) => { setFecha(event.target.value); setBarberoId(null); setHora(null); setFieldErrors({}); clearFeedback() }
  const seleccionarProfesional = (id) => { setBarberoId(id); setHora(null); clearFeedback() }
  const seleccionarHora = (nextHour) => { setHora(nextHour); setFieldErrors({}); clearFeedback() }

  const confirmar = async (event) => {
    event.preventDefault()
    if (submitting) return
    if (!servicio || !barbero || !hora) { setSubmitError('Elegí un profesional y un horario para continuar.'); return }
    const nextErrors = {}
    if (!nombre.trim()) nextErrors.nombre = 'Ingresá tu nombre y apellido.'
    if (!phoneIsValid) nextErrors.telefono = PHONE_ERROR
    if (!isValidEmail(email.trim())) nextErrors.email = 'Revisá el formato del email.'
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors)
      setSubmitError('Revisá los datos marcados antes de confirmar.')
      // Llevamos el foco al primer campo con error: en el celular el mensaje
      // general queda lejos del campo que hay que corregir.
      const firstInvalid = ['nombre', 'telefono', 'email'].find((key) => nextErrors[key])
      document.getElementById({ nombre: 'booking-name', telefono: 'booking-phone', email: 'booking-email' }[firstInvalid])?.focus()
      return
    }
    setFieldErrors({})
    setSubmitError('')
    // Estado propio del envío: cargarSlots apaga loadingSlots al terminar y
    // antes eso re-habilitaba el botón mientras se creaba la reserva.
    setSubmitting(true)
    try {
      // Reconsultamos primero, para no confirmar una opción que cambió mientras el formulario estaba abierto.
      const disponibles = await cargarSlots()
      if (disponibles && !disponibles.some((slot) => slot.barbero_id === barbero.barbero_id && slot.hora === hora)) {
        setSubmitError('Ese horario acaba de ocuparse. Elegí otro horario.')
        return
      }
      const { data, error: rpcError } = await supabase.rpc('crear_reserva_publica', {
        p_slug: slug, p_servicio_id: servicio.id, p_barbero_id: barbero.barbero_id,
        p_fecha: fecha, p_hora: hora, p_nombre: nombre.trim(), p_telefono: soloDigitos(telefono), p_email: email.trim() || null,
      })
      if (rpcError) {
        const known = knownBookingError(rpcError)
        if (known?.field) setFieldErrors((current) => ({ ...current, [known.field]: known.message }))
        setSubmitError(safeRpcError(rpcError))
        await cargarSlots()
        return
      }
      setSuccess({ ...(data?.[0] ?? { fecha, hora, duracion_min: barbero.duracion_min }), servicio, barbero, nombre: nombre.trim(), telefono: soloDigitos(telefono), moneda: currency })
      window.scrollTo({ top: 0 })
    } finally {
      setSubmitting(false)
    }
  }

  const retry = () => { setError(''); setLoading(true); cargarCatalogo() }

  if (success) return <BookingSuccess success={success} business={catalogo?.barberia} theme={theme} brandStyle={brandStyle} onThemeToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
  if (loading) return <main className="public-booking" data-theme={theme} style={brandStyle}><BookingSkeleton /></main>
  if (error && !catalogo) return <main className="public-booking" data-theme={theme} style={brandStyle}><BookingError message={error} onRetry={retry} /><BookingFooter /></main>

  const business = catalogo.barberia
  const minDate = dateKey(business.zona_horaria)
  const maxDays = Number(business.max_dias_reserva)
  const maxDate = Number.isInteger(maxDays) && maxDays > 0 ? addDays(minDate, maxDays) : ''
  // Sólo acotamos el máximo: el servidor ya descarta fechas pasadas y el selector usa min.
  const outOfRange = Boolean(fecha && maxDate && fecha > maxDate)
  const dateHint = maxDate ? `Podés reservar hasta ${maxDays} días por adelantado · ${formatTimezone(business.zona_horaria)}.` : `Disponible desde hoy · ${formatTimezone(business.zona_horaria)}.`
  const submitLabel = submitting ? 'Confirmando reserva…' : loadingSlots ? 'Validando disponibilidad…' : 'Confirmar reserva'

  return (
    <main className="public-booking" data-theme={theme} style={brandStyle}>
      <header className="booking-header"><div className="booking-brand">{business.logo_url ? <img src={business.logo_url} alt="" /> : <Scissors size={24} aria-hidden="true" />}<span>{business.nombre}</span></div><div className="booking-header-actions">{business.direccion && <span className="booking-address"><MapPin size={16} aria-hidden="true" /> {business.direccion}</span>}<IconButton className="booking-theme-toggle" label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</IconButton></div></header>
      <div className="booking-layout">
        <BookingSummary service={servicio} professional={barbero} date={fecha} time={hora} currency={currency} />
        <Card as="section" className="booking-card booking-main-card" aria-labelledby="booking-title">
          <div className="booking-intro"><p className="booking-eyebrow">Reservas online</p><h1 id="booking-title">Elegí tu próximo turno</h1><p>Elegí servicio, profesional y horario. La disponibilidad se actualiza en tiempo real.</p>{business.direccion && <p className="booking-intro-address"><MapPin size={15} aria-hidden="true" /> {business.direccion}</p>}</div>
          <BookingProgress activeStep={activeStep} />
          <LiveRegion className={`booking-live-region ${availabilityNotice ? 'has-message' : ''}`}>{availabilityNotice}</LiveRegion>
          {error && <LiveRegion assertive className="booking-error">{error}</LiveRegion>}

          <div className="booking-section" aria-labelledby="booking-service-title">
            <div className="booking-section-heading"><div><p className="booking-step-label">Paso 1</p><h2 id="booking-service-title"><Scissors size={18} aria-hidden="true" /> Servicio</h2></div><span className="booking-section-meta">{catalogo.servicios.length === 1 ? '1 disponible' : `${catalogo.servicios.length} disponibles`}</span></div>
            {catalogo.servicios.length === 0 ? <EmptyState title="No hay servicios disponibles" description="Este negocio todavía no publicó servicios para reservar." action={<Button variant="secondary" onClick={retry}>Actualizar</Button>} /> : <div className="service-list">{catalogo.servicios.map((service) => <button type="button" key={service.id} className={servicio?.id === service.id ? 'selected' : ''} aria-pressed={servicio?.id === service.id} onClick={() => seleccionarServicio(service)}><span className="booking-option-check" aria-hidden="true">{servicio?.id === service.id ? '✓' : ''}</span><span className="booking-option-content"><strong>{service.nombre}</strong>{service.descripcion && <small>{service.descripcion}</small>}<span>{service.duracion_min} min · {formatMoney(service.precio, currency)}</span></span></button>)}</div>}
          </div>

          <div className="booking-section" aria-labelledby="booking-professional-title">
            <div className="booking-section-heading"><div><p className="booking-step-label">Paso 2</p><h2 id="booking-professional-title"><UserRound size={18} aria-hidden="true" /> Fecha y profesional</h2></div><span className="booking-section-meta">{loadingSlots ? 'Actualizando…' : profesionales.length ? `${profesionales.length} ${profesionales.length === 1 ? 'disponible' : 'disponibles'}` : 'Sin disponibilidad'}</span></div>
            <FormField label="Fecha" hint={dateHint} id="booking-date"><Input className="booking-date" type="date" min={minDate} max={maxDate || undefined} value={fecha} onChange={seleccionarFecha} aria-label="Fecha elegida" /></FormField>
            <div className="booking-subsection">
              {loadingSlots ? <div className="booking-inline-loading" role="status"><Spinner size={16} /> Actualizando disponibilidad…</div>
                : outOfRange ? <EmptyState title="Elegí otra fecha" description={maxDate ? `Este negocio toma reservas desde hoy y hasta ${maxDays} días por adelantado.` : 'Este negocio toma reservas desde hoy.'} />
                  : profesionales.length === 0 ? <EmptyState title="No hay profesionales disponibles" description="Probá con otra fecha o servicio para ver nuevas opciones." />
                    : <div className="professional-list">{profesionales.map((professional) => <button type="button" key={professional.barbero_id} className={barberoId === professional.barbero_id ? 'selected' : ''} aria-pressed={barberoId === professional.barbero_id} onClick={() => seleccionarProfesional(professional.barbero_id)}><span className="booking-avatar" style={{ '--avatar-color': normalizeHex(professional.barbero_color, accent) }} aria-hidden="true">{initials(professional.barbero_nombre)}</span><span><strong>{professional.barbero_nombre}</strong><small>Disponible para {servicio?.nombre || 'este servicio'}</small></span><span className="booking-option-check" aria-hidden="true">{barberoId === professional.barbero_id ? '✓' : ''}</span></button>)}</div>}
            </div>
          </div>

          <div className="booking-section" aria-labelledby="booking-time-title">
            <div className="booking-section-heading"><div><p className="booking-step-label">Paso 3</p><h2 id="booking-time-title"><Clock3 size={18} aria-hidden="true" /> Horario</h2></div><span className="booking-section-meta">{barbero && !loadingSlots ? `${horarios.length} ${horarios.length === 1 ? 'opción' : 'opciones'} · ${formatDateLabel(fecha)}` : 'Hora local'}</span></div>
            <div className="booking-subsection booking-subsection--flush">
              {loadingSlots ? <div className="time-skeleton-grid">{[1, 2, 3, 4, 5, 6].map((item) => <Skeleton height={50} key={item} />)}</div> : !barbero ? <p className="booking-muted">Elegí un profesional para ver sus horarios.</p> : horarios.length === 0 ? <EmptyState title="No quedan horarios libres" description="Elegí otra fecha o profesional para continuar." /> : <div className="time-list">{horarios.map((slot) => <button type="button" key={slot.hora} className={hora === slot.hora ? 'selected' : ''} aria-pressed={hora === slot.hora} onClick={() => seleccionarHora(slot.hora)}>{formatTime(slot.hora)}</button>)}</div>}
            </div>
          </div>

          <form className="booking-section booking-form" onSubmit={confirmar} noValidate aria-labelledby="booking-data-title">
            <div className="booking-section-heading"><div><p className="booking-step-label">Paso 4</p><h2 id="booking-data-title">Tus datos</h2></div><span className="booking-section-meta">Sólo para confirmar el turno</span></div>
            <div className="booking-form-grid">
              <FormField label="Nombre y apellido" required error={fieldErrors.nombre} id="booking-name"><Input value={nombre} onChange={(event) => { setNombre(event.target.value); setFieldErrors((current) => ({ ...current, nombre: '' })) }} placeholder="Ej.: Juan Pérez" autoComplete="name" autoCapitalize="words" maxLength={80} enterKeyHint="next" /></FormField>
              <FormField label="Teléfono" required hint={PHONE_HINT} error={fieldErrors.telefono} id="booking-phone"><PhoneField data-booking-phone value={telefono} onChange={(value) => { setTelefono(value); setFieldErrors((current) => ({ ...current, telefono: '' })) }} className="booking-phone-field" aria-label="Teléfono" enterKeyHint="next" /></FormField>
              <FormField label="Email (opcional)" hint="Sólo si querés recibir el detalle por correo." error={fieldErrors.email} id="booking-email"><Input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: '' })) }} placeholder="tu@email.com" autoComplete="email" inputMode="email" maxLength={120} enterKeyHint="done" /></FormField>
            </div>
            <div className="booking-final-summary">
              <div><p className="booking-step-label">Paso 5 · Confirmación</p><h3>Revisá tu reserva</h3></div>
              <dl>
                <div><dt>Negocio</dt><dd>{business.nombre}</dd></div>
                <div><dt>Servicio</dt><SummaryValue value={servicio?.nombre} placeholder="Pendiente" /></div>
                <div><dt>Profesional</dt><SummaryValue value={barbero?.barbero_nombre} placeholder="Pendiente" /></div>
                <div><dt>Fecha y hora</dt><SummaryValue value={fecha && hora ? `${formatDateLabel(fecha)} · ${formatTime(hora)}` : ''} placeholder="Elegí un horario" /></div>
                <div><dt>Duración y total</dt><SummaryValue value={barbero && servicio ? `${barbero.duracion_min} min · ${formatMoney(servicio.precio, currency)}` : ''} placeholder="Pendiente" /></div>
                <div><dt>Cliente</dt><SummaryValue value={nombre.trim() ? <>{nombre.trim()}{phoneIsValid && <> · <span className="booking-nowrap">{telefono}</span></>}</> : ''} placeholder="Completá tus datos" /></div>
              </dl>
            </div>
            {submitError && <LiveRegion assertive className="booking-error booking-submit-error">{submitError}</LiveRegion>}
            <Button type="submit" variant="primary" size="lg" className="booking-button" disabled={!hora || loadingSlots || submitting} loading={loadingSlots || submitting}>{submitLabel}</Button>
            <p className="booking-form-note">{hora ? 'Al confirmar, verificamos nuevamente que el horario siga libre.' : 'Elegí un profesional y un horario para continuar.'}</p>
          </form>
        </Card>
      </div>
      <BookingFooter />
    </main>
  )
}
