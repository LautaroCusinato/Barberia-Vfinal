import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, MapPin, Moon, Scissors, Sun, UserRound } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient'
import PhoneField from '../components/PhoneField'
import { PREFIJO_AR, soloDigitos } from '../lib/text'
import './PublicBooking.css'

const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())
const formatTime = (time) => String(time).slice(0, 5)
const THEME_KEY = 'public-booking-theme'
const initialTheme = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* storage is optional */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
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
  const [success, setSuccess] = useState(null)
  const [theme, setTheme] = useState(initialTheme)

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* storage is optional */ }
  }, [theme])

  const cargarCatalogo = useCallback(async () => {
    if (!isSupabaseConfigured) { setError('La página de reservas no está configurada.'); setLoading(false); return }
    const { data, error: rpcError } = await supabase.rpc('catalogo_reserva_publica', { p_slug: slug })
    if (rpcError || !data?.barberia) { setError('No encontramos esta barbería.'); setLoading(false); return }
    setCatalogo(data)
    setServicio((current) => current && data.servicios.some((s) => s.id === current.id) ? current : data.servicios[0] ?? null)
    setLoading(false)
  }, [slug])

  const cargarSlots = useCallback(async () => {
    if (!servicio || !fecha || !isSupabaseConfigured) return
    setLoadingSlots(true)
    const { data, error: rpcError } = await supabase.rpc('horarios_disponibles_reserva_publica', {
      p_slug: slug, p_servicio_id: servicio.id, p_fecha: fecha,
    })
    if (rpcError) setError('No pudimos actualizar los horarios. Intentá nuevamente.')
    else {
      setSlots(data ?? [])
      setBarberoId((id) => (data ?? []).some((slot) => slot.barbero_id === id) ? id : (data?.[0]?.barbero_id ?? null))
      setHora(null)
    }
    setLoadingSlots(false)
  }, [slug, servicio, fecha])

  useEffect(() => { cargarCatalogo() }, [cargarCatalogo])
  useEffect(() => { cargarSlots() }, [cargarSlots])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') { cargarCatalogo(); cargarSlots() } }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 30000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  }, [cargarCatalogo, cargarSlots])

  const profesionales = useMemo(() => {
    const seen = new Map()
    slots.forEach((s) => { if (!seen.has(s.barbero_id)) seen.set(s.barbero_id, s) })
    return [...seen.values()]
  }, [slots])
  const horarios = useMemo(() => slots.filter((s) => s.barbero_id === barberoId), [slots, barberoId])
  const barbero = profesionales.find((p) => p.barbero_id === barberoId)

  const confirmar = async (event) => {
    event.preventDefault()
    if (!servicio || !barbero || !hora) { setError('Elegí un profesional y un horario.'); return }
    if (soloDigitos(telefono).length !== 13) { setError('Ingresá los 8 dígitos de tu teléfono.'); return }
    setError('')
    setLoadingSlots(true)
    // Reconsultamos primero, para no confirmar una opción que cambió mientras el formulario estaba abierto.
    await cargarSlots()
    const { data, error: rpcError } = await supabase.rpc('crear_reserva_publica', {
      p_slug: slug, p_servicio_id: servicio.id, p_barbero_id: barbero.barbero_id,
      p_fecha: fecha, p_hora: hora, p_nombre: nombre, p_telefono: soloDigitos(telefono), p_email: email || null,
    })
    setLoadingSlots(false)
    if (rpcError) { setError(rpcError.message || 'El horario dejó de estar disponible. Elegí otro.'); await cargarSlots(); return }
    setSuccess(data?.[0] ?? { fecha, hora, duracion_min: barbero.duracion_min })
  }

  if (success) return (
    <main className="public-booking" data-theme={theme} style={{ '--booking-accent': catalogo?.barberia?.color_principal || '#9b6a2f' }}><section className="booking-success">
      <CheckCircle2 size={54} /><h1>¡Turno reservado!</h1>
      <p>Te esperamos el <strong>{new Date(`${success.fecha}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</strong> a las <strong>{formatTime(success.hora)}</strong>.</p>
      <button className="booking-button secondary" onClick={() => window.location.reload()}>Reservar otro turno</button>
    </section></main>
  )

  if (loading) return <main className="public-booking booking-loading">Cargando reservas…</main>
  if (error && !catalogo) return <main className="public-booking booking-loading">{error}</main>

  return (
    <main className="public-booking" data-theme={theme} style={{ '--booking-accent': catalogo.barberia.color_principal || '#9b6a2f' }}>
      <header className="booking-header">
        <div className="booking-mark"><Scissors size={25} /><span>{catalogo.barberia.nombre}</span></div>
        <div className="booking-header-actions">
          {catalogo.barberia.direccion && <span className="booking-address"><MapPin size={16} /> {catalogo.barberia.direccion}</span>}
          <button type="button" className="booking-theme-toggle" onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>
      <section className="booking-card">
        <div className="booking-intro"><p>RESERVAS ONLINE</p><h1>Elegí tu próximo turno</h1><span>Solo te mostramos horarios que realmente están disponibles.</span></div>
        {error && <p className="booking-error">{error}</p>}
        <div className="booking-section"><h2><Scissors size={18} /> Servicio</h2><div className="service-list">
          {catalogo.servicios.map((s) => <button type="button" key={s.id} className={servicio?.id === s.id ? 'selected' : ''} onClick={() => setServicio(s)}><strong>{s.nombre}</strong><span>{s.duracion_min} min · ${Number(s.precio).toLocaleString('es-AR')}</span></button>)}
        </div></div>
        <div className="booking-section"><h2><CalendarDays size={18} /> Fecha</h2><input className="booking-date" type="date" min={dateKey()} value={fecha} onChange={(e) => setFecha(e.target.value)} /></div>
        <div className="booking-section"><h2><UserRound size={18} /> Profesional</h2>
          {loadingSlots ? <p className="booking-muted">Actualizando disponibilidad…</p> : profesionales.length === 0 ? <p className="booking-muted">No hay horarios disponibles para esta fecha.</p> : <div className="professional-list">{profesionales.map((p) => <button type="button" key={p.barbero_id} className={barberoId === p.barbero_id ? 'selected' : ''} onClick={() => { setBarberoId(p.barbero_id); setHora(null) }}><i style={{ background: p.barbero_color }} />{p.barbero_nombre}</button>)}</div>}
        </div>
        {barbero && <div className="booking-section"><h2><Clock3 size={18} /> Horario</h2><div className="time-list">{horarios.map((s) => <button type="button" key={s.hora} className={hora === s.hora ? 'selected' : ''} onClick={() => setHora(s.hora)}>{formatTime(s.hora)}</button>)}</div></div>}
        <form className="booking-section booking-form" onSubmit={confirmar}><h2>Tus datos</h2>
          <input required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre y apellido" autoComplete="name" enterKeyHint="next" />
          <PhoneField required value={telefono} onChange={setTelefono} className="booking-phone-field" aria-label="Teléfono" enterKeyHint="next" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (opcional)" />
          <button className="booking-button" disabled={!hora || loadingSlots}>{loadingSlots ? 'Validando…' : 'Confirmar turno'}</button>
        </form>
      </section>
    </main>
  )
}
