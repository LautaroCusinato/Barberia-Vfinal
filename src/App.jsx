import { useCallback, useEffect, useRef, useState } from 'react'
import './components/agenda.css'
import './components/management.css'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Info, CalendarCheck, MessageCircle, Plus, Bot, Download, AlertTriangle, X } from 'lucide-react'
import NewTurnoModal from './components/NewTurnoModal'
import { statusMeta } from './components/StatusSelect'
import CobroModal from './components/CobroModal'
import { logout } from './lib/auth.js'
import { exportarCSV } from './lib/csv'
import Sidebar from './components/Sidebar'
import StatsCards from './components/StatsCards'
import Agenda from './components/Agenda'
import Barberos from './components/Barberos'
import Calendar from './components/Calendar'
import Messages from './components/Messages'
import Patients from './components/Patients'
import Notes from './components/Notes'
import Stats from './components/Stats'
import Operations from './components/Operations'
import OnboardingChecklist from './components/OnboardingChecklist'
import Billing from './pages/Billing.jsx'
import TenantSettings from './components/TenantSettings.jsx'
import WorkspacePreparing from './components/WorkspacePreparing.jsx'
import { supabase, isSupabaseConfigured as supabaseConfigured } from './lib/supabaseClient'
import { barberoRealizaServicio, capitalizar, duracionServicioBarbero, generarIdHabilidad, generarSlotsDisponibles, parseHabilidades, parseHorarioTexto, siguienteNombreServicio, soloDigitos, turnosSeSuperponen } from './lib/text'
import { DEFAULT_BUSINESS_NAME, tenantStorageKey } from './lib/tenant'
import { clearWorkspaceTransition } from './lib/workspaceTransition.js'
import {
  mockBarberiaConfig,
  mockBarberos,
  mockConversaciones,
  mockNotas,
  mockPacientes,
  mockServicios,
  mockTurnos,
} from './data/mockData'
import { getDemoSnapshot, resetDemoSession, saveDemoSnapshot } from './lib/demoStore.js'
import { reportClientError } from './lib/observability.js'
import { initialWorkspaceCollection } from './lib/runtimeStability.js'
import { MANAGED_WHATSAPP_PROVISIONING, WHATSAPP_PROVISION_FUNCTION } from './lib/whatsappProvisioning.js'
import { enqueueLatest } from './lib/latestIntentQueue.js'

const TZ = 'America/Argentina/Buenos_Aires'
const LEGACY_THEME_KEY = 'barberia-central-theme'
const WHATSAPP_PANEL_SEND_FUNCTION = 'whatsapp-panel-send'

// Traduce los rechazos de la base (exclusión, triggers de agenda) a un
// mensaje accionable. Devuelve null si el error no es de reglas de agenda.
function mensajeErrorTurno(error) {
  const message = String(error?.message || '').toLowerCase()
  if (error?.code === '23P01' || /exclusion|solap|ocup/.test(message)) return 'Ese horario acaba de ocuparse. Elegí otro horario.'
  if (/servicio|profesional/.test(message)) return 'El profesional seleccionado ya no realiza ese servicio.'
  if (/horario|jornada|trabaja/.test(message)) return 'El horario está fuera de la jornada laboral o atraviesa un descanso.'
  if (/bloque/.test(message)) return 'Ese horario está bloqueado. Elegí otro horario.'
  return null
}

function nextLocalId(items) {
  return Math.max(0, ...items.map((item) => Number(item.id) || 0)) + 1
}

function servicioFromDb(row) {
  return { ...row, duracion: row.duracion_min }
}

function barberoFromDb(row, servicios = [], agenda = [], serviciosCargados = true, agendaCargada = true) {
  return {
    ...row,
    horario: row.horario_texto,
    rol: row.especialidad,
    servicios,
    serviciosCargados,
    agenda,
    agendaCargada,
  }
}

function turnoFromDb(row) {
  return { ...row, duracion: row.duracion_min }
}

function todayInClinicTZ(timezone = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || TZ }).format(new Date())
}

function addCalendarDays(value, offset) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function demoBookingDate(todayKey, barberos, servicios, bloqueos, turnos, timezone) {
  const servicio = servicios.find((item) => item.activo !== false)
  if (!servicio) return todayKey
  const preferredBarber = barberos.find((barbero) => (
    barbero.activo !== false && barberoRealizaServicio(barbero, servicio)
  ))
  if (!preferredBarber) return todayKey

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addCalendarDays(todayKey, offset)
    const slots = generarSlotsDisponibles(
      preferredBarber,
      candidate,
      duracionServicioBarbero(preferredBarber, servicio, servicio.duracion || 30),
      bloqueos,
      15,
      timezone,
    )
    const occupied = (turnos || []).filter((turno) => (
      turno.fecha === candidate &&
      String(turno.barbero_id) === String(preferredBarber.id) &&
      !['no_asistio', 'cancelado'].includes(statusMeta(turno.estado).value)
    ))
    const available = slots.filter((slot) => !occupied.some((turno) => (
      turnosSeSuperponen(slot, duracionServicioBarbero(preferredBarber, servicio, servicio.duracion || 30), turno.hora, turno.duracion || 30)
    )))
    if (available.length > 0) return candidate
  }

  return todayKey
}

