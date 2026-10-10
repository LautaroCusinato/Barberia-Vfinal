import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import './components/agenda.css'
import './components/management.css'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Info, CalendarCheck, MessageCircle, Plus, Download, AlertTriangle, X, Ban } from 'lucide-react'
import NewTurnoModal from './components/NewTurnoModal'
import BloqueosModal from './components/BloqueosModal'
import { statusMeta } from './components/StatusSelect'
import CobroModal from './components/CobroModal'
import Toaster from './components/Toaster'
import TopProgress from './components/TopProgress'
import { useToasts } from './lib/useToasts.js'
import { useDeferredDeletes } from './lib/useDeferredDeletes.js'
import { persistirBorrado } from './lib/deferredDeletes.js'
import { DURACION_AVISO_MS, MENSAJES_EXITO, conAvisoExito } from './lib/avisosExito.js'
import { agregarPagoSinDuplicar, nuevaClaveCobro, registrarCobroTurno } from './lib/cobroTurno.js'
import { cascadaInicial } from './lib/cascade.js'
import { logout } from './lib/auth.js'
import { exportarCSV } from './lib/csv'
import Sidebar from './components/Sidebar'
import StatsCards from './components/StatsCards'
import Agenda from './components/Agenda'
import Barberos from './components/Barberos'
import Calendar from './components/Calendar'
import Messages from './components/Messages'
import Clientes from './components/Clientes'
import Notes from './components/Notes'
import { asociacionNota } from './lib/clientNotes'
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
import { consultarTurnosActivos, copiaParaRestaurar, eliminarBloqueo, esBloqueoDiaCompleto, filasBloqueo, insertarBloqueos, puedeGestionarBloqueos, turnosAfectados, turnosNuevos } from './lib/bloqueosAgenda.js'
import { initialWorkspaceCollection } from './lib/runtimeStability.js'
import { crearCargaPagos } from './lib/paymentStats.js'
import { MANAGED_WHATSAPP_PROVISIONING, WHATSAPP_PROVISION_FUNCTION } from './lib/whatsappProvisioning.js'
import { enqueueLatest } from './lib/latestIntentQueue.js'
import { useTurnoMoves } from './lib/useTurnoMoves.js'
import { persistirMovimiento, TURNO_CAMBIO, TURNO_SIN_PERMISO } from './lib/turnoMoves.js'
import { agruparConversaciones, asegurarHiloCliente, claveHiloCliente, conservarHiloIniciado } from './lib/conversaciones.js'
import { claveDeEnvio, enviarMensajePanel, olvidarClaveDeEnvio, verificarChatCliente } from './lib/envioPanel.js'

const TZ = 'America/Argentina/Buenos_Aires'
const LEGACY_THEME_KEY = 'barberia-central-theme'
const WHATSAPP_PANEL_SEND_FUNCTION = 'whatsapp-panel-send'
const AVISO_DURACION_MS = 7000

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

function restoreRejectedField(items, id, field, rejectedValue, confirmedValue) {
  return items.map((item) => item.id === id && item[field] === rejectedValue
    ? { ...item, [field]: confirmedValue } : item)
}

