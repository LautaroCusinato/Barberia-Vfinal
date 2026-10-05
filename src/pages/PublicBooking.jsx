import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, CalendarPlus, Check, CheckCircle2, Clock3, MapPin, MessageCircle, Moon, RefreshCw, Sun } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import PhoneField from '../components/PhoneField'
import { Button, Card, EmptyState, FormField, IconButton, Input, LiveRegion, Skeleton, Spinner } from '../components/ui'
import { PREFIJO_AR, capitalizar, soloDigitos, telefonoNacionalValido, formatPrecio } from '../lib/text'
import { buildWhatsAppHref } from '../lib/commercialCatalog'
import './PublicBooking.css'

// La reserva se recorre en tres pasos. El indicador refleja el paso visible:
// los pasos completos se pueden volver a abrir sin perder lo elegido.
const STEPS = [{ label: 'Servicio', short: 'Servicio' }, { label: 'Fecha y hora', short: 'Horario' }, { label: 'Tus datos', short: 'Datos' }]
const STEP_TITLES = ['Elegí un servicio', 'Elegí día y horario', 'Revisá y confirmá']
const PHONE_HINT = 'Código de área sin 0 y número sin 15. Ej.: 11 5555-1234 o 351 555-1234.'
const PHONE_ERROR = 'Ingresá tu número completo: 10 dígitos después de +54 9.'
const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires'
const QUICK_DAYS = 14
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
const formatMoney = (amount, currency) => formatPrecio(amount, normalizeCurrency(currency))
const dateAtNoon = (date) => new Date(`${date}T12:00:00`)
const formatDateLabel = (date) => date ? capitalizar(dateAtNoon(date).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })) : 'Elegí una fecha'
const formatShortDate = (date) => date ? capitalizar(dateAtNoon(date).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' }).replaceAll('.', '')) : ''
const formatTimezone = (timezone) => timezone === 'America/Argentina/Buenos_Aires' ? 'Argentina · Buenos Aires' : timezone || 'zona horaria del negocio'
const isValidEmail = (email) => !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
const sameOffer = (before, after) => Boolean(before && after
  && before.id === after.id && before.nombre === after.nombre
  && Number(before.precio) === Number(after.precio)
  && Number(before.duracion_min) === Number(after.duracion_min)
  && normalizeCurrency(before.moneda) === normalizeCurrency(after.moneda))
const UNCERTAIN_BOOKING = 'No pudimos comprobar si la reserva se guardó. Consultá al negocio antes de volver a reservar para evitar duplicarla.'
const initials = (name) => String(name || '?').split(/[\s_·-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'
const prefersReducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
const DAY_PERIODS = [{ key: 'manana', label: 'Mañana', test: (hour) => hour < 12 }, { key: 'tarde', label: 'Tarde', test: (hour) => hour >= 12 && hour < 19 }, { key: 'noche', label: 'Noche', test: (hour) => hour >= 19 }]

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

// El color de marca se usa también como color de texto (etiquetas, íconos,
// bordes de selección). Con marcas claras (amarillo, celeste) el texto
// quedaba ilegible: lo mezclamos hacia la tinta del tema hasta llegar a 4.5:1
// sobre la superficie de Austral (--surface / --ink de cada tema).
const mixHex = (from, to, amount) => {
  const a = normalizeHex(from).slice(1)
  const b = normalizeHex(to).slice(1)
  return '#' + [0, 2, 4].map((index) => {
    const channel = Math.round(parseInt(a.slice(index, index + 2), 16) * (1 - amount) + parseInt(b.slice(index, index + 2), 16) * amount)
    return channel.toString(16).padStart(2, '0')
  }).join('')
}
const accentTextFor = (hex, theme) => {
  const surface = theme === 'dark' ? '#211e1a' : '#ffffff'
  const ink = theme === 'dark' ? '#f1ece4' : '#202020'
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

function BusinessMark({ business, size = 'md' }) {
  return <span className={`booking-mark booking-mark--${size}`} aria-hidden="true">{business?.logo_url ? <img src={business.logo_url} alt="" /> : initials(business?.nombre)}</span>
}

function BookingHeader({ business, theme, onThemeToggle }) {
  return (
    <header className="booking-header">
      <div className="booking-brand">
        <BusinessMark business={business} />
        <div className="booking-brand-text">
          <p className="booking-brand-name">{business?.nombre || 'Reservas online'}</p>
          {business?.direccion && <p className="booking-brand-address"><MapPin size={14} aria-hidden="true" /> <span>{business.direccion}</span></p>}
        </div>
      </div>
      {onThemeToggle && <IconButton className="booking-theme-toggle" label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} onClick={onThemeToggle}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</IconButton>}
    </header>
  )
}

function BookingProgress({ step, maxStep, onStep }) {
  return (
    <nav className="booking-progress" aria-label="Progreso de la reserva">
      <p className="booking-progress-count">Paso {step} de {STEPS.length}</p>
      <ol>
        {STEPS.map((item, index) => {
          const number = index + 1
          const state = number < step ? 'complete' : number === step ? 'current' : 'pending'
          const reachable = number !== step && number <= maxStep
          const content = <><span aria-hidden="true">{state === 'complete' ? <Check size={14} strokeWidth={3} /> : number}</span><small><span className="booking-progress-full">{item.label}</span><span className="booking-progress-short" aria-hidden="true">{item.short}</span></small></>
          return (
            <li className={`booking-progress-step ${state}`} key={item.label} aria-current={state === 'current' ? 'step' : undefined}>
              {reachable ? <button type="button" onClick={() => onStep(number)} aria-label={`${number < step ? 'Volver a' : 'Ir a'} ${item.label}`}>{content}</button> : <div>{content}</div>}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function SummaryValue({ value, placeholder }) {
  return value ? <dd>{value}</dd> : <dd className="is-pending">{placeholder}</dd>
}

function SummaryRow({ label, value, placeholder, onEdit, editLabel }) {
  return <div><dt>{label}</dt><SummaryValue value={value} placeholder={placeholder} />{onEdit && value && <button type="button" className="booking-edit" onClick={onEdit} aria-label={editLabel}>Cambiar</button>}</div>
}

function BookingSummary({ service, professional, date, time, currency, onEdit, as = 'aside', title = 'Tu reserva', className = '' }) {
  return (
    <Card as={as} className={`booking-summary ${className}`} aria-label={title}>
      <p className="booking-eyebrow">{title}</p>
      <dl className="booking-summary-list">
        <SummaryRow label="Servicio" value={service?.nombre} placeholder="Elegí un servicio" onEdit={onEdit && (() => onEdit(1))} editLabel="Cambiar servicio" />
        <SummaryRow label="Día y hora" value={date && time ? `${formatDateLabel(date)} · ${formatTime(time)}` : ''} placeholder="Elegí un horario" onEdit={onEdit && (() => onEdit(2))} editLabel="Cambiar día y horario" />
        <SummaryRow label="Profesional" value={time ? professional?.barbero_nombre : ''} placeholder="—" onEdit={onEdit && (() => onEdit(2))} editLabel="Cambiar profesional" />
        <SummaryRow label="Duración" value={service && professional && time ? `${professional.duracion_min} min` : ''} placeholder="—" />
      </dl>
      <div className="booking-summary-total"><span>Total</span><strong>{service ? formatMoney(service.precio, currency) : '—'}</strong></div>
    </Card>
  )
}

function BookingFooter() {
  return <footer className="booking-footer"><span>Reservas online con</span> <a href="/" target="_blank" rel="noreferrer">Austral</a></footer>
}

function BookingSkeleton() {
  return (
    <div className="booking-shell" role="status" aria-label="Cargando reservas">
      <div className="booking-header booking-header--skeleton"><Skeleton width={44} height={44} className="booking-skeleton-mark" /><div className="booking-skeleton-lines"><Skeleton width="180px" height={18} /><Skeleton width="140px" height={12} /></div></div>
      <div className="booking-card booking-card--skeleton">
        <Skeleton width="220px" height={28} />
        <Skeleton height={44} />
        {[1, 2, 3].map((item) => <Skeleton key={item} height={84} />)}
        <span className="booking-loading-label"><Spinner size={16} /> Cargando servicios y disponibilidad…</span>
      </div>
    </div>
  )
}

function BookingError({ message, onRetry }) {
  return <Card className="booking-state-card" role="alert"><EmptyState icon={<CalendarDays size={32} aria-hidden="true" />} title="No pudimos abrir esta reserva" description={message || 'El negocio no está disponible en este momento.'} action={<Button variant="secondary" onClick={onRetry}><RefreshCw size={16} aria-hidden="true" /> Intentar nuevamente</Button>} /></Card>
}

function BookingSuccess({ success, business, theme, brandStyle, onThemeToggle }) {
  const headingRef = useRef(null)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [])
  const service = success.servicio
  const professional = success.barbero
  const duration = success.duracion_min || professional?.duracion_min
  const firstName = String(success.nombre || '').split(/\s+/)[0]
  const addToCalendar = calendarHref({ fecha: success.fecha, hora: success.hora, duracion: duration, titulo: `${service?.nombre || 'Turno'} · ${business?.nombre || 'Reserva'}`, lugar: business?.direccion, timezone: business?.zona_horaria })
  const contactHref = buildWhatsAppHref(whatsappNumber(business?.whatsapp), `Hola! Tengo un turno el ${formatDateLabel(success.fecha)} a las ${formatTime(success.hora)} (${service?.nombre || 'turno'}) y quería hacer una consulta.`)
  return <main className="public-booking" data-theme={theme} style={brandStyle}>
    <div className="booking-shell booking-shell--narrow">
      <BookingHeader business={business} theme={theme} onThemeToggle={onThemeToggle} />
      <Card as="section" className="booking-success" aria-labelledby="booking-success-title">
        <div className="booking-success-hero">
          <span className="booking-success-icon"><CheckCircle2 size={34} aria-hidden="true" /></span>
          <h1 id="booking-success-title" ref={headingRef} tabIndex={-1}>¡Turno reservado!</h1>
          <p>{firstName ? `${firstName}, te esperamos` : 'Te esperamos'} en <strong>{business?.nombre}</strong>.</p>
        </div>
        <div className="booking-ticket">
          <div className="booking-ticket-when">
            <span className="booking-ticket-label"><CalendarDays size={16} aria-hidden="true" /> Fecha y hora</span>
            <strong>{formatDateLabel(success.fecha)}</strong>
            <span className="booking-ticket-time">{formatTime(success.hora)} h</span>
          </div>
          <dl className="booking-ticket-details">
            <div><dt>Servicio</dt><dd>{service?.nombre || 'Tu servicio'}</dd></div>
            <div><dt>Profesional</dt><dd>{professional?.barbero_nombre || 'Tu profesional'}</dd></div>
            <div><dt>Duración</dt><dd>{duration} min</dd></div>
            <div><dt>Total</dt><dd>{formatMoney(service?.precio, success.moneda)}</dd></div>
          </dl>
          {business?.direccion && <p className="booking-ticket-place"><MapPin size={16} aria-hidden="true" /> {business.direccion}</p>}
          <p className="booking-ticket-note"><Clock3 size={14} aria-hidden="true" /> Horario local: {formatTimezone(business?.zona_horaria)}.</p>
        </div>
        <div className="booking-success-actions">
          {addToCalendar && <a className="booking-button booking-link-button" href={addToCalendar} target="_blank" rel="noreferrer"><CalendarPlus size={18} aria-hidden="true" /> Agregar al calendario</a>}
          {contactHref && <a className="booking-button booking-button-secondary booking-link-button" href={contactHref} target="_blank" rel="noreferrer"><MessageCircle size={18} aria-hidden="true" /> Escribir al negocio</a>}
          <Button variant="secondary" className="booking-button booking-button-secondary" onClick={() => window.location.reload()}>Reservar otro turno</Button>
        </div>
        {contactHref && <p className="booking-success-help">¿Necesitás cambiar o cancelar el turno? Escribinos por WhatsApp.</p>}
      </Card>
      <BookingFooter />
    </div>
  </main>
}

function DayStrip({ minDate, maxDate, value, onChange }) {
  const listRef = useRef(null)
  const days = useMemo(() => {
    const result = []
    for (let offset = 0; offset < QUICK_DAYS; offset += 1) {
      const key = addDays(minDate, offset)
      if (!key || (maxDate && key > maxDate)) break
      result.push(key)
    }
    return result
  }, [minDate, maxDate])
  // Mantener visible el día elegido dentro de la tira, sin mover la página.
  useEffect(() => {
    const list = listRef.current
    const selected = list?.querySelector('[aria-pressed="true"]')
    if (!list || !selected) return
    const left = selected.offsetLeft - list.offsetLeft
    if (left < list.scrollLeft || left + selected.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollTo({ left: Math.max(0, left - 16), behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [value])
  return (
    <div className="booking-days" ref={listRef} role="group" aria-label="Próximos días">
      {days.map((key, index) => {
        const date = dateAtNoon(key)
        const top = index === 0 ? 'Hoy' : index === 1 ? 'Mañana' : capitalizar(date.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', ''))
        return (
          <button type="button" key={key} className={value === key ? 'selected' : ''} aria-pressed={value === key} aria-label={formatDateLabel(key)} onClick={() => onChange(key)}>
            <small>{top}</small>
            <strong>{date.getDate()}</strong>
            <small>{date.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '')}</small>
          </button>
        )
      })}
    </div>
  )
}

export default function PublicBooking({ slug }) {
  return <PublicBookingFlow key={slug} slug={slug} />
}

function PublicBookingFlow({ slug }) {
  const [catalogo, setCatalogo] = useState(null)
  const [servicioId, setServicioId] = useState(null)
  const servicio = useMemo(() => catalogo?.servicios.find((item) => item.id === servicioId) ?? null, [catalogo, servicioId])
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
  const [slotsError, setSlotsError] = useState('')
  const [catalogNotice, setCatalogNotice] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [availabilityNotice, setAvailabilityNotice] = useState('')
  const [success, setSuccess] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationUncertain, setConfirmationUncertain] = useState(false)
  const [theme, setTheme] = useState(() => initialTheme(slug))
  const [step, setStep] = useState(1)
  const selectionRef = useRef({ barberoId: null, hora: null })
  const previousSlotsContextRef = useRef(null)
  const slotsRequestRef = useRef(0)
  const catalogRequestRef = useRef(0)
  const submittingRef = useRef(false)
  const finishedRef = useRef(false)
  const mountedRef = useRef(true)
  const stepHeadingRef = useRef(null)
  const stepChangedRef = useRef(false)

  useLayoutEffect(() => { selectionRef.current = { barberoId, hora, servicio, fecha, moneda: catalogo?.barberia?.moneda } }, [barberoId, hora, servicio, fecha, catalogo?.barberia?.moneda])
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      catalogRequestRef.current += 1
      slotsRequestRef.current += 1
    }
  }, [])
  useEffect(() => {
    try { localStorage.setItem(`public-booking-theme:${slug}`, theme) } catch { /* storage is optional */ }
  }, [slug, theme])

  // Cada paso es una entrada del historial con la misma URL: el botón Atrás
  // del teléfono (o del navegador de WhatsApp) vuelve al paso anterior en vez
  // de abandonar la reserva. No se guarda ningún dato del cliente en la URL
  // ni en el historial, sólo el número de paso.
  useEffect(() => {
    try { window.history.replaceState({ ...(window.history.state || {}), bookingStep: 1 }, '') } catch { /* history is optional */ }
    const onPopState = (event) => {
      if (submittingRef.current) return
      const next = Number(event.state?.bookingStep)
      stepChangedRef.current = true
      setStep(next >= 1 && next <= STEPS.length ? next : 1)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  // Al cambiar de paso, el foco pasa al título del paso y la vista vuelve al
  // inicio de la tarjeta: en el celular el contenido anterior queda arriba.
  useEffect(() => {
    if (!stepChangedRef.current) return
    stepChangedRef.current = false
    const heading = stepHeadingRef.current
    if (!heading) return
    heading.focus({ preventScroll: true })
    const top = heading.closest('.booking-card')?.getBoundingClientRect().top
    if (Number.isFinite(top) && top < 0) window.scrollTo({ top: window.scrollY + top - 12, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [step])

  const goToStep = (next) => {
    if (submittingRef.current || next === step) return
    stepChangedRef.current = true
    setStep(next)
    try {
      if (next > step) window.history.pushState({ ...(window.history.state || {}), bookingStep: next }, '')
      else window.history.replaceState({ ...(window.history.state || {}), bookingStep: next }, '')
    } catch { /* history is optional */ }
  }

  const cargarCatalogo = useCallback(async () => {
    const requestId = ++catalogRequestRef.current
    const vigente = () => mountedRef.current && requestId === catalogRequestRef.current && !finishedRef.current
    try {
      if (!isSupabaseConfigured) { setError('La página de reservas no está configurada.'); return null }
      const { data, error: rpcError } = await supabase.rpc('catalogo_reserva_publica', { p_slug: slug })
      if (!vigente()) return null
      if (rpcError) throw rpcError
      if (!data?.barberia) {
        setError('No encontramos esta barbería o negocio. Las reservas pueden estar temporalmente pausadas.')
        return null
      }
      const nextCatalog = { ...data, servicios: Array.isArray(data.servicios) ? data.servicios.filter((s) => s.activo !== false) : [] }
      const previous = selectionRef.current.servicio
      const selected = nextCatalog.servicios.find((s) => s.id === previous?.id) ?? nextCatalog.servicios[0] ?? null
      if (previous && (!sameOffer(previous, selected) || normalizeCurrency(selectionRef.current.moneda) !== normalizeCurrency(data.barberia.moneda))) {
        setCatalogNotice('El servicio cambió. Revisá el precio y la duración antes de confirmar.')
      }
      if (previous && (previous.id !== selected?.id || Number(previous.duracion_min) !== Number(selected?.duracion_min))) {
        slotsRequestRef.current += 1
        setSlots([])
        setBarberoId(null)
        setHora(null)
        if (previous.id !== selected?.id) {
          stepChangedRef.current = true
          setStep(1)
          setCatalogNotice('El servicio elegido ya no está disponible. Elegí otro servicio para continuar.')
        }
      }
      setCatalogo(nextCatalog)
      setServicioId(selected?.id ?? null)
      setError('')
      return nextCatalog
    } catch {
      if (vigente()) setError('No pudimos actualizar los servicios. Intentá nuevamente.')
      return null
    } finally {
      if (vigente()) setLoading(false)
    }
  }, [slug])

  const serviceId = servicio?.id
  const serviceDuration = servicio?.duracion_min
  const cargarSlots = useCallback(async () => {
    const requestId = ++slotsRequestRef.current
    const vigente = () => mountedRef.current && requestId === slotsRequestRef.current && !finishedRef.current
    if (serviceId == null || !fecha || !isSupabaseConfigured) {
      setSlots([])
      setLoadingSlots(false)
      return null
    }
    setLoadingSlots(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('horarios_disponibles_reserva_publica', {
        p_slug: slug, p_servicio_id: serviceId, p_fecha: fecha,
      })
      if (!vigente()) return null
      if (rpcError || !Array.isArray(data)) throw rpcError || new Error('Disponibilidad inválida')
      const nextSlots = data
      const previous = selectionRef.current
      const sameContext = previousSlotsContextRef.current?.serviceId === serviceId && previousSlotsContextRef.current?.fecha === fecha
      const stillAvailable = nextSlots.some((slot) => slot.barbero_id === previous.barberoId && slot.hora === previous.hora)
      if (sameContext && previous.hora && !stillAvailable) setAvailabilityNotice('La disponibilidad se actualizó y el horario seleccionado dejó de estar disponible. Elegí otro horario.')
      setSlots(nextSlots)
      setBarberoId((id) => nextSlots.some((slot) => slot.barbero_id === id) ? id : (nextSlots[0]?.barbero_id ?? null))
      setHora((current) => nextSlots.some((slot) => slot.barbero_id === previous.barberoId && slot.hora === current) ? current : null)
      previousSlotsContextRef.current = { serviceId, fecha }
      setSlotsError('')
      return nextSlots
    } catch {
      if (vigente()) setSlotsError('No pudimos actualizar la disponibilidad. Intentá nuevamente.')
      return null
    } finally {
      if (vigente()) setLoadingSlots(false)
    }
  }, [slug, serviceId, fecha])

  useEffect(() => { cargarCatalogo() }, [cargarCatalogo])
  useEffect(() => {
    cargarSlots()
    return () => { slotsRequestRef.current += 1 }
  }, [cargarSlots, serviceDuration])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && !submittingRef.current && !finishedRef.current) { cargarCatalogo(); cargarSlots() } }
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
    slots.forEach((slot) => {
      if (!seen.has(slot.barbero_id)) seen.set(slot.barbero_id, { ...slot, total: 0 })
      seen.get(slot.barbero_id).total += 1
    })
    return [...seen.values()]
  }, [slots])
  const horarios = useMemo(() => slots.filter((slot) => slot.barbero_id === barberoId), [slots, barberoId])
  const horariosPorFranja = useMemo(() => DAY_PERIODS.map((period) => ({ ...period, slots: horarios.filter((slot) => period.test(Number(formatTime(slot.hora).slice(0, 2)))) })).filter((period) => period.slots.length), [horarios])
  const barbero = profesionales.find((professional) => professional.barbero_id === barberoId)
  const currency = normalizeCurrency(catalogo?.barberia?.moneda || servicio?.moneda)
  const accent = normalizeHex(catalogo?.barberia?.color_principal)
  const secondary = normalizeHex(catalogo?.barberia?.color_secundario, '#ede6d8')
  const accentText = accentForeground(accent)
  const brandStyle = { '--booking-accent': accent, '--booking-secondary': secondary, '--booking-accent-foreground': accentText, '--booking-accent-text': accentTextFor(accent, theme) }
  const phoneIsValid = telefonoNacionalValido(telefono)
  const maxStep = !servicio ? 1 : !hora ? 2 : 3
  const visibleStep = !servicio ? 1 : step
  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark')

  const clearFeedback = () => { setAvailabilityNotice(''); setSlotsError(''); if (!confirmationUncertain) setSubmitError('') }
  const seleccionarServicio = (nextService) => {
    if (submittingRef.current) return
    if (servicio?.id !== nextService.id) { setServicioId(nextService.id); setBarberoId(null); setHora(null); setFieldErrors({}); clearFeedback() }
    goToStep(2)
  }
  const seleccionarFecha = (value) => { if (submittingRef.current || !value || value === fecha) return; setFecha(value); setBarberoId(null); setHora(null); setFieldErrors({}); clearFeedback() }
  const seleccionarProfesional = (id) => { if (submittingRef.current) return; setBarberoId(id); setHora(null); clearFeedback() }
  const seleccionarHora = (nextHour) => { if (submittingRef.current) return; setHora(nextHour); setFieldErrors({}); clearFeedback() }
  const reintentarHorarios = () => { if (!submittingRef.current) cargarSlots() }

  const confirmar = async (event) => {
    event.preventDefault()
    if (submittingRef.current || finishedRef.current || confirmationUncertain) return
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
    submittingRef.current = true
    setSubmitting(true)
    let mutationStarted = false
    try {
      const freshCatalog = await cargarCatalogo()
      if (!mountedRef.current) return
      if (!freshCatalog) { setSubmitError('No pudimos revisar el servicio. Intentá nuevamente.'); return }
      const freshService = freshCatalog.servicios.find((s) => s.id === servicio.id)
      if (!sameOffer(servicio, freshService) || normalizeCurrency(freshCatalog.barberia.moneda || freshService?.moneda) !== currency) {
        setSubmitError('El servicio cambió. Revisá el resumen antes de confirmar otra vez.')
        return
      }
      // Reconsultamos primero, para no confirmar una opción que cambió mientras el formulario estaba abierto.
      const disponibles = await cargarSlots()
      if (!mountedRef.current) return
      if (!disponibles) { setSubmitError('No pudimos revisar los horarios. Intentá nuevamente.'); return }
      const chosenSlot = disponibles.find((slot) => slot.barbero_id === barbero.barbero_id && slot.hora === hora)
      if (!chosenSlot) {
        setSubmitError('Ese horario acaba de ocuparse. Elegí otro horario.')
        return
      }
      if (Number(chosenSlot.duracion_min) !== Number(barbero.duracion_min)) {
        setSubmitError('La duración del turno cambió. Revisá el resumen antes de confirmar otra vez.')
        return
      }
      mutationStarted = true
      const { data, error: rpcError } = await supabase.rpc('crear_reserva_publica', {
        p_slug: slug, p_servicio_id: servicio.id, p_barbero_id: barbero.barbero_id,
        p_fecha: fecha, p_hora: hora, p_nombre: nombre.trim(), p_telefono: soloDigitos(telefono), p_email: email.trim() || null,
      })
      if (!mountedRef.current) return
      if (rpcError) {
        // Una excepción SQL confirma el rechazo de esa transacción. Errores
        // de transporte/proxy no prueban que el servidor no haya guardado.
        const rejected = /^(22|23|42|P0)[0-9A-Z]{3}$/.test(rpcError.code || '')
          || ['40001', '40P01'].includes(rpcError.code)
        if (!rejected) {
          setConfirmationUncertain(true)
          setSubmitError(UNCERTAIN_BOOKING)
          return
        }
        const known = knownBookingError(rpcError)
        if (known?.field) setFieldErrors((current) => ({ ...current, [known.field]: known.message }))
        setSubmitError(safeRpcError(rpcError))
        await cargarSlots()
        return
      }
      const created = Array.isArray(data) && data.length === 1 ? data[0] : null
      if (!created || !/^[1-9]\d*$/.test(String(created.turno_id)) || created.fecha !== fecha
        || formatTime(created.hora) !== formatTime(hora) || !(Number(created.duracion_min) > 0)) {
        setConfirmationUncertain(true)
        setSubmitError(UNCERTAIN_BOOKING)
        return
      }
      finishedRef.current = true
      setSuccess({ ...created, servicio: freshService, barbero: chosenSlot, nombre: nombre.trim(), telefono: soloDigitos(telefono), moneda: currency })
      window.scrollTo({ top: 0 })
    } catch {
      if (mountedRef.current) {
        if (mutationStarted) setConfirmationUncertain(true)
        setSubmitError(mutationStarted ? UNCERTAIN_BOOKING : 'No pudimos revisar la reserva. Intentá nuevamente.')
      }
    } finally {
      submittingRef.current = false
      if (mountedRef.current) setSubmitting(false)
    }
  }

  const retry = () => { setError(''); setLoading(true); cargarCatalogo() }

  if (success) return <BookingSuccess success={success} business={catalogo?.barberia} theme={theme} brandStyle={brandStyle} onThemeToggle={toggleTheme} />
  if (loading) return <main className="public-booking" data-theme={theme} style={brandStyle}><BookingSkeleton /></main>
  if (error && !catalogo) return <main className="public-booking" data-theme={theme} style={brandStyle}><div className="booking-shell booking-shell--narrow"><BookingError message={error} onRetry={retry} /><BookingFooter /></div></main>

  const business = catalogo.barberia
  const minDate = dateKey(business.zona_horaria)
  const maxDays = Number(business.max_dias_reserva)
  const maxDate = Number.isInteger(maxDays) && maxDays > 0 ? addDays(minDate, maxDays) : ''
  // Sólo acotamos el máximo: el servidor ya descarta fechas pasadas y el selector usa min.
  const outOfRange = Boolean(fecha && maxDate && fecha > maxDate)
  const dateHint = maxDate ? `Hasta ${maxDays} días por adelantado.` : 'Desde hoy.'
  const submitLabel = submitting ? 'Confirmando reserva…' : loadingSlots ? 'Validando disponibilidad…' : 'Confirmar reserva'
  const hasFieldError = Object.values(fieldErrors).some(Boolean)
  const contactHref = buildWhatsAppHref(whatsappNumber(business.whatsapp), 'Hola! Quería consultar por un turno.')
  const selectionText = visibleStep === 1
    ? (servicio ? `${servicio.nombre} · ${formatMoney(servicio.precio, currency)}` : 'Elegí un servicio')
    : (hora ? `${formatShortDate(fecha)} · ${formatTime(hora)} · ${barbero?.barbero_nombre || ''}` : 'Elegí un horario para continuar')
  const canContinue = visibleStep === 1 ? Boolean(servicio) : Boolean(hora && barbero && !loadingSlots)

  return (
    <main className="public-booking" data-theme={theme} style={brandStyle}>
      <div className="booking-shell">
        <BookingHeader business={business} theme={theme} onThemeToggle={toggleTheme} />
        <div className="booking-layout">
          <Card as="section" className={`booking-card booking-step-${visibleStep}`} aria-labelledby="booking-step-title">
            <div className="booking-intro">
              <h1 id="booking-title">Elegí tu próximo turno</h1>
              <BookingProgress step={visibleStep} maxStep={maxStep} onStep={goToStep} />
            </div>
            <div className="booking-step-heading">
              {visibleStep > 1 && <IconButton className="booking-back" label="Volver al paso anterior" onClick={() => goToStep(visibleStep - 1)}><ArrowLeft size={18} /></IconButton>}
              <h2 id="booking-step-title" ref={stepHeadingRef} tabIndex={-1}>{STEP_TITLES[visibleStep - 1]}</h2>
            </div>
            <LiveRegion className={`booking-notice ${catalogNotice || availabilityNotice ? 'has-message' : ''}`}>{[catalogNotice, availabilityNotice].filter(Boolean).join(' ')}</LiveRegion>
            {(error || slotsError) && <div className="booking-error" role="alert"><span>{error || slotsError}</span><Button variant="secondary" size="sm" disabled={submitting} onClick={error ? cargarCatalogo : reintentarHorarios}><RefreshCw size={14} aria-hidden="true" /> Reintentar</Button></div>}

            {visibleStep === 1 && (
              catalogo.servicios.length === 0
                ? <EmptyState className="booking-empty" icon={<CalendarDays size={28} aria-hidden="true" />} title="No hay servicios disponibles" description="Este negocio todavía no publicó servicios para reservar online." action={<div className="booking-empty-actions"><Button variant="secondary" onClick={retry}><RefreshCw size={16} aria-hidden="true" /> Actualizar</Button>{contactHref && <a className="booking-button booking-button-secondary booking-link-button" href={contactHref} target="_blank" rel="noreferrer"><MessageCircle size={16} aria-hidden="true" /> Escribir al negocio</a>}</div>} />
                : <div className="service-list">{catalogo.servicios.map((service) => {
                  const selected = servicio?.id === service.id
                  return (
                    <button type="button" key={service.id} className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => seleccionarServicio(service)}>
                      <span className="booking-option-content">
                        <strong>{service.nombre}</strong>
                        {service.descripcion && <small>{service.descripcion}</small>}
                        <span className="booking-option-meta"><Clock3 size={13} aria-hidden="true" /> {service.duracion_min} min</span>
                      </span>
                      <span className="booking-option-side">
                        <span className="booking-price">{formatMoney(service.precio, currency)}</span>
                        <span className="booking-option-check" aria-hidden="true">{selected ? <Check size={14} strokeWidth={3} /> : <ArrowRight size={14} />}</span>
                      </span>
                    </button>
                  )
                })}</div>
            )}

            {visibleStep === 2 && (
              <div className="booking-step-body">
                <section className="booking-block" aria-labelledby="booking-date-title">
                  <div className="booking-block-heading"><h3 id="booking-date-title">Día</h3><span>{formatDateLabel(fecha)}</span></div>
                  <DayStrip minDate={minDate} maxDate={maxDate} value={fecha} onChange={seleccionarFecha} />
                  <FormField className="booking-other-date" label="Otra fecha" hint={`${dateHint} Horarios de ${formatTimezone(business.zona_horaria)}.`} id="booking-date"><Input className="booking-date" type="date" min={minDate} max={maxDate || undefined} value={fecha} onChange={(event) => seleccionarFecha(event.target.value)} /></FormField>
                </section>

                <section className="booking-block" aria-labelledby="booking-professional-title" aria-busy={loadingSlots || undefined}>
                  <div className="booking-block-heading"><h3 id="booking-professional-title">Profesional</h3><span>{loadingSlots ? 'Actualizando…' : profesionales.length ? `${profesionales.length} ${profesionales.length === 1 ? 'disponible' : 'disponibles'}` : ''}</span></div>
                  {loadingSlots ? <div className="professional-list" role="status" aria-label="Actualizando disponibilidad"><Skeleton height={64} /><Skeleton height={64} /></div>
                    : outOfRange ? <EmptyState className="booking-empty" title="Elegí otra fecha" description={maxDate ? `Este negocio toma reservas desde hoy y hasta ${maxDays} días por adelantado.` : 'Este negocio toma reservas desde hoy.'} />
                      : profesionales.length === 0 ? <EmptyState className="booking-empty" icon={<CalendarDays size={26} aria-hidden="true" />} title="No hay profesionales disponibles" description={`No quedan horarios libres para ${servicio?.nombre || 'este servicio'} el ${formatDateLabel(fecha).toLowerCase()}. Probá con otro día.`} action={!maxDate || addDays(fecha, 1) <= maxDate ? <Button variant="secondary" onClick={() => seleccionarFecha(addDays(fecha, 1))}>Ver el día siguiente</Button> : null} />
                        : <div className="professional-list">{profesionales.map((professional) => {
                          const selected = barberoId === professional.barbero_id
                          return <button type="button" key={professional.barbero_id} className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => seleccionarProfesional(professional.barbero_id)}><span className="booking-avatar" style={{ '--avatar-color': normalizeHex(professional.barbero_color, accent) }} aria-hidden="true">{initials(professional.barbero_nombre)}</span><span className="booking-option-content"><strong>{professional.barbero_nombre}</strong><small>{professional.total} {professional.total === 1 ? 'horario libre' : 'horarios libres'}</small></span><span className="booking-option-check" aria-hidden="true">{selected ? <Check size={14} strokeWidth={3} /> : ''}</span></button>
                        })}</div>}
                </section>

                {!outOfRange && (loadingSlots || profesionales.length > 0) && (
                  <section className="booking-block" aria-labelledby="booking-time-title">
                    <div className="booking-block-heading"><h3 id="booking-time-title">Horario</h3><span>{barbero && !loadingSlots ? `${horarios.length} ${horarios.length === 1 ? 'opción' : 'opciones'} · hora local` : ''}</span></div>
                    {loadingSlots ? <div className="time-list">{[1, 2, 3, 4, 5, 6].map((item) => <Skeleton height={48} key={item} />)}</div>
                      : !barbero ? <p className="booking-muted">Elegí un profesional para ver sus horarios.</p>
                        : horarios.length === 0 ? <EmptyState className="booking-empty" title="No quedan horarios libres" description="Elegí otro día o profesional para continuar." />
                          : horariosPorFranja.map((period) => (
                            <div className="booking-period" key={period.key}>
                              <p className="booking-period-label">{period.label}</p>
                              <div className="time-list">{period.slots.map((slot) => <button type="button" key={slot.hora} className={hora === slot.hora ? 'selected' : ''} aria-pressed={hora === slot.hora} onClick={() => seleccionarHora(slot.hora)}>{formatTime(slot.hora)}</button>)}</div>
                            </div>
                          ))}
                  </section>
                )}
              </div>
            )}

            {visibleStep < 3 && (
              <div className="booking-actionbar">
                <div className="booking-actionbar-summary" aria-live="polite">
                  <small>{visibleStep === 1 ? 'Servicio elegido' : 'Tu turno'}</small>
                  <strong>{selectionText}</strong>
                </div>
                <Button variant="primary" size="lg" className="booking-button booking-continue" disabled={!canContinue} onClick={() => goToStep(visibleStep + 1)}>Continuar <ArrowRight size={18} aria-hidden="true" /></Button>
              </div>
            )}

            {visibleStep === 3 && (
              <form className="booking-step-body booking-form" onSubmit={confirmar} noValidate aria-labelledby="booking-step-title">
                <BookingSummary as="section" className="booking-review" title="Tu turno" service={servicio} professional={barbero} date={fecha} time={hora} currency={currency} onEdit={goToStep} />
                {!hora && <div className="booking-error" role="alert"><span>Elegí un horario para poder confirmar.</span><Button variant="secondary" size="sm" onClick={() => goToStep(2)}>Elegir horario</Button></div>}
                <fieldset className="booking-fields" disabled={submitting}>
                  <legend>Tus datos</legend>
                  <FormField label="Nombre y apellido" required error={fieldErrors.nombre} id="booking-name"><Input value={nombre} onChange={(event) => { setNombre(event.target.value); setFieldErrors((current) => ({ ...current, nombre: '' })) }} placeholder="Ej.: Juan Pérez" autoComplete="name" autoCapitalize="words" maxLength={80} enterKeyHint="next" /></FormField>
                  <FormField label="Teléfono celular" required hint={PHONE_HINT} error={fieldErrors.telefono} id="booking-phone"><PhoneField data-booking-phone value={telefono} onChange={(value) => { setTelefono(value); setFieldErrors((current) => ({ ...current, telefono: '' })) }} className="booking-phone-field" aria-label="Teléfono" enterKeyHint="next" /></FormField>
                  <FormField label="Email (opcional)" hint="Queda guardado con tus datos de cliente del negocio." error={fieldErrors.email} id="booking-email"><Input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: '' })) }} placeholder="tu@email.com" autoComplete="email" inputMode="email" maxLength={120} enterKeyHint="done" /></FormField>
                </fieldset>
                {submitError && <div className="booking-error booking-submit-error" role="alert"><span>{submitError}</span>{confirmationUncertain
                  ? contactHref && <a className="booking-button booking-button-secondary booking-link-button" href={contactHref} target="_blank" rel="noreferrer">Consultar al negocio</a>
                  : !hasFieldError && hora && <Button variant="secondary" size="sm" onClick={() => goToStep(2)}>Elegir otro horario</Button>}</div>}
                <Button type="submit" variant="primary" size="lg" className="booking-button booking-submit" disabled={!hora || loadingSlots || submitting || confirmationUncertain} loading={loadingSlots || submitting}>{submitLabel}</Button>
                <p className="booking-form-note">Al confirmar verificamos nuevamente que el horario siga libre.</p>
              </form>
            )}
          </Card>
          <BookingSummary service={servicio} professional={barbero} date={fecha} time={hora} currency={currency} onEdit={(target) => target <= maxStep && goToStep(target)} className="booking-aside" />
        </div>
        <BookingFooter />
      </div>
    </main>
  )
}