function initialTheme(tenantId, storageKey = null) {
  const saved = localStorage.getItem(storageKey || tenantStorageKey('theme', tenantId)) || localStorage.getItem(LEGACY_THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const WORKSPACE_VIEWS = new Set(['resumen', 'agenda', 'equipo', 'mensajes', 'pacientes', 'notas', 'estadisticas', 'operacion', 'configuracion', 'facturacion'])

function workspaceViewFromUrl() {
  const requested = new URLSearchParams(window.location.search).get('view')
  return WORKSPACE_VIEWS.has(requested) ? requested : 'resumen'
}

function updateWorkspaceViewUrl(view, replace = false) {
  const url = new URL(window.location.href)
  if (view === 'resumen') url.searchParams.delete('view')
  else url.searchParams.set('view', view)
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history[replace ? 'replaceState' : 'pushState']({}, '', next)
}

function SkeletonBlock({ height = 90 }) {
  return <div className="skeleton" style={{ height, width: '100%', marginBottom: 10 }} />
}

export default function App({ barberiaId, barberiaNombre, vertical: _vertical, demoMode = false, demoSessionId = null }) {
  // Demo mode deliberately reuses every local branch of the real panel while
  // making the Supabase adapter unavailable. This keeps the tenant boundary
  // explicit: no demo callback can reach an authenticated or server adapter.
  const isSupabaseConfigured = supabaseConfigured && !demoMode
  const demoSnapshot = demoMode ? getDemoSnapshot(demoSessionId) : null
  const themeKey = demoMode ? 'austral-demo-theme' : tenantStorageKey('theme', barberiaId)
  const [view, setView] = useState(workspaceViewFromUrl)
  const [turnos, setTurnos] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.turnos, fallbackValue: mockTurnos }))
  const [conversaciones, setConversaciones] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.conversaciones, fallbackValue: mockConversaciones }))
  const [pacientes, setPacientes] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.pacientes, fallbackValue: mockPacientes }))
  const [notas, setNotas] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.notas, fallbackValue: mockNotas }))
  const [servicios, setServicios] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.servicios, fallbackValue: mockServicios }))
  const [barberos, setBarberos] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.barberos, fallbackValue: mockBarberos }))
  const [bloqueos, setBloqueos] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.bloqueos, fallbackValue: [] }))
  const [pagos, setPagos] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.pagos, fallbackValue: [] }))
  const [cobroTurno, setCobroTurno] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [loadedForTenant, setLoadedForTenant] = useState(null)
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [theme, setTheme] = useState(() => initialTheme(barberiaId, demoMode ? 'austral-demo-theme' : null))
  const [newTurnoOpen, setNewTurnoOpen] = useState(false)
  const [editingTurno, setEditingTurno] = useState(null)
  const [turnoFechaPrefijada, setTurnoFechaPrefijada] = useState(null)
  const [notasFiltro, setNotasFiltro] = useState('')
  const [botActivo, setBotActivo] = useState(() => (demoMode ? false : !isSupabaseConfigured))
  const [whatsappIntegration, setWhatsappIntegration] = useState(() => (demoMode ? { loading: false, configured: false, connected: false, automationEnabled: false, estado: 'no_disponible' } : { loading: isSupabaseConfigured, configured: !isSupabaseConfigured, connected: !isSupabaseConfigured, automationEnabled: false }))
  const [whatsappEntitlement, setWhatsappEntitlement] = useState(() => (demoMode ? { loading: false, entitlementLoading: false, entitled: false, entitlement: 'blocked' } : { loading: isSupabaseConfigured, entitlementLoading: isSupabaseConfigured, entitled: !isSupabaseConfigured, entitlement: isSupabaseConfigured ? 'checking' : 'allowed' }))
  const [tenantBranding, setTenantBranding] = useState(() => demoSnapshot?.tenantBranding || null)
  const [horariosDefault, setHorariosDefault] = useState(() => demoSnapshot?.horariosDefault || ({ dias: [1, 2, 3, 4, 5], inicio: '09:00', fin: '18:00', breaks: [] }))
  const [zonaHoraria, setZonaHoraria] = useState(() => demoSnapshot?.zonaHoraria || TZ)
  const [dbError, setDbError] = useState('')
  // Errores de sistema (red/base) admiten "Reintentar"; las validaciones no.
  const [errorRecuperable, setErrorRecuperable] = useState(false)
  // Avisos informativos: no son errores y no van en rojo.
  const [aviso, setAviso] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const barberoWritesRef = useRef({})
  const servicioWritesRef = useRef({})
  const mainRef = useRef(null)
  const routeFocusPendingRef = useRef(false)

  useEffect(() => {
    const handlePopState = () => {
      const nextView = workspaceViewFromUrl()
      setNotasFiltro('')
      setView((currentView) => {
        routeFocusPendingRef.current = currentView !== nextView
        return nextView
      })
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const reportError = useCallback((mensaje, error) => {
    reportClientError(error, { source: 'workspace', tenant_id: barberiaId, user_message: mensaje })
    // El detalle técnico queda sólo en observabilidad; el panel muestra una
    // instrucción comprensible y nunca expone códigos/RPC al usuario.
    setErrorRecuperable(true)
    setDbError(mensaje)
  }, [barberiaId])

  const mostrarValidacion = (mensaje) => {
    setErrorRecuperable(false)
    setDbError(mensaje)
  }

  useEffect(() => {
    if (!demoMode || !demoSessionId) return undefined
    const syncFromStorage = () => {
      const snapshot = getDemoSnapshot(demoSessionId)
      setTurnos(snapshot.turnos)
      setConversaciones(snapshot.conversaciones)
      setPacientes(snapshot.pacientes)
      setNotas(snapshot.notas)
      setServicios(snapshot.servicios)
      setBarberos(snapshot.barberos)
      setBloqueos(snapshot.bloqueos)
      setPagos(snapshot.pagos)
      setTenantBranding(snapshot.tenantBranding)
      setHorariosDefault(snapshot.horariosDefault)
      setZonaHoraria(snapshot.zonaHoraria)
    }
    const handleUpdate = (event) => { if (event.detail?.sessionId === demoSessionId) syncFromStorage() }
    window.addEventListener('storage', handleUpdate)
    window.addEventListener('austral:demo-update', handleUpdate)
    return () => {
      window.removeEventListener('storage', handleUpdate)
      window.removeEventListener('austral:demo-update', handleUpdate)
    }
  }, [demoMode, demoSessionId])

  useEffect(() => {
    if (!demoMode || !demoSessionId) return
    saveDemoSnapshot(demoSessionId, { turnos, conversaciones, pacientes, notas, servicios, barberos, bloqueos, pagos, tenantBranding, horariosDefault, zonaHoraria })
  }, [demoMode, demoSessionId, turnos, conversaciones, pacientes, notas, servicios, barberos, bloqueos, pagos, tenantBranding, horariosDefault, zonaHoraria])

  const todayKey = todayInClinicTZ(zonaHoraria)
  const demoDefaultTurnDate = demoMode && !turnoFechaPrefijada
    ? demoBookingDate(todayKey, barberos, servicios, bloqueos, turnos, zonaHoraria)
    : (turnoFechaPrefijada || todayKey)

  useEffect(() => {
    setTheme(initialTheme(barberiaId, demoMode ? 'austral-demo-theme' : null))
  }, [barberiaId, demoMode])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(themeKey, theme)
  }, [theme, themeKey])

  const toggleTheme = () => {
    // Transición breve de colores al cambiar de tema (se omite con movimiento reducido).
    const root = document.documentElement
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      root.classList.add('theme-transition')
      window.setTimeout(() => root.classList.remove('theme-transition'), 320)
    }
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  const toggleBot = async () => {
    if (demoMode) {
      setAviso('WhatsApp está disponible al crear tu cuenta.')
      navigateFromMenu('facturacion')
      return
    }
    if (whatsappEntitlement.entitlementLoading) {
      setAviso('Estamos verificando el plan antes de configurar WhatsApp. Intentá nuevamente en unos segundos.')
      return
    }
    if (!whatsappEntitlement.entitled) {
      setAviso(whatsappEntitlement.entitlement === 'unavailable'
        ? 'No pudimos verificar la habilitación de WhatsApp. Revisá Facturación antes de activarlo.'
        : 'WhatsApp requiere un plan habilitado. Revisá Facturación para continuar.')
      navigateFromMenu('facturacion')
      return
    }
    // El control del sidebar no habilita automatizaciones ni escribe
    // `config.bot_activo` desde el navegador (la única excepción es la pausa
    // por respuesta manual en sendMensaje). La conexión y cualquier futura
    // activación se gestionan desde la superficie server-side de WhatsApp,
    // con guard de owner/admin, tenant y entorno.
    navigateFromMenu('configuracion')
    setAviso('Gestioná la conexión de WhatsApp desde Configuración.')
    return
  }

  // Reanuda la respuesta automática después de un traspaso manual. La
  // política de `config` sólo permite escribir al owner; para otros roles la
  // base rechaza el cambio y lo explicamos sin tratarlo como falla técnica.
  const [reanudandoBot, setReanudandoBot] = useState(false)
  const reanudarBot = async () => {
    if (!isSupabaseConfigured || reanudandoBot) return
    setReanudandoBot(true)
    try {
      const { data, error } = await supabase
        .from('config')
        .upsert({ barberia_id: barberiaId, clave: 'bot_activo', valor: 'true' })
        .select('clave')
      if (error || !data?.length) {
        const sinPermiso = !error || error.code === '42501' || /row-level security|permission/i.test(String(error.message || ''))
        if (sinPermiso) mostrarValidacion('Sólo el dueño del negocio puede reanudar el bot de WhatsApp.')
        else reportError('No se pudo reanudar el bot de WhatsApp', error)
        return
      }
      setBotActivo(true)
      setAviso('El bot de WhatsApp volvió a responder automáticamente.')
    } catch (error) {
      reportError('No se pudo reanudar el bot de WhatsApp', error)
    } finally {
      setReanudandoBot(false)
    }
  }

  const verNotasDePaciente = (nombre) => {
    navigateFromMenu('notas')
    setNotasFiltro(nombre)
  }

  const navigateFromMenu = (v, { replace = false } = {}) => {
    if (!WORKSPACE_VIEWS.has(v)) return
    setNotasFiltro('')
    routeFocusPendingRef.current = v !== view
    updateWorkspaceViewUrl(v, replace)
    setView(v)
  }

  // Cada vista arranca desde arriba: antes, al cambiar de pestaña en el
  // celular, la vista nueva aparecía desplazada donde había quedado la anterior.
  const vistaAnteriorRef = useRef(view)
  useEffect(() => {
    if (vistaAnteriorRef.current === view) return
    vistaAnteriorRef.current = view
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }, [view])

  useEffect(() => {
    if (!routeFocusPendingRef.current) return undefined
    routeFocusPendingRef.current = false
    const frame = window.requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [view])

  useEffect(() => {
    if (!isSupabaseConfigured) return

    setLoading(true)
    setLoadedForTenant(null)

    async function cargarTurnos() {
      const { data, error } = await supabase
        .from('turnos').select('*').eq('barberia_id', barberiaId).order('fecha').order('hora')
      if (cancelado) return
      if (error) { reportError('No se pudieron cargar los turnos', error); return }
      setTurnos((data ?? []).map(turnoFromDb))
    }

    async function cargarBarberia() {
      const { data, error } = await supabase
        .from('barberias').select('nombre, logo_url, color_principal, color_secundario, zona_horaria').eq('id', barberiaId).maybeSingle()
      if (cancelado) return
      if (error) reportError('No se pudo cargar la zona horaria del negocio', error)
      if (data?.zona_horaria) setZonaHoraria(data.zona_horaria)
      if (data) setTenantBranding(data)
    }

    async function cargarClientes() {
      const { data, error } = await supabase.from('clientes').select('*').eq('barberia_id', barberiaId)
      if (cancelado) return []
      if (error) { reportError('No se pudieron cargar los clientes', error); return null }
      setPacientes(data ?? [])
      return data ?? []
    }

    async function cargarNotas() {
      const { data, error } = await supabase
        .from('notas').select('*').eq('barberia_id', barberiaId).order('fecha', { ascending: false })
      if (cancelado) return
      if (error) { reportError('No se pudieron cargar las notas', error); return }
      setNotas(data ?? [])
    }

    async function cargarServicios() {
      const { data, error } = await supabase
        .from('servicios').select('*').eq('barberia_id', barberiaId).order('nombre')
      if (cancelado) return
      if (error) reportError('No se pudieron cargar los servicios', error)
      if (data) setServicios(data.map(servicioFromDb))
    }

    async function cargarBarberos() {
      const { data, error } = await supabase
        .from('barberos').select('*').eq('barberia_id', barberiaId).order('nombre')
      if (cancelado) return
      if (error) reportError('No se pudieron cargar los barberos', error)
      // OJO: "habilidades" queda tal cual viene de la base (texto JSON), no
      // se parsea acá. El único lugar que la convierte a array es
      // parseHabilidades() (lib/text.js), justo antes de usarla. Si se
      // parsea acá Y en parseHabilidades, el segundo parseo se rompe
      // (JSON.parse de un array ya parseado tira error) y todas las
      // habilidades quedan "vacías" apenas se recarga la lista.
      if (!data) return

      const ids = data.map((barbero) => barbero.id)
      if (!ids.length) {
        setBarberos([])
        return
      }

      const [serviciosResult, agendaResult] = await Promise.all([
        supabase.from('barbero_servicios').select('barbero_id, servicio_id, duracion_min').in('barbero_id', ids),
        supabase.from('horarios_barbero').select('barbero_id, day_of_week, start_time, end_time, activo').eq('barberia_id', barberiaId).in('barbero_id', ids),
      ])
      if (cancelado) return
      if (serviciosResult.error) reportError('No se pudieron cargar los servicios del equipo', serviciosResult.error)
      if (agendaResult.error) reportError('No se pudieron cargar los horarios del equipo', agendaResult.error)
      const serviciosCargados = !serviciosResult.error
      const agendaCargada = !agendaResult.error

      const servicesByBarbero = (serviciosResult.data ?? []).reduce((acc, item) => { (acc[String(item.barbero_id)] ||= []).push(item); return acc }, {})
      const agendaByBarbero = (agendaResult.data ?? []).reduce((acc, item) => { (acc[String(item.barbero_id)] ||= []).push(item); return acc }, {})

      setBarberos(data.map((barbero) => barberoFromDb(
        barbero,
        servicesByBarbero[String(barbero.id)] ?? [],
        agendaByBarbero[String(barbero.id)] ?? [],
        serviciosCargados,
        agendaCargada,
      )))
    }

    async function cargarConfig() {
      const { data, error } = await supabase
        .from('config').select('*').eq('barberia_id', barberiaId).in('clave', ['bot_activo', 'horarios_default'])
      if (cancelado) return
      if (error) {
        reportError('No se pudo cargar la configuración inicial', error)
      }
      const botConfig = data?.find((item) => item.clave === 'bot_activo')
      if (botConfig) setBotActivo(botConfig.valor === 'true')
      const horariosConfig = data?.find((item) => item.clave === 'horarios_default')
      if (horariosConfig) {
        try {
          const parsed = JSON.parse(horariosConfig.valor)
          if (Array.isArray(parsed.dias) && parsed.inicio && parsed.fin) setHorariosDefault({ dias: parsed.dias, inicio: parsed.inicio, fin: parsed.fin, breaks: Array.isArray(parsed.breaks) ? parsed.breaks : [] })
        } catch { reportError('No se pudo interpretar el horario por defecto', new Error('JSON inválido')) }
      }
      // La integración propia del tenant es la fuente de verdad para
      // habilitar el bot. Se consulta después de leer la preferencia local
      // para que un tenant sin conexión nunca quede visualmente activo.
      await Promise.all([cargarIntegracionWhatsApp(), cargarBillingEntitlement()])
    }

    async function cargarBillingEntitlement() {
      const { data, error } = await supabase.rpc('get_billing_portal', { p_barberia_id: barberiaId })
      if (cancelado) return
      if (error) {
        const missing = error.code === 'P0002' || /no tiene una suscripci[oó]n|no hay una suscripci[oó]n/i.test(String(error.message || ''))
        setWhatsappEntitlement({ loading: false, entitlementLoading: false, entitled: false, entitlement: missing ? 'blocked' : 'unavailable' })
        return
      }
      const accessState = data?.access_state || data?.subscription?.estado
      const entitled = ['active', 'trialing', 'past_due'].includes(accessState)
      setWhatsappEntitlement({ loading: false, entitlementLoading: false, entitled, entitlement: entitled ? 'allowed' : 'blocked', accessState })
    }

    async function cargarIntegracionWhatsApp() {
      let result
      try {
        result = MANAGED_WHATSAPP_PROVISIONING
          ? await supabase.functions.invoke(WHATSAPP_PROVISION_FUNCTION, { body: { action: 'status', tenant_id: barberiaId } })
          : await supabase
            .from('saas_integraciones')
            .select('id, proveedor, estado, metadata')
            .eq('barberia_id', barberiaId)
            .eq('proveedor', 'evolution')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
      } catch (error) {
        if (cancelado) return
        reportError('No se pudo verificar la integración de WhatsApp', error)
        setWhatsappIntegration((previous) => ({ ...previous, loading: false, statusUnavailable: true, connectionStatus: previous.connected ? 'CONNECTED' : 'STATUS_UNAVAILABLE' }))
        setBotActivo(false)
        return
      }
      const { data, error } = result
      if (cancelado) return
      if (error) {
        reportError('No se pudo verificar la integración de WhatsApp', error)
        setWhatsappIntegration((previous) => ({ ...previous, loading: false, statusUnavailable: true, connectionStatus: previous.connected ? 'CONNECTED' : 'STATUS_UNAVAILABLE' }))
        setBotActivo(false)
        return
      }
      if (MANAGED_WHATSAPP_PROVISIONING) {
        const connection = data?.connection
        const state = String(connection?.state || 'NOT_CONFIGURED')
        const configured = state !== 'NOT_CONFIGURED'
        const connected = state === 'CONNECTED'
        const automationEnabled = connection?.automation_enabled === true
        setWhatsappIntegration({ loading: false, configured, connected, automationEnabled, outboundEnabled: connection?.outbound_enabled === true, bookingEnabled: connection?.booking_enabled === true, estado: connected ? 'conectado' : state.toLowerCase(), connectionStatus: state, statusUnavailable: false })
        if (!connected || !automationEnabled) setBotActivo(false)
        return
      }
      const configured = Boolean(data)
      const connected = data?.estado === 'conectado'
      const automationEnabled = data?.metadata?.automation_enabled === true
      setWhatsappIntegration({ loading: false, configured, connected, automationEnabled, outboundEnabled: data?.metadata?.outbound_enabled === true, bookingEnabled: data?.metadata?.booking_enabled === true, estado: data?.estado || 'pendiente', connectionStatus: data?.estado || 'NOT_CONFIGURED', statusUnavailable: false })
      if (!connected || !automationEnabled) setBotActivo(false)
    }

    async function cargarBloqueos() {
      const { data, error } = await supabase
        .from('bloqueos_agenda').select('*').eq('barberia_id', barberiaId).order('fecha')
      if (cancelado) return
      if (error) { reportError('No se pudieron cargar los días libres', error); return }
      setBloqueos(data ?? [])
    }

    async function cargarPagos() {
      const { data, error } = await supabase
        .from('pagos').select('*').eq('barberia_id', barberiaId).order('created_at', { ascending: false })
      if (cancelado) return
      if (error) { reportError('No se pudieron cargar los pagos', error); return }
      setPagos(data ?? [])
    }

    async function cargarMensajes(clientesPromise = null) {
      const mensajesPromise = supabase.from('mensajes').select('*').eq('barberia_id', barberiaId).order('created_at')
      const [mensajesResult, clientesData] = await Promise.all([
        mensajesPromise,
        clientesPromise || supabase.from('clientes').select('id, nombre').eq('barberia_id', barberiaId).then(({ data }) => data ?? []),
      ])
      if (cancelado) return
      const { data, error } = mensajesResult
      if (error) { reportError('No se pudieron cargar los mensajes', error); return }

      // Agrupamos por cliente_id, NO por nombre. Si agrupáramos por nombre,
      // un mismo cliente puede aparecer duplicado apenas el texto no calza
      // exacto (ej: se cargó "Lauta" desde Agendar o desde el bot, y en el
      // mensaje quedó guardado "Lauta Gómez" — dos claves distintas, mismo
      // cliente). El cliente_id no cambia nunca, así que es la clave correcta.
      const nombrePorClienteId = Object.fromEntries((clientesData ?? []).map((c) => [c.id, c.nombre]))
      const agrupados = {}
      for (const m of data ?? []) {
        const key = m.cliente_id != null ? `id-${m.cliente_id}` : `sin-id-${m.paciente}`
        if (!agrupados[key]) {
          agrupados[key] = { id: key, paciente: m.paciente, clienteId: m.cliente_id ?? null, ultimaHora: m.hora, ultimoCreatedAt: m.created_at, noLeido: false, mensajes: [] }
        }
        agrupados[key].mensajes.push(m)
        agrupados[key].ultimaHora = m.hora
        agrupados[key].ultimoCreatedAt = m.created_at
        // OJO: el nombre a mostrar NO sale de m.paciente (eso queda
        // congelado con el nombre/apodo de WhatsApp de cuando se guardó
        // ese mensaje puntual). Mostramos siempre el nombre ACTUAL de la
        // ficha del cliente, que es el que el bot corrige cuando confirma
        // el nombre y apellido real. Si el cliente no tiene ficha (caso
        // raro), usamos el de m.paciente como respaldo.
        if (m.cliente_id) agrupados[key].clienteId = m.cliente_id
        agrupados[key].paciente = nombrePorClienteId[agrupados[key].clienteId] ?? m.paciente
        if (!m.leido) agrupados[key].noLeido = true
      }

      // Clientes que todavia no le escribieron nunca a la barberia: se agregan
      // igual, con el chat vacio, y quedan siempre al final de la lista.
      // Se chequea por id de cliente (no por nombre) para no duplicar chats.
      for (const c of clientesData ?? []) {
        const key = `id-${c.id}`
        if (agrupados[key]) continue
        agrupados[key] = {
          id: key,
          paciente: c.nombre,
          clienteId: c.id,
          ultimaHora: null,
          ultimoCreatedAt: new Date(0).toISOString(),
          noLeido: false,
          mensajes: [],
        }
      }

      const lista = Object.values(agrupados).sort(
        (a, b) => new Date(b.ultimoCreatedAt) - new Date(a.ultimoCreatedAt)
      )
      setConversaciones(lista)
    }

    let channel = null
    let cancelado = false

    // Realtime dispara un evento por fila: una conversación del bot o una
    // edición masiva generan ráfagas. Agrupamos cada ráfaga en una sola
    // recarga por tabla en vez de repetir la consulta completa N veces.
    const recargasPendientes = new Map()
    const programarRecarga = (clave, recargar) => {
      if (cancelado) return
      window.clearTimeout(recargasPendientes.get(clave))
      recargasPendientes.set(clave, window.setTimeout(() => {
        recargasPendientes.delete(clave)
        if (!cancelado) recargar()
      }, 400))
    }

    async function cargarTodo() {
      const clientesPromise = cargarClientes()
      const mensajesPromise = cargarMensajes(clientesPromise)
      // El panel se libera cuando están disponibles los datos que hacen
      // coherentes Resumen y Agenda. Notas, mensajes y pagos siguen en
      // paralelo como datos secundarios y no bloquean ese primer render.
      cargarPagos()
      const secondaryPromise = Promise.all([cargarNotas(), mensajesPromise])
      await Promise.all([
        cargarBarberia(),
        clientesPromise,
        cargarTurnos(),
        cargarServicios(),
        cargarBarberos(),
        cargarConfig(),
        cargarBloqueos(),
      ])
      if (cancelado) return
      setLoading(false)
      setLoadedForTenant(barberiaId)
      clearWorkspaceTransition()
      await secondaryPromise
    }

    cargarTodo()

    async function suscribirRealtime() {
      // Forzamos que la conexion de Realtime lleve el token de la sesion
      // logueada. Sin esto, el socket puede quedar autenticado como "anon"
      // aunque el usuario ya haya iniciado sesion en la app, y entonces
      // las politicas RLS (is_barberia_member) bloquean todos los eventos
      // en tiempo real aunque las consultas normales funcionen bien.
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (token) {
        await supabase.realtime.setAuth(token)
      }

      if (cancelado) return

      channel = supabase
      .channel(`dashboard-realtime-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensajes', filter: `barberia_id=eq.${barberiaId}` }, (payload) => {
        // Nunca imprimir el payload: puede contener texto, teléfonos o datos
        // de clientes. En desarrollo sólo dejamos el tipo de evento.
        if (import.meta.env.DEV) console.debug('[realtime] mensaje actualizado', { event: payload.event })
        programarRecarga('mensajes', () => cargarMensajes())
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('turnos', cargarTurnos))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notas', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('notas', cargarNotas))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('clientes', () => { const clientesPromise = cargarClientes(); cargarMensajes(clientesPromise) }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('servicios', cargarServicios))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'barberos', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('barberos', cargarBarberos))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('config', cargarConfig))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'saas_integraciones', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('integracion', cargarIntegracionWhatsApp))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bloqueos_agenda', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('bloqueos', cargarBloqueos))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos', filter: `barberia_id=eq.${barberiaId}` }, () => programarRecarga('pagos', cargarPagos))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          realtimeActivo = true
          pollDelay = 15000
          detenerFallback()
          if (import.meta.env.DEV) console.debug('[realtime] conectado OK')
        } else if (!cancelado && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')) {
          realtimeActivo = false
          activarFallback()
          // El error completo puede incluir datos del transporte; el estado
          // es suficiente para diagnosticar y evita filtrarlo en producción.
          if (import.meta.env.DEV) console.warn('[realtime] problema con la suscripcion:', status)
        }
      })
    }

    // Realtime es la fuente primaria. Sólo activamos un fallback con backoff
    // cuando el canal no logra conectarse o se cae, evitando cuatro consultas
    // repetidas cada seis segundos mientras la conexión está sana.
    let realtimeActivo = false
    let pollingTimer = null
    let pollDelay = 15000
    const cargarFallback = async () => {
      if (cancelado || realtimeActivo) return
      const clientesPromise = cargarClientes()
      await Promise.all([cargarTurnos(), cargarMensajes(clientesPromise), cargarPagos()])
      if (!cancelado && !realtimeActivo) {
        pollingTimer = window.setTimeout(() => {
          pollingTimer = null
          cargarFallback()
        }, pollDelay)
        pollDelay = Math.min(pollDelay * 2, 60000)
      }
    }
    const activarFallback = () => {
      if (cancelado || realtimeActivo || pollingTimer) return
      pollingTimer = window.setTimeout(() => {
        pollingTimer = null
        cargarFallback()
      }, pollDelay)
    }
    const detenerFallback = () => {
      if (pollingTimer) window.clearTimeout(pollingTimer)
      pollingTimer = null
    }

    activarFallback()
    suscribirRealtime()

    return () => {
      cancelado = true
      for (const timer of recargasPendientes.values()) window.clearTimeout(timer)
      recargasPendientes.clear()
      if (channel) supabase.removeChannel(channel)
      detenerFallback()
    }
  }, [barberiaId, isSupabaseConfigured, reloadKey, reportError])

  if (isSupabaseConfigured && (loading || loadedForTenant !== barberiaId)) {
    return <WorkspacePreparing businessName={barberiaNombre || DEFAULT_BUSINESS_NAME} />
  }

  // Borrado optimista: saca el elemento al instante y, si la base lo
  // rechaza, lo restaura en su posición original y avisa.
  const eliminarOptimista = async (lista, setLista, id, tabla, mensajeError) => {
    const anterior = lista.find((item) => item.id === id)
    const indiceAnterior = lista.findIndex((item) => item.id === id)
    setLista((prev) => prev.filter((item) => item.id !== id))
    if (!isSupabaseConfigured) return true
    let error
    try {
      ({ error } = await supabase.from(tabla).delete().eq('id', id))
    } catch (thrown) {
      error = thrown
    }
    if (!error) return true
    setLista((prev) => {
      if (!anterior || prev.some((item) => item.id === id)) return prev
      const restaurados = [...prev]
      restaurados.splice(Math.max(0, Math.min(indiceAnterior, restaurados.length)), 0, anterior)
      return restaurados
    })
    reportError(mensajeError, error)
    return false
  }


  const addNota = async (nueva) => {
    const conFecha = { ...nueva, fecha: todayKey }
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('notas').insert({ ...conFecha, barberia_id: barberiaId }).select()
        if (error) { reportError('No se pudo guardar la nota', error); return false }
        if (data?.[0]) setNotas((prev) => [data[0], ...prev])
        return true
      } catch (error) {
        reportError('No se pudo guardar la nota', error)
        return false
      }
    }
    setNotas((prev) => [{ id: nextLocalId(prev), ...conFecha }, ...prev])
    return true
  }

  const openConversation = async (convId) => {
    setSelectedConversationId(convId)
    navigateFromMenu('mensajes')

    const conv = conversaciones.find((c) => c.id === convId)

    setConversaciones((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, noLeido: false, mensajes: c.mensajes.map((m) => ({ ...m, leido: true })) } : c))
    )

    if (isSupabaseConfigured && conv) {
      const base = supabase.from('mensajes').update({ leido: true }).eq('barberia_id', barberiaId).eq('leido', false)
      const { error } = conv.clienteId != null
        ? await base.eq('cliente_id', conv.clienteId)
        : await base.eq('paciente', conv.paciente)
      if (error) reportError('No se pudo marcar la conversación como leída', error)
    }
  }

  const updateTurnoEstado = async (turnoId, nuevoEstado) => {
    const estadoAnterior = turnos.find((t) => t.id === turnoId)?.estado
    setTurnos((prev) => prev.map((t) => (t.id === turnoId ? { ...t, estado: nuevoEstado } : t)))
    if (!isSupabaseConfigured) return true
    try {
      const { error } = await supabase.from('turnos').update({ estado: nuevoEstado }).eq('id', turnoId)
      if (error) {
        setTurnos((prev) => prev.map((t) => (t.id === turnoId ? { ...t, estado: estadoAnterior } : t)))
        reportError('No se pudo actualizar el estado del turno', error)
        return false
      }
      return true
    } catch (error) {
      setTurnos((prev) => prev.map((t) => (t.id === turnoId ? { ...t, estado: estadoAnterior } : t)))
      reportError('No se pudo actualizar el estado del turno', error)
      return false
    }
  }

  // Antes de marcar un turno como "Atendido" pedimos cómo se cobró. El
  // estado del turno recién se actualiza cuando se confirma el cobro
  // (o si cancela el modal, el turno se queda como estaba).
  const pedirEstadoOCobro = async (turnoId, nuevoEstado) => {
    if (nuevoEstado !== 'atendido') {
      return updateTurnoEstado(turnoId, nuevoEstado)
    }
    const turno = turnos.find((t) => t.id === turnoId)
    if (turno) {
      setCobroTurno(turno)
      return true
    }
    return false
  }

  const confirmarCobro = async ({ monto, metodo }) => {
    if (!cobroTurno) return
    const turno = cobroTurno
    // Sin turno atendido no registramos el cobro: evita pagos huérfanos de
    // turnos que en la base siguen como pendientes.
    if (!(await updateTurnoEstado(turno.id, 'atendido'))) { setCobroTurno(null); return }

    const servicioDelTurno = servicios.find((s) => String(s.id) === String(turno.servicio_id))
    const nuevoPago = {
      barberia_id: barberiaId,
      turno_id: turno.id,
      cliente_id: turno.cliente_id ?? null,
      paciente: turno.paciente,
      servicio: servicioDelTurno?.nombre || turno.motivo || null,
      monto,
      metodo,
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('pagos').insert(nuevoPago).select()
      if (error) { reportError('El turno quedó marcado como atendido, pero no se pudo registrar el cobro', error); setCobroTurno(null); return }
      if (data?.[0]) setPagos((prev) => [data[0], ...prev])
    } else {
      setPagos((prev) => [{ id: nextLocalId(prev), ...nuevoPago, created_at: new Date().toISOString() }, ...prev])
    }
    setCobroTurno(null)
  }

  const deleteTurno = (turnoId) => eliminarOptimista(turnos, setTurnos, turnoId, 'turnos', 'No se pudo eliminar el turno')

  const saveTurno = async ({ paciente, telefono, clienteId, fecha, hora, motivo, estado, servicio_id, barbero_id, precio, duracion }, existingId) => {
    const servicio = servicios.find((item) => String(item.id) === String(servicio_id))
    const barbero = barberos.find((item) => String(item.id) === String(barbero_id))
    const duracionReal = duracionServicioBarbero(barbero, servicio, duracion)
    if (!servicio || !barbero || !barbero.activo || !barberoRealizaServicio(barbero, servicio)) {
      mostrarValidacion('El profesional seleccionado ya no realiza ese servicio. Elegí otro profesional.')
      return false
    }
    const horaMinutos = (value) => {
      const [hours, minutes] = String(value || '').slice(0, 5).split(':').map(Number)
      return (Number(hours) || 0) * 60 + (Number(minutes) || 0)
    }
    const superpuesto = turnos.some((turno) => {
      if (turno.id === existingId || turno.fecha !== fecha || String(turno.barbero_id) !== String(barbero_id)) return false
      if (['cancelado', 'no_asistio'].includes(statusMeta(turno.estado).value)) return false
      const start = horaMinutos(hora)
      const otherStart = horaMinutos(turno.hora)
      return start < otherStart + Number(turno.duracion || turno.duracion_min || 30) && otherStart < start + duracionReal
    })
    if (superpuesto) {
      mostrarValidacion('Ese horario acaba de ocuparse. Elegí otro horario.')
      return false
    }
    // Resolvemos el cliente ANTES de tocar el turno: si no vino ya elegido
    // pero hay teléfono, buscamos por teléfono (así no se duplica un
    // cliente que ya existe con otro formato de nombre) y si no existe,
    // se crea. El turno siempre queda linkeado por cliente_id, no por el
    // texto del nombre.
    let finalClienteId = clienteId ?? null

    if (!finalClienteId && telefono) {
      const existente = pacientes.find((p) => p.telefono === telefono)
      if (existente) {
        finalClienteId = existente.id
      } else {
        const nuevoPaciente = { nombre: paciente, telefono, ultima_visita: null, proximo_turno: fecha }
        if (isSupabaseConfigured) {
          const { data, error } = await supabase.from('clientes').insert({ ...nuevoPaciente, barberia_id: barberiaId }).select()
          if (error) {
            // Sin ficha el turno quedaría desvinculado del cliente (sin
            // historial ni teléfono para WhatsApp), así que no lo creamos.
            reportError('No se pudo guardar el cliente nuevo', error)
            return false
          } else if (data?.[0]) {
            setPacientes((prev) => [...prev, data[0]])
            finalClienteId = data[0].id
          }
        } else {
          const nuevo = { id: nextLocalId(pacientes), ...nuevoPaciente }
          setPacientes((prev) => [...prev, nuevo])
          finalClienteId = nuevo.id
        }
      }
    }

    const payload = { paciente, fecha, hora, motivo, estado, servicio_id, barbero_id, precio, duracion: duracionReal, clienteId: finalClienteId }
    const dbPayload = {
      paciente,
      fecha,
      hora,
      motivo,
      estado,
      servicio_id,
      barbero_id,
      precio,
      duracion_min: duracionReal,
      cliente_id: finalClienteId,
      telefono: telefono ? soloDigitos(telefono) : null,
    }

    if (existingId) {
      const turnoAnterior = turnos.find((t) => t.id === existingId)
      setTurnos((prev) => prev.map((t) => (t.id === existingId ? { ...t, ...payload, cliente_id: finalClienteId } : t)))
      if (isSupabaseConfigured) {
        const { error } = await supabase.from('turnos').update(dbPayload).eq('id', existingId)
        if (error) {
          if (turnoAnterior) setTurnos((prev) => prev.map((t) => (t.id === existingId ? turnoAnterior : t)))
          const mensaje = mensajeErrorTurno(error)
          if (mensaje) mostrarValidacion(mensaje)
          else reportError('No se pudo guardar el turno', error)
          return false
        }
      }
      return true
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('turnos').insert({ ...dbPayload, barberia_id: barberiaId }).select()
      if (error) {
        const mensaje = mensajeErrorTurno(error)
        if (mensaje) mostrarValidacion(mensaje)
        else reportError('No se pudo crear el turno', error)
        return false
      }
      if (data?.[0]) setTurnos((prev) => [...prev, turnoFromDb(data[0])])
    } else {
      setTurnos((prev) => [...prev, { id: nextLocalId(prev), ...payload, cliente_id: finalClienteId, origen: existingId ? undefined : 'panel' }])
    }
    return true
  }

  const openNewTurno = () => { setDbError(''); setEditingTurno(null); setTurnoFechaPrefijada(null); setNewTurnoOpen(true) }
  const openNewTurnoConFecha = (fecha) => { setDbError(''); setEditingTurno(null); setTurnoFechaPrefijada(fecha); setNewTurnoOpen(true) }
  const openEditTurno = (turno) => { setDbError(''); setEditingTurno(turno); setTurnoFechaPrefijada(null); setNewTurnoOpen(true) }
  const closeTurnoModal = () => { setNewTurnoOpen(false); setEditingTurno(null); setTurnoFechaPrefijada(null) }

  const addPaciente = async (datos) => {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('clientes').insert({ ...datos, barberia_id: barberiaId }).select()
      if (error) {
        if (error.code === '23505') reportError('Ya existe un cliente con ese telefono', error)
        else reportError('No se pudo crear el cliente', error)
        return false
      }
      if (data?.[0]) setPacientes((prev) => [...prev, data[0]])
      return true
    }
    setPacientes((prev) => [...prev, { id: nextLocalId(prev), ...datos }])
    return true
  }

  const updatePaciente = async (id, cambios) => {
    const anterior = pacientes.find((p) => p.id === id)
    setPacientes((prev) => prev.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
    if (!isSupabaseConfigured) return true
    try {
      const { error } = await supabase.from('clientes').update(cambios).eq('id', id)
      if (error) {
        if (anterior) setPacientes((prev) => prev.map((p) => (p.id === id ? anterior : p)))
        reportError('No se pudo actualizar el cliente', error)
        return false
      }
      return true
    } catch (error) {
      if (anterior) setPacientes((prev) => prev.map((p) => (p.id === id ? anterior : p)))
      reportError('No se pudo actualizar el cliente', error)
      return false
    }
  }

  const deletePaciente = (id) => eliminarOptimista(pacientes, setPacientes, id, 'clientes', 'No se pudo eliminar el cliente')

  const updateNota = async (id, texto) => {
    const anterior = notas.find((n) => n.id === id)
    setNotas((prev) => prev.map((n) => (n.id === id ? { ...n, texto } : n)))
    if (!isSupabaseConfigured) return true
    try {
      const { error } = await supabase.from('notas').update({ texto }).eq('id', id)
      if (error) {
        if (anterior) setNotas((prev) => prev.map((n) => (n.id === id ? anterior : n)))
        reportError('No se pudo actualizar la nota', error)
        return false
      }
      return true
    } catch (error) {
      if (anterior) setNotas((prev) => prev.map((n) => (n.id === id ? anterior : n)))
      reportError('No se pudo actualizar la nota', error)
      return false
    }
  }

  const deleteNota = (id) => eliminarOptimista(notas, setNotas, id, 'notas', 'No se pudo eliminar la nota')

  const sendMensaje = async (paciente, texto, clienteId) => {
    const horaActual = new Intl.DateTimeFormat('es-AR', { timeZone: zonaHoraria || TZ, hour: '2-digit', minute: '2-digit' }).format(new Date())
    const nuevoMensaje = { paciente, texto, de: 'clinica', hora: horaActual, leido: true, cliente_id: clienteId ?? null }
    const esLaConversacion = (c) => (clienteId != null ? c.clienteId === clienteId : c.paciente === paciente)
    const conversacionAnterior = conversaciones.find(esLaConversacion)
    const mensajesAnteriores = conversacionAnterior?.mensajes ?? []

    setConversaciones((prev) => {
      const actualizadas = prev.map((c) =>
        esLaConversacion(c) ? { ...c, mensajes: [...c.mensajes, nuevoMensaje], ultimaHora: horaActual, ultimoCreatedAt: new Date().toISOString() } : c
      )
      const idx = actualizadas.findIndex(esLaConversacion)
      if (idx <= 0) return actualizadas
      const [conv] = actualizadas.splice(idx, 1)
      return [conv, ...actualizadas]
    })

    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.from('mensajes').insert({ ...nuevoMensaje, barberia_id: barberiaId })
        if (error) {
        setConversaciones((prev) => prev.map((c) => {
          if (!esLaConversacion(c)) return c
          return { ...c, mensajes: mensajesAnteriores, ultimaHora: conversacionAnterior?.ultimaHora ?? null, ultimoCreatedAt: conversacionAnterior?.ultimoCreatedAt ?? new Date(0).toISOString() }
        }))
        reportError('No se pudo guardar el mensaje', error)
          // Sin registro en el panel no lo enviamos: el cliente recibiría un
          // mensaje que nadie del equipo puede ver. El chat conserva el borrador.
          return false
        }
      } catch (error) {
        setConversaciones((prev) => prev.map((c) => {
          if (!esLaConversacion(c)) return c
          return { ...c, mensajes: mensajesAnteriores, ultimaHora: conversacionAnterior?.ultimaHora ?? null, ultimoCreatedAt: conversacionAnterior?.ultimoCreatedAt ?? new Date(0).toISOString() }
        }))
        reportError('No se pudo guardar el mensaje', error)
        return false
      }
    }

    // El envío real pasa por una edge function autenticada: valida la
    // membresía del usuario y toma el teléfono de la ficha del cliente. El
    // navegador nunca conoce la URL del webhook de n8n.
    const telefono = clienteId ? pacientes.find((p) => p.id === clienteId)?.telefono : null
    if (!telefono) {
      reportError('No se pudo enviar por WhatsApp', new Error('Este cliente no tiene un teléfono cargado en su ficha'))
    } else if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.functions.invoke(WHATSAPP_PANEL_SEND_FUNCTION, {
          body: { tenant_id: barberiaId, cliente_id: clienteId, texto },
        })
        if (error) reportError('El mensaje se guardó pero no se pudo enviar por WhatsApp', error)
      } catch (err) {
        reportError('El mensaje se guardó pero no se pudo enviar por WhatsApp', err)
      }
    }

    // Traspaso a atención humana: una respuesta manual pausa el bot. Es la
    // única escritura de `bot_activo` desde el navegador y sólo puede apagarlo;
    // la RPC lo permite a cualquier miembro (la política de `config` es sólo
    // para owners y dejaba al bot activo si respondía otro rol).
    if (botActivo) {
      setBotActivo(false)
      if (isSupabaseConfigured) {
        let { error } = await supabase.rpc('pause_whatsapp_bot_for_manual_reply', { p_barberia_id: barberiaId })
        // Compatibilidad mientras la migración no esté aplicada: el owner
        // todavía puede pausarlo con la escritura directa.
        if (error?.code === 'PGRST202') {
          ({ error } = await supabase.from('config').upsert({ barberia_id: barberiaId, clave: 'bot_activo', valor: 'false' }))
        }
        if (error) {
          setBotActivo(true)
          reportError('No se pudo pausar el bot: puede seguir respondiendo este chat', error)
        }
      }
    }
    return true
  }

  const addServicio = async () => {
    let serviciosDisponibles = servicios
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('servicios').select('nombre').eq('barberia_id', barberiaId)
      if (!error && data) serviciosDisponibles = data
    }
    const base = { nombre: siguienteNombreServicio(serviciosDisponibles), precio: 0, duracion: 30, activo: true }
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('servicios')
        .insert({ nombre: base.nombre, precio: base.precio, duracion_min: base.duracion, activo: base.activo, barberia_id: barberiaId })
        .select()
      if (error) {
        const duplicate = error.code === '23505' || /duplicate|unique|nombre/i.test(error.message || '')
        reportError(duplicate ? 'Ya existe un servicio con ese nombre' : 'No se pudo crear el servicio', error)
        return false
      }
      if (data?.[0]) {
        const nuevoServicio = data[0]
        // Mantiene la regla previa del panel: un barbero sin restricciones
        // explícitas puede realizar los nuevos servicios de la barbería.
        const relaciones = barberos.filter((b) => b.activo).map((b) => ({ barbero_id: b.id, servicio_id: nuevoServicio.id }))
        if (relaciones.length) {
          const { error: relacionesError } = await supabase.from('barbero_servicios').insert(relaciones)
          if (relacionesError) reportError('El servicio fue creado, pero no se pudo habilitar para los barberos', relacionesError)
        }
        setServicios((prev) => [...prev, servicioFromDb(nuevoServicio)])
      }
      return true
    } else {
      setServicios((prev) => [...prev, { id: nextLocalId(prev), ...base }])
      return true
    }
  }

  // Los inputs de servicios guardan en cada tecla. Igual que updateBarbero,
  // serializamos por (servicio, campo) y mandamos siempre el último valor:
  // con updates en paralelo la base podía quedarse con uno intermedio.
  // Sólo precio y duración son numéricos (antes la descripción se volvía 0).
  const updateServicio = async (id, field, value) => {
    const parsed = ['nombre', 'descripcion'].includes(field) ? value : Number(value) || 0
    const anterior = servicios.find((s) => s.id === id)
    setServicios((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: parsed } : s)))
    if (!isSupabaseConfigured) return true
    const key = `${id}:${field}`
    return enqueueLatest(servicioWritesRef.current, key, parsed, async (valueToSave) => {
      const dbField = field === 'duracion' ? 'duracion_min' : field
      try {
        const { error } = await supabase.from('servicios').update({ [dbField]: valueToSave }).eq('id', id)
        if (!error) return true
        if (servicioWritesRef.current[key]?.latest === valueToSave && anterior) setServicios((prev) => prev.map((s) => (s.id === id ? anterior : s)))
        const duplicate = error.code === '23505' || /duplicate|unique|nombre/i.test(error.message || '')
        reportError(duplicate ? 'Ya existe un servicio con ese nombre' : 'No se pudo actualizar el servicio', error)
        return false
      } catch (error) {
        if (servicioWritesRef.current[key]?.latest === valueToSave && anterior) setServicios((prev) => prev.map((s) => (s.id === id ? anterior : s)))
        reportError('No se pudo actualizar el servicio', error)
        return false
      }
    })
  }

  const reactivarServicio = async (id) => {
    const anterior = servicios.find((s) => s.id === id)
    setServicios((prev) => prev.map((s) => (s.id === id ? { ...s, activo: true } : s)))
    if (isSupabaseConfigured) {
      try {
        const { error } = await supabase.from('servicios').update({ activo: true }).eq('id', id)
        if (error) {
          if (anterior) setServicios((prev) => prev.map((s) => (s.id === id ? anterior : s)))
          reportError('No se pudo reactivar el servicio', error)
          return false
        }
        return true
      } catch (error) {
        if (anterior) setServicios((prev) => prev.map((s) => (s.id === id ? anterior : s)))
        reportError('No se pudo reactivar el servicio', error)
        return false
      }
    }
    return true
  }

  const deleteServicio = async (id) => {
    if (!isSupabaseConfigured) {
      setServicios((prev) => prev.filter((s) => s.id !== id))
      return true
    }

    const { error } = await supabase.from('servicios').delete().eq('id', id)

    if (!error) {
      setServicios((prev) => prev.filter((s) => s.id !== id))
      return true
    }

    // Si el error es porque hay turnos que usan este servicio (foreign key),
    // no se puede borrar sin romper el historial. En vez de fallar feo,
    // lo desactivamos: deja de aparecer para agendar turnos nuevos pero
    // no rompe los turnos ya existentes que lo referencian.
    if (error.code === '23503') {
      const { data, error: updateError } = await supabase
        .from('servicios')
        .update({ activo: false })
        .eq('id', id)
        .select()
      if (updateError) {
        reportError('No se pudo desactivar el servicio', updateError)
        return false
      }
      if (data?.[0]) setServicios((prev) => prev.map((s) => (s.id === id ? servicioFromDb(data[0]) : s)))
      setAviso('Este servicio tiene turnos asociados, así que no se puede borrar sin perder ese historial. Lo desactivamos: ya no va a aparecer para agendar turnos nuevos.')
      return true
    }

    reportError('No se pudo eliminar el servicio', error)
    return false
  }

  const addBarbero = async () => {
    const base = { nombre: `Barbero ${barberos.length + 1}`, rol: 'Barbero', color: '#9B6A2F', horario: 'Lun, Mar, Mié, Jue y Vie 09:00-18:00', activo: true }
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('barberos')
        .insert({ nombre: base.nombre, especialidad: base.rol, color: base.color, horario_texto: base.horario, activo: base.activo, barberia_id: barberiaId })
        .select()
      if (error) { reportError('No se pudo crear el barbero', error); return false }
      if (data?.[0]) {
        const nuevoBarbero = data[0]
        // El alta conserva el horario inicial que muestra el panel y deja al
        // profesional disponible para los servicios activos. De esta forma la
        // reserva pública y el panel no se desincronizan al crear equipo.
        const horariosIniciales = horariosDefault.dias.flatMap((day_of_week) => {
          const breaks = horariosDefault.breaks.filter((item) => item.inicio < horariosDefault.fin && item.fin > horariosDefault.inicio)
          if (!breaks.length) return [{ barberia_id: barberiaId, barbero_id: nuevoBarbero.id, day_of_week, start_time: horariosDefault.inicio, end_time: horariosDefault.fin, activo: true }]
          const segmentos = []
          let cursor = horariosDefault.inicio
          for (const pausa of breaks.sort((a, b) => a.inicio.localeCompare(b.inicio))) {
            if (cursor < pausa.inicio) segmentos.push({ barberia_id: barberiaId, barbero_id: nuevoBarbero.id, day_of_week, start_time: cursor, end_time: pausa.inicio, activo: true })
            cursor = pausa.fin > cursor ? pausa.fin : cursor
          }
          if (cursor < horariosDefault.fin) segmentos.push({ barberia_id: barberiaId, barbero_id: nuevoBarbero.id, day_of_week, start_time: cursor, end_time: horariosDefault.fin, activo: true })
          return segmentos
        })
        const { error: horarioError } = await supabase.from('horarios_barbero').insert(horariosIniciales)
        if (horarioError) reportError('El barbero fue creado, pero no se pudieron guardar sus horarios', horarioError)
        const relaciones = servicios.filter((s) => s.activo).map((s) => ({ barbero_id: nuevoBarbero.id, servicio_id: s.id }))
        if (relaciones.length) {
          const { error: serviciosError } = await supabase.from('barbero_servicios').insert(relaciones)
          if (serviciosError) reportError('El barbero fue creado, pero no se pudieron guardar sus servicios', serviciosError)
        }
        setBarberos((prev) => [...prev, barberoFromDb(nuevoBarbero, relaciones, horariosIniciales)])
      }
      return true
    } else {
      setBarberos((prev) => [...prev, { id: nextLocalId(prev), ...base }])
      return true
    }
  }

  // Guarda, para cada (barbero, campo), cuál es el último valor que el
  // usuario pidió guardar y si ya hay un guardado en curso para ese par.
  // Así, si tocás/destocás rápido una habilidad, los guardados a Supabase
  // salen siempre de a uno y en orden — nunca se pisan entre sí ni puede
  // "ganar" un click viejo por llegar después que uno nuevo.
  const updateBarbero = async (id, field, value) => {
    const anterior = barberos.find((barbero) => barbero.id === id)
    setBarberos((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)))
    if (!isSupabaseConfigured) return

    const key = `${id}:${field}`
    const estado = barberoWritesRef.current[key] || { inFlight: false, latest: value, promise: null }
    estado.latest = value
    barberoWritesRef.current[key] = estado

    if (estado.inFlight) return estado.promise // ya hay un guardado de este campo en curso, el loop de abajo lo va a mandar solo

    const dbFieldMap = { rol: 'especialidad', horario: 'horario_texto', habilidades: 'habilidades' }
    const dbField = dbFieldMap[field] || field

    estado.inFlight = true
    estado.promise = (async () => {
      while (true) {
        const valorAGuardar = estado.latest
        const { error } = await supabase.from('barberos').update({ [dbField]: valorAGuardar }).eq('id', id)
        if (error) reportError('No se pudo actualizar el barbero', error)
        if (!error && field === 'habilidades') {
          // La pantalla heredada guarda ids derivados del nombre. Convertimos
          // esa selección al vínculo relacional que usa la reserva pública.
          // Una lista vacía conserva la semántica histórica: todos los servicios.
          const habilidades = parseHabilidades(valorAGuardar)
          const permitidos = habilidades.length === 0
            ? servicios.filter((s) => s.activo)
            : servicios.filter((s) => habilidades.includes(generarIdHabilidad(s.nombre)))
          const { error: deleteError } = await supabase.from('barbero_servicios').delete().eq('barbero_id', id)
          if (deleteError) reportError('No se pudieron actualizar los servicios del barbero', deleteError)
          else if (permitidos.length) {
            const { error: insertError } = await supabase
              .from('barbero_servicios')
              .insert(permitidos.map((s) => ({ barbero_id: id, servicio_id: s.id })))
            if (insertError) reportError('No se pudieron actualizar los servicios del barbero', insertError)
          }
          setBarberos((prev) => prev.map((barbero) => (
            barbero.id === id
              ? { ...barbero, servicios: permitidos.map((servicio) => ({ barbero_id: id, servicio_id: servicio.id })), serviciosCargados: true }
              : barbero
          )))
        }
        if (!error && field === 'horario') {
          const franjas = parseHorarioTexto(valorAGuardar)
          if (!franjas) {
            setAviso('El texto del horario se guardó, pero no pudimos convertirlo en agenda. Usá un formato como “Lun, Mar y Vie 09:00-18:00” o agregá “break 13:00-14:00”.')
          } else {
            const { error: borrarError } = await supabase.from('horarios_barbero').delete().eq('barbero_id', id)
            if (borrarError) reportError('No se pudo actualizar la agenda del barbero', borrarError)
            else {
              const { error: crearError } = franjas.length
                ? await supabase.from('horarios_barbero').insert(
                  franjas.map((franja) => ({ ...franja, barberia_id: barberiaId, barbero_id: id, activo: true }))
                )
                : { error: null }
              if (crearError) reportError('No se pudo actualizar la agenda del barbero', crearError)
              else setBarberos((prev) => prev.map((barbero) => (
                barbero.id === id ? { ...barbero, agenda: franjas.map((franja) => ({ ...franja, barbero_id: id, activo: true })), agendaCargada: true } : barbero
              )))
            }
          }
        }
        if (estado.latest === valorAGuardar) break // no llego nada nuevo mientras se guardaba, listo
        // si llego un valor mas nuevo mientras se guardaba, el loop repite y lo manda
      }
    })().catch((error) => {
      if (estado.latest === value && anterior) setBarberos((prev) => prev.map((barbero) => (barbero.id === id ? anterior : barbero)))
      reportError('No se pudo actualizar el barbero', error)
      return false
    }).finally(() => {
      estado.inFlight = false
      estado.promise = null
    })
    return estado.promise
  }

  const deleteBarbero = (id) => eliminarOptimista(barberos, setBarberos, id, 'barberos', 'No se pudo eliminar el barbero')

  const addBloqueo = async ({ barbero_id, fecha, motivo, tipo }) => {
    const nuevo = { barberia_id: barberiaId, barbero_id, fecha, motivo, tipo, start_time: '00:00', end_time: '23:59' }
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('bloqueos_agenda').insert(nuevo).select()
      if (error) { reportError('No se pudo guardar el día libre', error); return false }
      if (data?.[0]) setBloqueos((prev) => [...prev, data[0]])
      return true
    }
    setBloqueos((prev) => [...prev, { id: nextLocalId(prev), ...nuevo }])
    return true
  }

  const deleteBloqueo = (id) => eliminarOptimista(bloqueos, setBloqueos, id, 'bloqueos_agenda', 'No se pudo eliminar el día libre')

  const turnosHoy = turnos.filter((t) => t.fecha === todayKey).sort((a, b) => a.hora.localeCompare(b.hora))
  const unreadCount = conversaciones.filter((c) => c.noLeido).length
  const hoyLegible = capitalizar(format(new Date(`${todayKey}T12:00:00`), "EEEE d 'de' MMMM", { locale: es }))

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        setView={navigateFromMenu}
        clinicName={tenantBranding?.nombre || barberiaNombre || DEFAULT_BUSINESS_NAME}
        unreadCount={unreadCount}
        theme={theme}
        onToggleTheme={toggleTheme}
        botActivo={botActivo}
        onToggleBot={toggleBot}
        whatsappStatus={{ ...whatsappIntegration, ...whatsappEntitlement }}
        onConfigureWhatsApp={() => navigateFromMenu('configuracion')}
        onOpenBilling={() => navigateFromMenu('facturacion')}
        branding={tenantBranding}
        onLogout={() => (demoMode ? window.location.assign('/') : logout())}
        onAccountSecurity={() => (demoMode ? navigateFromMenu('configuracion') : window.location.assign('/cuenta'))}
        demoMode={demoMode}
      />
      <main ref={mainRef} className="main route-focus-target" tabIndex="-1">
        {demoMode ? (
          <div className="demo-mode-banner" role="status">
            <div className="demo-mode-banner__message"><Info size={15} /><span><strong>Modo demostración</strong><small>Los cambios son temporales y sólo viven en este navegador. WhatsApp está en validación y esta demo no envía mensajes.</small></span></div>
            <div className="demo-mode-banner__actions"><button type="button" className="btn btn-primary" onClick={() => window.location.assign('/registro?source=demo')}>Crear mi cuenta</button><button type="button" className="btn" onClick={() => { if (!window.confirm('¿Reiniciar la demo y borrar los cambios temporales?')) return; resetDemoSession(demoSessionId); localStorage.removeItem(`austral-demo-settings:${barberiaId}`); window.location.reload() }}>Reiniciar demo</button><button type="button" className="btn btn-ghost" onClick={() => window.location.assign('/')}>Salir</button></div>
          </div>
        ) : !isSupabaseConfigured && (
          <div className="demo-banner">
            <Info size={15} />
            Mostrando datos de ejemplo porque no pudimos conectar con la información del negocio.
          </div>
        )}

        {dbError && (
          <div className="error-banner" role="alert" aria-live="assertive">
            <AlertTriangle size={15} />
            <span>{errorRecuperable ? `${dbError.replace(/[.\s]+$/, '')}. Podés reintentar sin perder los datos visibles.` : dbError}</span>
            {isSupabaseConfigured && errorRecuperable && <button className="btn btn-ghost" type="button" onClick={() => { setDbError(''); setReloadKey((value) => value + 1) }}>Reintentar</button>}
            <button className="btn-icon-plain" type="button" onClick={() => setDbError('')} aria-label="Cerrar aviso de error" title="Cerrar aviso">
              <X size={14} />
            </button>
          </div>
        )}

        {aviso && (
          <div className="notice-banner" role="status" aria-live="polite">
            <Info size={15} aria-hidden="true" />
            <span>{aviso}</span>
            <button className="btn-icon-plain" type="button" onClick={() => setAviso('')} aria-label="Cerrar aviso" title="Cerrar aviso">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Sólo cuando hay algo que contar: WhatsApp conectado con automatización
            habilitada pero el bot en pausa. Sin conexión, el sidebar ya muestra
            el estado y la acción para configurarla; repetirlo acá era ruido fijo. */}
        {!demoMode && !botActivo && whatsappIntegration.connected && whatsappIntegration.automationEnabled && (
          <div className="demo-banner bot-paused-banner" role="status" style={{ background: 'var(--rose-soft)', color: 'var(--rose-text)' }}>
            <Bot size={15} aria-hidden="true" />
            <span>El bot de WhatsApp está en pausa: las conversaciones se atienden de forma manual desde el panel.</span>
            <button type="button" className="btn btn-ghost" onClick={reanudarBot} disabled={reanudandoBot}>{reanudandoBot ? 'Reanudando…' : 'Reanudar bot'}</button>
          </div>
        )}

        {view === 'resumen' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <p className="page-kicker">Panel diario</p>
                <h1 className="page-title">Resumen</h1>
              </div>
              <span className="page-date page-date-cap">{hoyLegible}</span>
            </div>

            {loading ? (
              <>
                <div className="stats-row">
                  {[1, 2, 3, 4].map((i) => <SkeletonBlock key={i} height={78} />)}
                </div>
                <div className="two-col">
                  <SkeletonBlock height={280} />
                  <SkeletonBlock height={280} />
                </div>
              </>
            ) : (
              <>
                <OnboardingChecklist barberiaId={barberiaId} demoMode={demoMode} onNavigate={navigateFromMenu} whatsappStatus={{ ...whatsappIntegration, ...whatsappEntitlement }} />
                <StatsCards turnos={turnosHoy} conversaciones={conversaciones} todayKey={todayKey} />
                <div className="two-col">
                  <div className="panel resumen-agenda-panel">
                    <h2 className="panel-title">
                      <span className="panel-title-icon"><CalendarCheck size={16} style={{ color: 'var(--accent)' }} />Agenda de hoy</span>
                      <button className="link-btn" onClick={openNewTurno}>
                        <Plus size={13} strokeWidth={2.5} />
                        Nuevo
                      </button>
                    </h2>
                    <div className="resumen-agenda-scroll">
                      <Agenda
                        turnos={turnosHoy}
                        onChangeEstado={pedirEstadoOCobro}
                        onDeleteTurno={deleteTurno}
                        onEditTurno={openEditTurno}
                        notas={notas}
                        onAddNota={addNota}
                        barberos={barberos}
                        onNewTurno={openNewTurno}
                      />
                    </div>
                  </div>
                  <div className="panel">
                    <p className="panel-title">
                      <span className="panel-title-icon"><MessageCircle size={16} style={{ color: 'var(--accent)' }} />Conversaciones recientes</span>
                    </p>
                    <Messages
                      conversaciones={conversaciones}
                      full={false}
                      selectedId={selectedConversationId}
                      onSelectConversation={openConversation}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {view === 'agenda' && (
          <div className="fade-in">
            <div className="page-header agenda-page-header">
              <div>
                <p className="page-kicker">Calendario operativo</p>
                <h1 className="page-title">Agenda</h1>
              </div>
              <div className="page-actions">
                <span className="page-date">{turnos.length} turnos en total</span>
                <button
                  className="btn agenda-export-btn"
                  aria-label="Exportar turnos"
                  title="Exportar turnos (CSV)"
                  onClick={() => exportarCSV('turnos.csv', turnos, [
                    { key: 'fecha', label: 'Fecha' },
                    { key: 'hora', label: 'Hora' },
                    { key: 'paciente', label: 'Cliente' },
                    { key: 'motivo', label: 'Motivo' },
                    { key: 'estado', label: 'Estado' },
                  ])}
                >
                  <Download size={14} aria-hidden="true" />
                  <span className="btn-label">Exportar</span>
                </button>
                <button className="btn btn-primary" onClick={openNewTurno}>
                  <Plus size={15} strokeWidth={2.5} />
                  Nuevo turno
                </button>
              </div>
            </div>
            {loading ? <SkeletonBlock height={420} /> : (
              <Calendar
                turnos={turnos}
                todayKey={todayKey}
                onChangeEstado={pedirEstadoOCobro}
                onDeleteTurno={deleteTurno}
                onEditTurno={openEditTurno}
                notas={notas}
                onAddNota={addNota}
                onNewTurno={openNewTurnoConFecha}
                barberos={barberos}
                bloqueos={bloqueos}
              />
            )}
          </div>
        )}

        {view === 'equipo' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <p className="page-kicker">Carga por profesional</p>
                <h1 className="page-title">Equipo</h1>
              </div>
              <span className="page-date">Qué tiene agendado cada barbero</span>
            </div>
            {loading ? <SkeletonBlock height={420} /> : (
              <Barberos
                barberos={barberos}
                turnos={turnos}
                todayKey={todayKey}
                notas={notas}
                onChangeEstado={pedirEstadoOCobro}
                onDeleteTurno={deleteTurno}
                onEditTurno={openEditTurno}
                onAddNota={addNota}
              />
            )}
          </div>
        )}

        {view === 'mensajes' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <p className="page-kicker">WhatsApp</p>
                <h1 className="page-title">Mensajes</h1>
              </div>
            </div>
            {loading ? <SkeletonBlock height={420} /> : (
              <Messages
                conversaciones={conversaciones}
                full={true}
                selectedId={selectedConversationId}
                onSelectConversation={openConversation}
                onSendMessage={sendMensaje}
                pacientes={pacientes}
              />
            )}
          </div>
        )}

        {view === 'pacientes' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <p className="page-kicker">Base de datos</p>
                <h1 className="page-title">Clientes</h1>
              </div>
            </div>
            {loading ? <SkeletonBlock height={320} /> : (
              <div className="panel">
                <Patients
                  pacientes={pacientes}
                  notas={notas}
                  turnos={turnos}
                  onViewNotes={verNotasDePaciente}
                  onAddPaciente={addPaciente}
                  onUpdatePaciente={updatePaciente}
                  onDeletePaciente={deletePaciente}
                />
              </div>
            )}
          </div>
        )}

        {view === 'notas' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <p className="page-kicker">Seguimiento</p>
                <h1 className="page-title">Notas</h1>
              </div>
            </div>
            {loading ? <SkeletonBlock height={320} /> : (
              <Notes
                notas={notas}
                onAdd={addNota}
                onUpdate={updateNota}
                onDelete={deleteNota}
                pacientes={pacientes}
                filtroInicial={notasFiltro}
              />
            )}
          </div>
        )}

        {view === 'estadisticas' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <p className="page-kicker">Rendimiento</p>
                <h1 className="page-title">Estadísticas</h1>
              </div>
            </div>
            {loading ? <SkeletonBlock height={420} /> : (
              <Stats turnos={turnos} pacientes={pacientes} conversaciones={conversaciones} todayKey={todayKey} barberos={barberos} servicios={servicios} pagos={pagos} timezone={zonaHoraria} />
            )}
          </div>
        )}

        {view === 'operacion' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <p className="page-kicker">Configuración comercial</p>
                <h1 className="page-title">Operación</h1>
              </div>
              <span className="page-date">Precios, duración y barberos disponibles</span>
            </div>
            {loading ? <SkeletonBlock height={420} /> : (
              <Operations
                servicios={servicios}
                onAddServicio={addServicio}
                onUpdateServicio={updateServicio}
                onDeleteServicio={deleteServicio}
                onReactivarServicio={reactivarServicio}
                barberos={barberos}
                onAddBarbero={addBarbero}
                onUpdateBarbero={updateBarbero}
                onDeleteBarbero={deleteBarbero}
                bloqueos={bloqueos}
                onAddBloqueo={addBloqueo}
                onDeleteBloqueo={deleteBloqueo}
                config={mockBarberiaConfig}
              />
            )}
          </div>
        )}

        {view === 'configuracion' && <TenantSettings barberiaId={barberiaId} demoMode={demoMode} onBrandingChange={setTenantBranding} />}

        {view === 'facturacion' && <Billing barberiaId={barberiaId} demoMode={demoMode} />}
      </main>

      <NewTurnoModal
        open={newTurnoOpen}
        onClose={closeTurnoModal}
        onSubmit={saveTurno}
        defaultDate={demoDefaultTurnDate}
        demoMode={demoMode}
        turnoExistente={editingTurno}
        turnosExistentes={turnos}
        servicios={servicios}
        barberos={barberos}
        clientes={pacientes}
        bloqueos={bloqueos}
        zonaHoraria={zonaHoraria}
        errorMessage={dbError}
      />

      <CobroModal
        turno={cobroTurno}
        servicios={servicios}
        onClose={() => setCobroTurno(null)}
        onConfirm={confirmarCobro}
      />
    </div>
  )
}