function unconfirmedUpdate({ data, error }, id) {
  return error || (Array.isArray(data) && data.some((row) => String(row.id) === String(id))
    ? null : { message: 'No se confirmó ninguna fila modificada de este negocio.' })
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

// El tema es una preferencia visual opcional: si el navegador bloquea el
// almacenamiento (modo privado, cuota llena, política) el panel sigue abierto
// con el tema en memoria. No usar para datos que una operación necesita guardar.
function leerPreferencia(key) {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function guardarPreferencia(key, value) {
  try { window.localStorage.setItem(key, value) } catch { /* preferencia opcional */ }
}

function initialTheme(tenantId, storageKey = null) {
  const saved = leerPreferencia(storageKey || tenantStorageKey('theme', tenantId)) || leerPreferencia(LEGACY_THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const WORKSPACE_VIEWS = new Set(['resumen', 'agenda', 'equipo', 'mensajes', 'clientes', 'notas', 'estadisticas', 'operacion', 'configuracion', 'facturacion'])

function workspaceViewFromUrl() {
  // Compatibilidad: enlaces viejos con ?view=pacientes abren Clientes.
  const pedido = new URLSearchParams(window.location.search).get('view')
  const requested = pedido === 'pacientes' ? 'clientes' : pedido
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

// Una instancia del panel por negocio: al cambiar de negocio sin desmontar
// (por ejemplo, la caché inicial difiere de la preferencia confirmada), todo el
// estado del anterior se descarta y una respuesta tardía suya (envío manual,
// validación, cobro) no puede tocar el hilo, el borrador ni el bot del nuevo.
export default function App(props) {
  return <PanelNegocio key={`${props.demoMode ? 'demo' : 'negocio'}:${props.barberiaId}`} {...props} />
}

function PanelNegocio({ barberiaId, barberiaNombre, vertical: _vertical, demoMode = false, demoSessionId = null, rol = null }) {
  // Demo mode deliberately reuses every local branch of the real panel while
  // making the Supabase adapter unavailable. This keeps the tenant boundary
  // explicit: no demo callback can reach an authenticated or server adapter.
  const isSupabaseConfigured = supabaseConfigured && !demoMode
  const demoSnapshot = demoMode ? getDemoSnapshot(demoSessionId) : null
  const themeKey = demoMode ? 'austral-demo-theme' : tenantStorageKey('theme', barberiaId)
  const [view, setView] = useState(workspaceViewFromUrl)
  const [turnosBase, setTurnos] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.turnos, fallbackValue: mockTurnos }))
  const [conversaciones, setConversaciones] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.conversaciones, fallbackValue: mockConversaciones }))
  const [pacientes, setPacientes] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.pacientes, fallbackValue: mockPacientes }))
  const [notasBase, setNotas] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.notas, fallbackValue: mockNotas }))
  const [servicios, setServicios] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.servicios, fallbackValue: mockServicios }))
  const [barberos, setBarberos] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.barberos, fallbackValue: mockBarberos }))
  const [bloqueosBase, setBloqueos] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.bloqueos, fallbackValue: [] }))
  const [pagos, setPagos] = useState(() => initialWorkspaceCollection({ demoMode, remoteConfigured: isSupabaseConfigured, demoValue: demoSnapshot?.pagos, fallbackValue: [] }))
  const [pagosEstado, setPagosEstado] = useState(isSupabaseConfigured ? 'cargando' : 'listo')
  const [cobroTurno, setCobroTurno] = useState(null)
  // Una clave por apertura del modal de cobro (reintentos incluidos) y un
  // candado contra envíos simultáneos.
  const cobroClaveRef = useRef(null)
  const habilidadesWritesRef = useRef({})
  const cobroEnCursoRef = useRef(false)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [loadedForTenant, setLoadedForTenant] = useState(null)
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  // "Iniciar chat" desde Clientes: hilo que el operador abrió (se conserva
  // vacío ante recargas), pedido de foco del compositor y validación del
  // servidor por cliente (conexión, plan, teléfono) para explicar bloqueos.
  const hiloIniciadoRef = useRef(null)
  const [chatFocusRequest, setChatFocusRequest] = useState(null)
  const consumirFocoChat = useCallback(() => setChatFocusRequest(null), [])
  const [estadoChatPorCliente, setEstadoChatPorCliente] = useState({})
  // Contrato detectado de whatsapp-panel-send (2 o 'legacy'); null = sin saber.
  const contratoEnvioRef = useRef(null)
  // Identificador por envío (cliente + texto): un reintento del mismo borrador
  // reutiliza el identificador y el servidor no vuelve a enviarlo.
  const clavesEnvioRef = useRef(new Map())
  const [theme, setTheme] = useState(() => initialTheme(barberiaId, demoMode ? 'austral-demo-theme' : null))
  const [newTurnoOpen, setNewTurnoOpen] = useState(false)
  const [bloqueosOpen, setBloqueosOpen] = useState(false)
  const [agendaFecha, setAgendaFecha] = useState(null)
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
  // Los avisos informativos se van solos: antes quedaban fijos y uno viejo
  // ("el bot volvió a responder") convivía con el estado contrario.
  useEffect(() => {
    if (!aviso) return undefined
    const timer = window.setTimeout(() => setAviso(''), AVISO_DURACION_MS)
    return () => window.clearTimeout(timer)
  }, [aviso])
  const contextoBorrados = `${barberiaId}:${demoMode}:${demoSessionId}:${isSupabaseConfigured}`
  const { toasts, mostrar: mostrarToast, cerrar: cerrarToast } = useToasts({ contexto: contextoBorrados })
  const borrados = useDeferredDeletes(contextoBorrados)
  const turnos = borrados.filtrar('turnos', turnosBase)
  // Lectura actual para callbacks diferidos (p. ej. Deshacer de un desbloqueo).
  const turnosRef = useRef(turnos)
  useEffect(() => { turnosRef.current = turnos }, [turnos])
  const notas = borrados.filtrar('notas', notasBase)
  const bloqueos = borrados.filtrar('bloqueos_agenda', bloqueosBase)
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
    saveDemoSnapshot(demoSessionId, { turnos: turnosBase, conversaciones, pacientes, notas: notasBase, servicios, barberos, bloqueos: bloqueosBase, pagos, tenantBranding, horariosDefault, zonaHoraria })
  }, [demoMode, demoSessionId, turnosBase, conversaciones, pacientes, notasBase, servicios, barberos, bloqueosBase, pagos, tenantBranding, horariosDefault, zonaHoraria])

  const todayKey = todayInClinicTZ(zonaHoraria)
  const demoDefaultTurnDate = demoMode && !turnoFechaPrefijada
    ? demoBookingDate(todayKey, barberos, servicios, bloqueos, turnos, zonaHoraria)
    : (turnoFechaPrefijada || todayKey)

  useEffect(() => {
    setTheme(initialTheme(barberiaId, demoMode ? 'austral-demo-theme' : null))
  }, [barberiaId, demoMode])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    guardarPreferencia(themeKey, theme)
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

  const verNotasDePaciente = (clienteId) => {
    navigateFromMenu('notas')
    setNotasFiltro({ clienteId })
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
    // En escritorio el área principal es el contenedor que scrollea.
    if (mainRef.current) mainRef.current.scrollTop = 0
  }, [view])

  // La primera vez que se abre cada pantalla, sus primeras filas entran en cascada.
  const vistasAbiertasRef = useRef(new Set())
  useLayoutEffect(() => {
    if (loading || vistasAbiertasRef.current.has(view) || !mainRef.current) return
    if (cascadaInicial(mainRef.current)) vistasAbiertasRef.current.add(view)
  }, [view, loading])

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
    // Un hilo iniciado pertenece al negocio anterior: nunca se conserva al cambiar.
    hiloIniciadoRef.current = null
    contratoEnvioRef.current = null
    clavesEnvioRef.current = new Map()
    setEstadoChatPorCliente({})

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

    const cargarPagos = crearCargaPagos({
      client: supabase, barberiaId, onData: setPagos, onStatus: setPagosEstado,
      onError: (error) => reportError('No se pudieron cargar los pagos', error),
      isCancelled: () => cancelado,
    })

    async function cargarMensajes(clientesPromise = null) {
      const mensajesPromise = supabase.from('mensajes').select('*').eq('barberia_id', barberiaId).order('created_at')
      const [mensajesResult, clientesData] = await Promise.all([
        mensajesPromise,
        clientesPromise || supabase.from('clientes').select('id, nombre').eq('barberia_id', barberiaId).then(({ data }) => data ?? []),
      ])
      if (cancelado) return
      const { data, error } = mensajesResult
      if (error) { reportError('No se pudieron cargar los mensajes', error); return }

      // Agrupación por cliente_id (ver lib/conversaciones.js). El hilo abierto
      // con "Iniciar chat" se conserva si no se pudieron leer los clientes.
      const lista = agruparConversaciones(data, clientesData)
      setConversaciones((prev) => conservarHiloIniciado(lista, prev, hiloIniciadoRef.current, clientesData))
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
          if (cancelado) return
          realtimeActivo = true
          pollDelay = 15000
          detenerFallback()
          // Una reserva pudo guardarse entre la primera lectura y la
          // suscripción (o mientras el socket estaba caído).
          refrescarDatosVisibles()
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

    const refrescarDatosVisibles = () => {
      if (cancelado || document.visibilityState !== 'visible') return
      programarRecarga('clientes', () => { const clientesPromise = cargarClientes(); cargarMensajes(clientesPromise) })
      programarRecarga('turnos', cargarTurnos)
      programarRecarga('pagos', cargarPagos)
      programarRecarga('bloqueos', cargarBloqueos)
    }
    window.addEventListener('focus', refrescarDatosVisibles)
    document.addEventListener('visibilitychange', refrescarDatosVisibles)

    activarFallback()
    suscribirRealtime()

    return () => {
      cancelado = true
      window.removeEventListener('focus', refrescarDatosVisibles)
      document.removeEventListener('visibilitychange', refrescarDatosVisibles)
      for (const timer of recargasPendientes.values()) window.clearTimeout(timer)
      recargasPendientes.clear()
      if (channel) supabase.removeChannel(channel)
      detenerFallback()
    }
  }, [barberiaId, isSupabaseConfigured, reloadKey, reportError])

  const movimientos = useTurnoMoves({
    contexto: `${barberiaId}:${demoMode}:${demoSessionId}:${isSupabaseConfigured}`,
    turnos,
    setTurnos,
    guardar: (turnoId, origen, destino) => isSupabaseConfigured
      ? persistirMovimiento(supabase, { barberiaId, turnoId, origen, destino })
      : Promise.resolve({ ...origen, ...destino }),
    onError: (error) => {
      if (error?.code === TURNO_CAMBIO) mostrarValidacion('El turno cambió o ya no está disponible. Actualizá la agenda antes de volver a moverlo.')
      else if (error?.code === TURNO_SIN_PERMISO) mostrarValidacion('Tu usuario no tiene permiso para mover turnos en este negocio, o el negocio no tiene la agenda habilitada.')
      else {
        const mensaje = mensajeErrorTurno(error)
        if (mensaje) mostrarValidacion(mensaje)
        else reportError('No se pudo mover el turno. Actualizá la agenda para comprobar su horario.', error)
      }
    },
    onObsoleto: () => mostrarValidacion('El turno cambió. Este Deshacer o movimiento ya no está disponible; actualizá la agenda.'),
    onMovido: ({ hora, onUndo }) => mostrarToast({ mensaje: `Turno movido a ${hora}`, duracion: 5000, onUndo }),
  })

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

  // Oculta sin eliminar de la lista base. Las recargas siguen actualizando
  // esa lista; Deshacer muestra la versión más reciente, no un snapshot viejo.
  const eliminarConDeshacer = (lista, setLista, id, tabla, mensaje, mensajeError) => {
    const anterior = lista.find((item) => item.id === id)
    if (!anterior) return true
    const operacion = borrados.programar({
      tabla, id, retener: isSupabaseConfigured,
      guardar: () => isSupabaseConfigured ? persistirBorrado(supabase, { tabla, barberiaId, fila: anterior }) : Promise.resolve(),
      onConfirmado: () => {
        setLista((prev) => prev.filter((item) => item.id !== id))
        mostrarToast({ mensaje })
      },
      onError: (error) => reportError(`${mensajeError}. Actualizá los datos para comprobar si sigue disponible`, error),
    })
    if (!operacion) return false
    const aviso = mostrarToast({
      mensaje: `${tabla === 'turnos' ? 'Turno' : tabla === 'notas' ? 'Nota' : 'Día libre'}: eliminación pendiente. Al salir antes de guardar, se cancela.`,
      labelCerrar: 'Eliminar ahora',
      duracion: 5000,
      onUndo: operacion.deshacer,
      onDiscard: operacion.deshacer,
      onExpire: operacion.confirmar,
    })
    // Sin aviso no hay Deshacer ni vencimiento: la fila quedaría oculta.
    if (aviso == null) {
      operacion.deshacer()
      return false
    }
    return true
  }

  const addNota = async (nueva) => {
    const asociacion = nueva.cliente_id == null
      ? { cliente_id: null, paciente: String(nueva.paciente || 'General') }
      : asociacionNota(nueva.cliente_id, pacientes)
    if (!asociacion) { mostrarValidacion('El cliente ya no está disponible. Actualizá la lista antes de guardar.'); return false }
    const conFecha = { ...asociacion, texto: nueva.texto, fecha: todayKey }
    if (isSupabaseConfigured) {
      try {
        const { data, error } = await supabase.from('notas').insert({ ...conFecha, barberia_id: barberiaId }).select()
        if (error) { reportError('No se pudo guardar la nota', error); return false }
        if (!data?.[0]) { reportError('No se pudo confirmar el guardado de la nota'); return false }
        setNotas((prev) => [data[0], ...prev])
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

  const invocarEnvioPanel = (body) => supabase.functions.invoke(WHATSAPP_PANEL_SEND_FUNCTION, { body })

  // "Iniciar chat" desde la ficha del cliente. Abre su hilo (o lo crea vacío,
  // sólo en el panel), lo enfoca en Mensajes y valida en el servidor si se le
  // puede escribir. No escribe en la base ni envía nada: el primer mensaje
  // requiere que el operador lo escriba y lo envíe.
  const iniciarChatCliente = async (clienteId) => {
    const cliente = pacientes.find((p) => p.id === clienteId)
    if (!cliente) {
      mostrarValidacion('No encontramos la ficha de este cliente. Actualizá la página e intentá de nuevo.')
      return
    }
    const existente = conversaciones.find((c) => c.clienteId === clienteId)
    const convId = existente?.id ?? claveHiloCliente(clienteId)
    hiloIniciadoRef.current = clienteId
    setConversaciones((prev) => asegurarHiloCliente(prev, cliente))
    setSelectedConversationId(convId)
    setChatFocusRequest((prev) => ({ id: convId, n: (prev?.n ?? 0) + 1 }))
    navigateFromMenu('mensajes')
    if (existente?.noLeido) openConversation(convId)
    // El foco va al compositor del hilo (lo pone Messages), no al inicio de la vista.
    routeFocusPendingRef.current = false

    if (demoMode || !isSupabaseConfigured) {
      setEstadoChatPorCliente((prev) => ({ ...prev, [clienteId]: { estado: 'demo', mensaje: 'Modo demostración: este chat no envía mensajes por WhatsApp.' } }))
      return
    }
    if (estadoChatPorCliente[clienteId]?.estado === 'verificando') return
    setEstadoChatPorCliente((prev) => ({ ...prev, [clienteId]: { estado: 'verificando', mensaje: '' } }))
    const { estado, mensaje, contrato } = await verificarChatCliente({ invoke: invocarEnvioPanel, tenantId: barberiaId, clienteId })
    if (contrato != null) contratoEnvioRef.current = contrato
    const resultado = { estado, mensaje }
    setEstadoChatPorCliente((prev) => ({ ...prev, [clienteId]: resultado }))
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
      return conAvisoExito(() => updateTurnoEstado(turnoId, nuevoEstado), MENSAJES_EXITO.estadoTurno(statusMeta(nuevoEstado).label), mostrarToast)
    }
    const turno = turnos.find((t) => t.id === turnoId)
    if (turno) {
      cobroClaveRef.current = nuevaClaveCobro()
      setCobroTurno(turno)
      return true
    }
    return false
  }

  // Estado "atendido" y pago se guardan juntos en el servidor (RPC). Ante un
  // error el modal sigue abierto con importe y método, y el reintento reusa
  // la misma clave: si la respuesta anterior se perdió, no se duplica el pago.
  const confirmarCobro = async ({ monto, metodo }) => {
    if (!cobroTurno || cobroEnCursoRef.current) return
    const turno = cobroTurno
    cobroEnCursoRef.current = true
    try {
      if (isSupabaseConfigured) {
        try {
          const { pago } = await registrarCobroTurno(supabase, { turnoId: turno.id, monto, metodo, clave: cobroClaveRef.current })
          setPagos((prev) => agregarPagoSinDuplicar(prev, pago))
        } catch (error) {
          reportClientError(error?.causa ?? error, { source: 'workspace', tenant_id: barberiaId, user_message: error?.message })
          // Otro operador ya lo cobró: el servidor es la fuente de verdad y
          // Realtime trae su pago; la agenda deja de ofrecerlo como pendiente.
          if (error?.codigo === 'turno_ya_atendido') {
            setTurnos((prev) => prev.map((t) => (t.id === turno.id ? { ...t, estado: 'atendido' } : t)))
          }
          throw error
        }
      } else {
        // Demo sin backend: mismo resultado, en memoria.
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
        setPagos((prev) => [{ id: nextLocalId(prev), ...nuevoPago, created_at: new Date().toISOString() }, ...prev])
      }
      setTurnos((prev) => prev.map((t) => (t.id === turno.id ? { ...t, estado: 'atendido' } : t)))
      setCobroTurno(null)
      mostrarToast({ mensaje: MENSAJES_EXITO.cobroRegistrado, duracion: DURACION_AVISO_MS })
    } finally {
      cobroEnCursoRef.current = false
    }
  }

  const moverTurno = movimientos.mover

  const deleteTurno = (turnoId) => {
    if (movimientos.pendiente(turnoId)) {
      mostrarValidacion('Esperá a que termine de guardarse el movimiento del turno.')
      return false
    }
    movimientos.invalidar(turnoId)
    return eliminarConDeshacer(turnos, setTurnos, turnoId, 'turnos', 'Turno eliminado', 'No se pudo eliminar el turno')
  }

  const guardarTurno = async ({ paciente, telefono, clienteId, fecha, hora, motivo, estado, servicio_id, barbero_id, precio, duracion }, existingId) => {
    if (existingId && movimientos.pendiente(existingId)) {
      mostrarValidacion('Esperá a que termine de guardarse el movimiento del turno.')
      return false
    }
    if (existingId) movimientos.invalidar(existingId)
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

  const saveTurno = (datos, existingId) => conAvisoExito(
    () => guardarTurno(datos, existingId),
    existingId ? MENSAJES_EXITO.turnoEditado : MENSAJES_EXITO.turnoCreado,
    mostrarToast,
  )

  const openNewTurno = () => { setDbError(''); setEditingTurno(null); setTurnoFechaPrefijada(null); setNewTurnoOpen(true) }
  const openNewTurnoConFecha = (fecha) => { setDbError(''); setEditingTurno(null); setTurnoFechaPrefijada(fecha); setNewTurnoOpen(true) }
  const openEditTurno = (turno) => { setDbError(''); setEditingTurno(turno); setTurnoFechaPrefijada(null); setNewTurnoOpen(true) }
  const closeTurnoModal = () => { setNewTurnoOpen(false); setEditingTurno(null); setTurnoFechaPrefijada(null) }

  const guardarPacienteNuevo = async (datos) => {
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

  const guardarCambiosPaciente = async (id, cambios) => {
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

  const addPaciente = (datos) => conAvisoExito(() => guardarPacienteNuevo(datos), MENSAJES_EXITO.clienteCreado, mostrarToast)
  const updatePaciente = (id, cambios) => conAvisoExito(() => guardarCambiosPaciente(id, cambios), MENSAJES_EXITO.clienteEditado, mostrarToast)

  const deletePaciente = (id) => eliminarOptimista(pacientes, setPacientes, id, 'clientes', 'No se pudo eliminar el cliente')

  const updateNota = async (id, texto, asociacionElegida) => {
    const asociacion = asociacionElegida === undefined ? undefined : asociacionElegida.cliente_id == null
      ? { cliente_id: null, paciente: 'General' }
      : asociacionNota(asociacionElegida.cliente_id, pacientes)
    if (asociacion === null) { mostrarValidacion('El cliente ya no está disponible. Actualizá la lista antes de guardar.'); return false }
    const cambios = { texto, ...asociacion }
    const anterior = notas.find((n) => n.id === id)
    if (!anterior) return false
    setNotas((prev) => prev.map((n) => (n.id === id ? { ...n, ...cambios } : n)))
    if (!isSupabaseConfigured) return true
    try {
      const { data, error } = await supabase.from('notas').update(cambios).eq('id', id).eq('barberia_id', barberiaId).select()
      if (error || !data?.[0]) {
        if (anterior) setNotas((prev) => prev.map((n) => (n.id === id ? anterior : n)))
        reportError('No se pudo actualizar la nota', error)
        return false
      }
      setNotas((prev) => prev.map((n) => n.id === id ? data[0] : n))
      return true
    } catch (error) {
      if (anterior) setNotas((prev) => prev.map((n) => (n.id === id ? anterior : n)))
      reportError('No se pudo actualizar la nota', error)
      return false
    }
  }

  const deleteNota = (id) => eliminarConDeshacer(notas, setNotas, id, 'notas', 'Nota eliminada', 'No se pudo eliminar la nota')

  // Bot por chat (clientes.bot_pausado). Responder a mano pausa el bot sólo
  // en ese chat; el ícono junto a "Enviar" lo pausa o lo reanuda. El resto de
  // los clientes sigue atendido por el bot. Con la reserva atómica el servidor
  // ya lo pausó antes del envío (`yaPausado`).
  const marcarBotChat = (clienteId, pausado) => setPacientes((prev) => prev.map((p) => (p.id === clienteId ? { ...p, bot_pausado: pausado } : p)))
  const guardarBotChat = async (clienteId, pausado) => {
    const anterior = pacientes.find((p) => p.id === clienteId)?.bot_pausado === true
    marcarBotChat(clienteId, pausado)
    if (!isSupabaseConfigured || demoMode) return true
    const { error } = await supabase.rpc('pausar_bot_chat', { p_barberia_id: barberiaId, p_cliente_id: clienteId, p_pausado: pausado })
    if (error) {
      marcarBotChat(clienteId, anterior)
      reportError(pausado ? 'No se pudo pausar el bot en este chat' : 'No se pudo reanudar el bot en este chat', error)
      return false
    }
    return true
  }
  const pausarBotPorRespuestaManual = async (clienteId, yaPausado) => {
    if (clienteId == null) return
    if (yaPausado) { marcarBotChat(clienteId, true); return }
    if (pacientes.find((p) => p.id === clienteId)?.bot_pausado === true) return
    await guardarBotChat(clienteId, true)
  }
  const alternarBotChat = (clienteId) => {
    const pausado = pacientes.find((p) => p.id === clienteId)?.bot_pausado === true
    return guardarBotChat(clienteId, !pausado)
  }

  const sendMensaje = async (paciente, texto, clienteId, opciones = {}) => {
    const horaActual = new Intl.DateTimeFormat('es-AR', { timeZone: zonaHoraria || TZ, hour: '2-digit', minute: '2-digit' }).format(new Date())
    const esLaConversacion = (c) => (clienteId != null ? c.clienteId === clienteId : c.paciente === paciente)
    const cliente = clienteId != null ? pacientes.find((p) => p.id === clienteId) : null
    const agregarAlHilo = (mensaje) => setConversaciones((prev) => {
      const base = cliente ? asegurarHiloCliente(prev, cliente) : prev
      const actualizadas = base.map((c) => {
        if (!esLaConversacion(c)) return c
        // Realtime puede traer la fila antes que la respuesta: no duplicar por id.
        if (mensaje.id != null && c.mensajes.some((m) => m.id === mensaje.id)) return c
        return { ...c, mensajes: [...c.mensajes, mensaje], ultimaHora: mensaje.hora ?? horaActual, ultimoCreatedAt: mensaje.created_at ?? new Date().toISOString() }
      })
      const idx = actualizadas.findIndex(esLaConversacion)
      if (idx <= 0) return actualizadas
      const [conv] = actualizadas.splice(idx, 1)
      return [conv, ...actualizadas]
    })

    if (!isSupabaseConfigured) {
      // Demo o modo local: el mensaje sólo vive en este navegador.
      agregarAlHilo({ paciente, texto, de: 'clinica', hora: horaActual, leido: true, cliente_id: clienteId ?? null })
    } else {
      if (clienteId == null) {
        return { ok: false, message: 'Esta conversación no está vinculada a una ficha de cliente, así que no se puede enviar por WhatsApp.' }
      }
      // El envío real pasa por una edge function autenticada: valida tenant,
      // rol, plan, conexión, remitente y la ficha del cliente, guarda el
      // mensaje con su cliente_id y recién entonces lo envía (ver
      // lib/envioPanel.js). Con la función anterior a la tarea 38 se usa el
      // flujo viejo (el navegador guarda la fila) para no perder ni duplicar.
      // El navegador nunca conoce la URL del webhook de n8n.
      const envio = await enviarMensajePanel({
        invoke: invocarEnvioPanel,
        // Sólo para la función anterior: la fila la guarda el navegador.
        insertarLegacy: () => supabase.from('mensajes').insert({ paciente, texto, de: 'clinica', hora: horaActual, leido: true, cliente_id: clienteId, barberia_id: barberiaId }).select().single(),
        contrato: contratoEnvioRef.current,
        tenantId: barberiaId,
        clienteId,
        texto,
        hora: horaActual,
        confirmarReenvio: opciones.confirmarReenvio === true,
        clientMessageId: claveDeEnvio(clavesEnvioRef.current, clienteId, texto),
      })
      if (envio.contrato != null) contratoEnvioRef.current = envio.contrato
      if (envio.resultado === 'enviado' || envio.reiniciarClave) olvidarClaveDeEnvio(clavesEnvioRef.current, clienteId, texto)
      if (envio.resultado === 'posible_duplicado') return { ok: false, message: envio.aviso, confirmable: true }
      if (envio.resultado === 'rechazado' || envio.resultado === 'desconocido') {
        // Se intentó enviar (WhatsApp lo rechazó o no sabemos si salió): el
        // operador ya tomó la conversación y el bot queda pausado igual.
        // Reanudarlo es una acción explícita ("Reanudar bot"). Un bloqueo
        // previo al envío (límite, teléfono, conexión) no pausa.
        if (envio.intentado) await pausarBotPorRespuestaManual(clienteId, envio.botPausado === true)
        return { ok: false, message: envio.aviso }
      }
      if (envio.mensaje) agregarAlHilo(envio.mensaje)
      setEstadoChatPorCliente((prev) => ({ ...prev, [clienteId]: { estado: 'listo', mensaje: '' } }))
      // Enviado o incierto: pudo haber salido, así que también corresponde el
      // traspaso a atención humana. Con la reserva atómica ya lo hizo el
      // servidor, antes del envío.
      const avisoEnvio = envio.aviso || ''
      await pausarBotPorRespuestaManual(clienteId, envio.botPausado === true)
      return avisoEnvio ? { ok: true, aviso: avisoEnvio } : true
    }

    await pausarBotPorRespuestaManual(clienteId, false)
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
    let confirmedValue = anterior?.[field]
    setServicios((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: parsed } : s)))
    if (!isSupabaseConfigured) return true
    const key = `${id}:${field}`
    return enqueueLatest(servicioWritesRef.current, key, parsed, async (valueToSave) => {
      const dbField = field === 'duracion' ? 'duracion_min' : field
      try {
        const response = await supabase.from('servicios').update({ [dbField]: valueToSave }).eq('id', id).eq('barberia_id', barberiaId).select('id')
        const error = unconfirmedUpdate(response, id)
        if (!error) { confirmedValue = valueToSave; return true }
        if (servicioWritesRef.current[key]?.latest === valueToSave) {
          if (anterior) setServicios((prev) => restoreRejectedField(prev, id, field, valueToSave, confirmedValue))
          const duplicate = error.code === '23505' || /duplicate|unique|nombre/i.test(error.message || '')
          reportError(duplicate ? 'Ya existe un servicio con ese nombre' : 'No se pudo actualizar el servicio', error)
        }
        return false
      } catch (error) {
        if (servicioWritesRef.current[key]?.latest === valueToSave) {
          if (anterior) setServicios((prev) => restoreRejectedField(prev, id, field, valueToSave, confirmedValue))
          reportError('No se pudo actualizar el servicio', error)
        }
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
  // Habilidades: qué servicios realiza cada profesional. Se guardan de a una
  // en barbero_servicios (por id), la relación que usan la reserva web y el
  // bot; ya no se borran y recrean todas, y renombrar un servicio no las pierde.
  const toggleServicioBarbero = async (barberoId, servicioId, habilitar) => {
    const barbero = barberos.find((item) => item.id === barberoId)
    const servicio = servicios.find((item) => String(item.id) === String(servicioId))
    if (!barbero || !servicio) return false
    const base = barbero.serviciosCargados
      ? (barbero.servicios || [])
      : servicios.filter((s) => barberoRealizaServicio(barbero, s)).map((s) => ({ barbero_id: barberoId, servicio_id: s.id }))
    const sinEste = base.filter((rel) => String(rel.servicio_id ?? rel.id) !== String(servicioId))
    const siguiente = habilitar ? [...sinEste, { barbero_id: barberoId, servicio_id: servicio.id }] : sinEste
    const habilidadesJson = JSON.stringify(servicios.filter((s) => siguiente.some((rel) => String(rel.servicio_id) === String(s.id))).map((s) => generarIdHabilidad(s.nombre)))
    const aplicar = (relaciones, habilidades) => setBarberos((prev) => prev.map((b) => (b.id === barberoId ? { ...b, servicios: relaciones, serviciosCargados: true, habilidades } : b)))
    aplicar(siguiente, habilidadesJson)
    if (!isSupabaseConfigured) return true

    const key = `${barberoId}:${servicioId}`
    const previo = habilidadesWritesRef.current[key] || Promise.resolve()
    const tarea = previo.catch(() => {}).then(async () => {
      const { error } = habilitar
        ? await supabase.from('barbero_servicios').upsert({ barbero_id: barberoId, servicio_id: servicio.id }, { onConflict: 'barbero_id,servicio_id', ignoreDuplicates: true })
        : await supabase.from('barbero_servicios').delete().eq('barbero_id', barberoId).eq('servicio_id', servicio.id)
      if (error) {
        setBarberos((prev) => prev.map((b) => {
          if (b.id !== barberoId) return b
          const actual = b.servicios || []
          const revertido = habilitar
            ? actual.filter((rel) => String(rel.servicio_id ?? rel.id) !== String(servicioId))
            : [...actual.filter((rel) => String(rel.servicio_id ?? rel.id) !== String(servicioId)), { barbero_id: barberoId, servicio_id: servicio.id }]
          return { ...b, servicios: revertido }
        }))
        reportError('No se pudo actualizar la habilidad del profesional', error)
        return false
      }
      // Copia de compatibilidad del texto heredado; la relación manda.
      await supabase.from('barberos').update({ habilidades: habilidadesJson }).eq('id', barberoId).eq('barberia_id', barberiaId)
      return true
    })
    habilidadesWritesRef.current[key] = tarea
    return tarea
  }

  const updateBarbero = async (id, field, value) => {
    const anterior = barberos.find((barbero) => barbero.id === id)
    let confirmedValue = anterior?.[field]
    let attemptedValue = value
    setBarberos((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)))
    if (!isSupabaseConfigured) return true

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
        attemptedValue = valorAGuardar
        let response
        try {
          response = await supabase.from('barberos').update({ [dbField]: valorAGuardar }).eq('id', id).eq('barberia_id', barberiaId).select('id')
        } catch (error) {
          response = { error }
        }
        const error = unconfirmedUpdate(response, id)
        if (!error) confirmedValue = valorAGuardar
        if (error && estado.latest === valorAGuardar) {
          if (anterior) setBarberos((prev) => restoreRejectedField(prev, id, field, valorAGuardar, confirmedValue))
          reportError('No se pudo actualizar el barbero', error)
        }
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
        if (estado.latest === valorAGuardar) return !error // no llegó nada nuevo mientras se guardaba
        // si llego un valor mas nuevo mientras se guardaba, el loop repite y lo manda
      }
    })().catch((error) => {
      if (estado.latest === attemptedValue && anterior) setBarberos((prev) => restoreRejectedField(prev, id, field, attemptedValue, confirmedValue))
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

  const deleteBloqueo = (id) => eliminarConDeshacer(bloqueos, setBloqueos, id, 'bloqueos_agenda', 'Día libre eliminado', 'No se pudo eliminar el día libre')

  // Tarea 41: bloquear y desbloquear fechas desde Agenda. A diferencia del
  // borrado diferido con Deshacer, acá el servidor confirma primero: un
  // bloqueo nunca desaparece de la pantalla mientras sigue vigente en la base
  // (y por lo tanto en la reserva web y WhatsApp). Deshacer lo vuelve a crear.
  const agregarBloqueosSinDuplicar = (filas) => setBloqueos((prev) => {
    const ids = new Set(prev.map((b) => String(b.id)))
    const nuevas = filas.filter((b) => !ids.has(String(b.id)))
    return nuevas.length ? [...prev, ...nuevas] : prev
  })
  // Sólo owner/admin pueden bloquear (bloqueos_write_owner). El resto no ve
  // el botón; la base igual rechaza cualquier intento.
  const puedeBloquear = puedeGestionarBloqueos(rol, { conBackend: isSupabaseConfigured && !demoMode })
  const MENSAJE_SIN_PERMISO_BLOQUEO = 'Sólo el dueño o un administrador del negocio pueden bloquear o desbloquear fechas.'

  const bloquearFechas = async ({ fechas, barberoId, tipo, detalle }) => {
    const filas = filasBloqueo({ fechas, barberoId, tipo, detalle, barberiaId })
    if (!filas.length) return { ok: false, mensaje: 'Elegí al menos una fecha.' }
    if (!isSupabaseConfigured) {
      setBloqueos((prev) => {
        const base = nextLocalId(prev)
        return [...prev, ...filas.map((fila, i) => ({ id: base + i, ...fila }))]
      })
      return { ok: true }
    }
    const resultado = await insertarBloqueos(supabase, filas)
    if (resultado.ok) {
      agregarBloqueosSinDuplicar(resultado.data)
      return { ok: true }
    }
    if (resultado.motivo === 'permiso') return { ok: false, mensaje: MENSAJE_SIN_PERMISO_BLOQUEO }
    reportClientError(resultado.error, { source: 'workspace', tenant_id: barberiaId, user_message: 'No se pudo guardar el bloqueo' })
    return { ok: false, mensaje: 'No se pudo guardar el bloqueo y no se bloqueó ninguna fecha. Revisá la conexión e intentá de nuevo.' }
  }

  // Turnos activos que alcanza un bloqueo: los parciales sólo cuentan los que
  // empiezan dentro de su franja.
  const turnosDelBloqueo = (lista, bloqueo) => turnosAfectados(lista, [bloqueo.fecha], bloqueo.barbero_id)
    .filter((t) => esBloqueoDiaCompleto(bloqueo)
      || (String(t.hora || '').slice(0, 5) >= String(bloqueo.start_time || '').slice(0, 5)
        && String(t.hora || '').slice(0, 5) < String(bloqueo.end_time || '').slice(0, 5)))

  const leerTurnosDelBloqueo = async (bloqueo) => {
    if (!isSupabaseConfigured) return { ok: true, turnos: turnosDelBloqueo(turnosRef.current, bloqueo) }
    const resultado = await consultarTurnosActivos(supabase, { barberiaId, fechas: [bloqueo.fecha], barberoId: bloqueo.barbero_id })
    return resultado.ok ? { ok: true, turnos: turnosDelBloqueo(resultado.turnos, bloqueo) } : resultado
  }

  // Deshacer un desbloqueo vuelve a crear la fila. Si mientras la fecha
  // estuvo libre entraron reservas, se conservan (como al bloquear) y se avisa.
  const restaurarBloqueo = async (bloqueo, turnosAntes) => {
    const fila = copiaParaRestaurar(bloqueo)
    if (!isSupabaseConfigured) {
      setBloqueos((prev) => [...prev, { id: nextLocalId(prev), ...fila }])
    } else {
      const resultado = await insertarBloqueos(supabase, [fila])
      if (!resultado.ok) {
        if (resultado.motivo === 'permiso') mostrarValidacion(MENSAJE_SIN_PERMISO_BLOQUEO)
        else reportError('No se pudo restaurar el bloqueo. La fecha sigue desbloqueada.', resultado.error)
        return
      }
      agregarBloqueosSinDuplicar(resultado.data)
    }
    const despues = await leerTurnosDelBloqueo(bloqueo)
    if (!despues.ok || !turnosAntes) {
      mostrarValidacion('Bloqueo restaurado. No pudimos revisar si se reservaron turnos mientras estuvo libre: revisá la Agenda de ese día.')
      return
    }
    const nuevos = turnosNuevos(turnosAntes, despues.turnos)
    if (nuevos.length) {
      mostrarValidacion(`Bloqueo restaurado. Mientras estuvo libre se ${nuevos.length === 1 ? 'reservó 1 turno' : `reservaron ${nuevos.length} turnos`} ese día: se conservan y no se avisó a nadie. Revisalos en la Agenda.`)
      return
    }
    mostrarToast({ mensaje: 'Bloqueo restaurado', duracion: DURACION_AVISO_MS })
  }

  // La advertencia antes de bloquear consulta la base: la lista del panel
  // puede no tener todos los turnos futuros.
  const revisarTurnosAfectados = async ({ fechas, barberoId }) => {
    if (!isSupabaseConfigured) return { ok: true, turnos: turnosAfectados(turnosRef.current, fechas, barberoId) }
    const resultado = await consultarTurnosActivos(supabase, { barberiaId, fechas, barberoId })
    if (!resultado.ok) reportClientError(resultado.error, { source: 'workspace', tenant_id: barberiaId, user_message: 'No se pudieron revisar los turnos del bloqueo' })
    return resultado
  }

  const desbloquearFecha = async (bloqueo) => {
    // Foto de los turnos antes de liberar la fecha, para el Deshacer.
    const antes = await leerTurnosDelBloqueo(bloqueo)
    const turnosAntes = antes.ok ? antes.turnos : null
    if (isSupabaseConfigured) {
      const resultado = await eliminarBloqueo(supabase, bloqueo.id, barberiaId)
      if (!resultado.ok) {
        if (resultado.motivo === 'permiso') return { ok: false, mensaje: MENSAJE_SIN_PERMISO_BLOQUEO }
        reportClientError(resultado.error, { source: 'workspace', tenant_id: barberiaId, user_message: 'No se pudo desbloquear la fecha' })
        return { ok: false, mensaje: 'No se pudo desbloquear. La fecha sigue bloqueada; revisá la conexión e intentá de nuevo.' }
      }
    }
    // Recién ahora, con el servidor confirmado, deja de mostrarse.
    setBloqueos((prev) => prev.filter((b) => b.id !== bloqueo.id))
    mostrarToast({ mensaje: 'Fecha desbloqueada', duracion: 5000, onUndo: () => { restaurarBloqueo(bloqueo, turnosAntes) } })
    return { ok: true }
  }

  const turnosHoy = turnos.filter((t) => t.fecha === todayKey).sort((a, b) => a.hora.localeCompare(b.hora))
  const unreadCount = conversaciones.filter((c) => c.noLeido).length
  const clientesConMensajes = new Set(conversaciones.filter((c) => c.clienteId != null && c.mensajes.length > 0).map((c) => c.clienteId))
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
            <div className="demo-mode-banner__actions"><button type="button" className="btn btn-primary" onClick={() => window.location.assign('/registro?source=demo')}>Crear mi cuenta</button><button type="button" className="btn" onClick={() => { if (!window.confirm('¿Reiniciar la demo y borrar los cambios temporales?')) return; resetDemoSession(demoSessionId); try { localStorage.removeItem(`austral-demo-settings:${barberiaId}`) } catch { /* sin almacenamiento no hay ajustes guardados */ } window.location.reload() }}>Reiniciar demo</button><button type="button" className="btn btn-ghost" onClick={() => window.location.assign('/')}>Salir</button></div>
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

        {view === 'resumen' && (
          <div className="fade-in view-fit view-fit--resumen">
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
                    {/* En escritorio el panel ocupa el alto disponible y la lista scrollea
                        adentro; la página no se mueve. */}
                    <div className="resumen-agenda-list">
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
          <div className="fade-in view-fit view-fit--agenda">
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
                {puedeBloquear && (
                  <button className="btn agenda-block-btn" onClick={() => setBloqueosOpen(true)} aria-haspopup="dialog" title="Bloquear o desbloquear fechas">
                    <Ban size={15} strokeWidth={2.25} aria-hidden="true" />
                    Bloquear
                  </button>
                )}
              </div>
            </div>
            {loading ? <SkeletonBlock height={420} /> : (
              <Calendar
                turnos={turnos}
                todayKey={todayKey}
                onChangeEstado={pedirEstadoOCobro}
                onDeleteTurno={deleteTurno}
                onEditTurno={openEditTurno}
                onMoverTurno={moverTurno}
                notas={notas}
                onAddNota={addNota}
                onNewTurno={openNewTurnoConFecha}
                onSelectDate={setAgendaFecha}
                barberos={barberos}
                bloqueos={bloqueos}
              />
            )}
          </div>
        )}

        {view === 'equipo' && (
          <div className="fade-in view-fit view-fit--equipo">
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
          <div className="fade-in view-fit view-fit--mensajes">
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
                focusRequest={chatFocusRequest}
                onFocusRequestHandled={consumirFocoChat}
                estadoChatPorCliente={estadoChatPorCliente}
                botDisponible={!demoMode && whatsappIntegration.connected && whatsappIntegration.automationEnabled}
                botGeneralActivo={botActivo}
                onToggleBotChat={alternarBotChat}
              />
            )}
          </div>
        )}

        {view === 'clientes' && (
          <div className="fade-in view-fit view-fit--clientes">
            <div className="page-header">
              <div>
                <p className="page-kicker">Base de datos</p>
                <h1 className="page-title">Clientes</h1>
              </div>
            </div>
            {loading ? <SkeletonBlock height={320} /> : (
              <div className="panel">
                <Clientes
                  pacientes={pacientes}
                  notas={notas}
                  turnos={turnos}
                  todayKey={todayKey}
                  onViewNotes={verNotasDePaciente}
                  onAddPaciente={addPaciente}
                  onUpdatePaciente={updatePaciente}
                  onDeletePaciente={deletePaciente}
                  onStartChat={iniciarChatCliente}
                  clientesConMensajes={clientesConMensajes}
                />
              </div>
            )}
          </div>
        )}

        {view === 'notas' && (
          <div className="fade-in view-fit view-fit--notas">
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
                filtroClienteId={notasFiltro?.clienteId}
                onClearCliente={() => setNotasFiltro('')}
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
              <Stats turnos={turnos} pacientes={pacientes} conversaciones={conversaciones} todayKey={todayKey} barberos={barberos} servicios={servicios} pagos={pagos} pagosEstado={pagosEstado} timezone={zonaHoraria} />
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
                onToggleServicioBarbero={toggleServicioBarbero}
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

      <BloqueosModal
        open={bloqueosOpen && puedeBloquear}
        onClose={() => setBloqueosOpen(false)}
        fechaInicial={agendaFecha || todayKey}
        todayKey={todayKey}
        barberos={barberos}
        bloqueos={bloqueos}
        turnos={turnos}
        onRevisarTurnos={revisarTurnosAfectados}
        onBloquear={bloquearFechas}
        onDesbloquear={desbloquearFecha}
      />

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

      <Toaster toasts={toasts} onClose={cerrarToast} />
      <TopProgress />
    </div>
  )
}
