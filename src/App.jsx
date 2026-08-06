import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Info, CalendarCheck, MessageCircle, Plus, Bot, Download, AlertTriangle, X } from 'lucide-react'
import NewTurnoModal from './components/NewTurnoModal'
import CobroModal from './components/CobroModal'
import { logout } from './components/Login.jsx'
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
import { supabase, isSupabaseConfigured } from './lib/supabaseClient'
import { generarIdHabilidad, parseHabilidades, parseHorarioTexto, soloDigitos } from './lib/text'
import { DEFAULT_BUSINESS_NAME, tenantStorageKey } from './lib/tenant'
import {
  mockBarberiaConfig,
  mockBarberos,
  mockConversaciones,
  mockNotas,
  mockPacientes,
  mockServicios,
  mockTurnos,
} from './data/mockData'

const TZ = 'America/Argentina/Buenos_Aires'
const LEGACY_THEME_KEY = 'barberia-central-theme'
const N8N_SEND_WEBHOOK_URL = import.meta.env.VITE_N8N_SEND_WEBHOOK_URL || ''

function nextLocalId(items) {
  return Math.max(0, ...items.map((item) => Number(item.id) || 0)) + 1
}

function servicioFromDb(row) {
  return { ...row, duracion: row.duracion_min }
}

function barberoFromDb(row) {
  return { ...row, horario: row.horario_texto, rol: row.especialidad }
}

function turnoFromDb(row) {
  return { ...row, duracion: row.duracion_min }
}

function todayInClinicTZ() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

function initialTheme(tenantId) {
  const saved = localStorage.getItem(tenantStorageKey('theme', tenantId)) || localStorage.getItem(LEGACY_THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function SkeletonBlock({ height = 90 }) {
  return <div className="skeleton" style={{ height, width: '100%', marginBottom: 10 }} />
}

export default function App({ barberiaId, barberiaNombre, vertical: _vertical }) {
  const themeKey = tenantStorageKey('theme', barberiaId)
  const [view, setView] = useState('resumen')
  const [turnos, setTurnos] = useState(mockTurnos)
  const [conversaciones, setConversaciones] = useState(mockConversaciones)
  const [pacientes, setPacientes] = useState(mockPacientes)
  const [notas, setNotas] = useState(mockNotas)
  const [servicios, setServicios] = useState(mockServicios)
  const [barberos, setBarberos] = useState(mockBarberos)
  const [bloqueos, setBloqueos] = useState([])
  const [pagos, setPagos] = useState([])
  const [cobroTurno, setCobroTurno] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [theme, setTheme] = useState(() => initialTheme(barberiaId))
  const [newTurnoOpen, setNewTurnoOpen] = useState(false)
  const [editingTurno, setEditingTurno] = useState(null)
  const [turnoFechaPrefijada, setTurnoFechaPrefijada] = useState(null)
  const [notasFiltro, setNotasFiltro] = useState('')
  const [botActivo, setBotActivo] = useState(true)
  const [dbError, setDbError] = useState('')

  const reportError = (mensaje, error) => {
    console.error(mensaje, error)
    setDbError(`${mensaje}: ${error?.message || 'error desconocido'}`)
  }

  const todayKey = todayInClinicTZ()

  useEffect(() => {
    setTheme(initialTheme(barberiaId))
  }, [barberiaId])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(themeKey, theme)
  }, [theme, themeKey])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const toggleBot = async () => {
    const nuevo = !botActivo
    const anterior = botActivo
    setBotActivo(nuevo)
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('config')
        .upsert({ barberia_id: barberiaId, clave: 'bot_activo', valor: String(nuevo) })
      if (error) {
        setBotActivo(anterior)
        reportError('No se pudo cambiar el estado del bot', error)
      }
    }
  }

  const verNotasDePaciente = (nombre) => {
    setNotasFiltro(nombre)
    setView('notas')
  }

  const navigateFromMenu = (v) => {
    setNotasFiltro('')
    setView(v)
  }

  useEffect(() => {
    if (!isSupabaseConfigured) return

    async function cargarTurnos() {
      const { data, error } = await supabase
        .from('turnos').select('*').eq('barberia_id', barberiaId).order('fecha').order('hora')
      if (error) reportError('No se pudieron cargar los turnos', error)
      setTurnos((data ?? []).map(turnoFromDb))
    }

    async function cargarClientes() {
      const { data, error } = await supabase.from('clientes').select('*').eq('barberia_id', barberiaId)
      if (error) reportError('No se pudieron cargar los clientes', error)
      setPacientes(data ?? [])
    }

    async function cargarNotas() {
      const { data, error } = await supabase
        .from('notas').select('*').eq('barberia_id', barberiaId).order('fecha', { ascending: false })
      if (error) reportError('No se pudieron cargar las notas', error)
      setNotas(data ?? [])
    }

    async function cargarServicios() {
      const { data, error } = await supabase
        .from('servicios').select('*').eq('barberia_id', barberiaId).order('nombre')
      if (error) reportError('No se pudieron cargar los servicios', error)
      if (data) setServicios(data.map(servicioFromDb))
    }

    async function cargarBarberos() {
      const { data, error } = await supabase
        .from('barberos').select('*').eq('barberia_id', barberiaId).order('nombre')
      if (error) reportError('No se pudieron cargar los barberos', error)
      // OJO: "habilidades" queda tal cual viene de la base (texto JSON), no
      // se parsea acá. El único lugar que la convierte a array es
      // parseHabilidades() (lib/text.js), justo antes de usarla. Si se
      // parsea acá Y en parseHabilidades, el segundo parseo se rompe
      // (JSON.parse de un array ya parseado tira error) y todas las
      // habilidades quedan "vacías" apenas se recarga la lista.
      if (data) setBarberos(data.map(barberoFromDb))
    }

    async function cargarConfig() {
      const { data } = await supabase
        .from('config').select('*').eq('barberia_id', barberiaId).eq('clave', 'bot_activo').maybeSingle()
      if (data) setBotActivo(data.valor === 'true')
    }

    async function cargarBloqueos() {
      const { data, error } = await supabase
        .from('bloqueos_agenda').select('*').eq('barberia_id', barberiaId).order('fecha')
      if (error) reportError('No se pudieron cargar los días libres', error)
      setBloqueos(data ?? [])
    }

    async function cargarPagos() {
      const { data, error } = await supabase
        .from('pagos').select('*').eq('barberia_id', barberiaId).order('created_at', { ascending: false })
      if (error) reportError('No se pudieron cargar los pagos', error)
      setPagos(data ?? [])
    }

    async function cargarMensajes() {
      const [{ data }, { data: clientesData }] = await Promise.all([
        supabase.from('mensajes').select('*').eq('barberia_id', barberiaId).order('created_at'),
        supabase.from('clientes').select('id, nombre').eq('barberia_id', barberiaId),
      ])

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

    async function cargarTodo() {
      setLoading(true)
      await Promise.all([
        cargarTurnos(),
        cargarClientes(),
        cargarNotas(),
        cargarServicios(),
        cargarBarberos(),
        cargarConfig(),
        cargarMensajes(),
        cargarBloqueos(),
        cargarPagos(),
      ])
      setLoading(false)
    }

    cargarTodo()

    let channel = null
    let cancelado = false

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
        console.log('[realtime] evento en mensajes:', payload)
        cargarMensajes()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos', filter: `barberia_id=eq.${barberiaId}` }, () => cargarTurnos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notas', filter: `barberia_id=eq.${barberiaId}` }, () => cargarNotas())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes', filter: `barberia_id=eq.${barberiaId}` }, () => { cargarClientes(); cargarMensajes() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios', filter: `barberia_id=eq.${barberiaId}` }, () => cargarServicios())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'barberos', filter: `barberia_id=eq.${barberiaId}` }, () => cargarBarberos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config', filter: `barberia_id=eq.${barberiaId}` }, () => cargarConfig())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bloqueos_agenda', filter: `barberia_id=eq.${barberiaId}` }, () => cargarBloqueos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos', filter: `barberia_id=eq.${barberiaId}` }, () => cargarPagos())
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('[realtime] conectado OK')
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.error('[realtime] problema con la suscripcion:', status, err)
        }
      })
    }

    suscribirRealtime()

    // Respaldo por polling: pase lo que pase con el realtime, esto refresca
    // solo cada 6 segundos las pantallas que mas necesitan verse "en vivo"
    // durante la demo. Es una red de seguridad, no reemplaza el fix de
    // realtime pero garantiza que el panel se actualice solo igual.
    const intervalo = setInterval(() => {
      cargarMensajes()
      cargarTurnos()
      cargarClientes()
      cargarPagos()
    }, 6000)

    return () => {
      cancelado = true
      if (channel) supabase.removeChannel(channel)
      clearInterval(intervalo)
    }
  }, [barberiaId])

  const addNota = async (nueva) => {
    const conFecha = { ...nueva, fecha: todayKey }
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('notas').insert({ ...conFecha, barberia_id: barberiaId }).select()
      if (error) { reportError('No se pudo guardar la nota', error); return }
      if (data?.[0]) setNotas((prev) => [data[0], ...prev])
      return
    }
    setNotas((prev) => [{ id: nextLocalId(prev), ...conFecha }, ...prev])
  }

  const openConversation = async (convId) => {
    setSelectedConversationId(convId)
    setView('mensajes')

    const conv = conversaciones.find((c) => c.id === convId)

    setConversaciones((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, noLeido: false, mensajes: c.mensajes.map((m) => ({ ...m, leido: true })) } : c))
    )

    if (isSupabaseConfigured && conv) {
      const base = supabase.from('mensajes').update({ leido: true }).eq('barberia_id', barberiaId).eq('leido', false)
      const { error } = conv.clienteId != null
        ? await base.eq('cliente_id', conv.clienteId)
        : await base.eq('paciente', conv.paciente)
      if (error) reportError('No se pudo marcar la conversacion como leida', error)
    }
  }

  const updateTurnoEstado = async (turnoId, nuevoEstado) => {
    const estadoAnterior = turnos.find((t) => t.id === turnoId)?.estado
    setTurnos((prev) => prev.map((t) => (t.id === turnoId ? { ...t, estado: nuevoEstado } : t)))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('turnos').update({ estado: nuevoEstado }).eq('id', turnoId)
      if (error) {
        setTurnos((prev) => prev.map((t) => (t.id === turnoId ? { ...t, estado: estadoAnterior } : t)))
        reportError('No se pudo actualizar el estado del turno', error)
      }
    }
  }

  // Antes de marcar un turno como "Atendido" pedimos cómo se cobró. El
  // estado del turno recién se actualiza cuando se confirma el cobro
  // (o si cancela el modal, el turno se queda como estaba).
  const pedirEstadoOCobro = (turnoId, nuevoEstado) => {
    if (nuevoEstado !== 'atendido') {
      updateTurnoEstado(turnoId, nuevoEstado)
      return
    }
    const turno = turnos.find((t) => t.id === turnoId)
    if (turno) setCobroTurno(turno)
  }

  const confirmarCobro = async ({ monto, metodo }) => {
    if (!cobroTurno) return
    const turno = cobroTurno
    await updateTurnoEstado(turno.id, 'atendido')

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

  const deleteTurno = async (turnoId) => {
    const turnoAnterior = turnos.find((t) => t.id === turnoId)
    const indiceAnterior = turnos.findIndex((t) => t.id === turnoId)
    setTurnos((prev) => prev.filter((t) => t.id !== turnoId))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('turnos').delete().eq('id', turnoId)
      if (error) {
        setTurnos((prev) => {
          if (!turnoAnterior || prev.some((t) => t.id === turnoId)) return prev
          const restaurados = [...prev]
          restaurados.splice(Math.max(0, Math.min(indiceAnterior, restaurados.length)), 0, turnoAnterior)
          return restaurados
        })
        reportError('No se pudo eliminar el turno', error)
      }
    }
  }

  const saveTurno = async ({ paciente, telefono, clienteId, fecha, hora, motivo, estado, servicio_id, barbero_id, precio, duracion }, existingId) => {
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
            reportError('No se pudo guardar el cliente nuevo', error)
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

    const payload = { paciente, fecha, hora, motivo, estado, servicio_id, barbero_id, precio, duracion, clienteId: finalClienteId }
    const dbPayload = {
      paciente,
      fecha,
      hora,
      motivo,
      estado,
      servicio_id,
      barbero_id,
      precio,
      duracion_min: duracion,
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
          reportError('No se pudo guardar el turno', error)
        }
      }
      return
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('turnos').insert({ ...dbPayload, barberia_id: barberiaId }).select()
      if (error) { reportError('No se pudo crear el turno', error); return }
      if (data?.[0]) setTurnos((prev) => [...prev, turnoFromDb(data[0])])
    } else {
      setTurnos((prev) => [...prev, { id: nextLocalId(prev), ...payload, cliente_id: finalClienteId, origen: existingId ? undefined : 'panel' }])
    }
  }

  const openNewTurno = () => { setEditingTurno(null); setTurnoFechaPrefijada(null); setNewTurnoOpen(true) }
  const openNewTurnoConFecha = (fecha) => { setEditingTurno(null); setTurnoFechaPrefijada(fecha); setNewTurnoOpen(true) }
  const openEditTurno = (turno) => { setEditingTurno(turno); setTurnoFechaPrefijada(null); setNewTurnoOpen(true) }
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
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('clientes').update(cambios).eq('id', id)
      if (error) {
        if (anterior) setPacientes((prev) => prev.map((p) => (p.id === id ? anterior : p)))
        reportError('No se pudo actualizar el cliente', error)
      }
    }
  }

  const deletePaciente = async (id) => {
    const anterior = pacientes.find((p) => p.id === id)
    const indiceAnterior = pacientes.findIndex((p) => p.id === id)
    setPacientes((prev) => prev.filter((p) => p.id !== id))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('clientes').delete().eq('id', id)
      if (error) {
        setPacientes((prev) => {
          if (!anterior || prev.some((p) => p.id === id)) return prev
          const restaurados = [...prev]
          restaurados.splice(Math.max(0, Math.min(indiceAnterior, restaurados.length)), 0, anterior)
          return restaurados
        })
        reportError('No se pudo eliminar el cliente', error)
      }
    }
  }

  const updateNota = async (id, texto) => {
    const anterior = notas.find((n) => n.id === id)
    setNotas((prev) => prev.map((n) => (n.id === id ? { ...n, texto } : n)))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('notas').update({ texto }).eq('id', id)
      if (error) {
        if (anterior) setNotas((prev) => prev.map((n) => (n.id === id ? anterior : n)))
        reportError('No se pudo actualizar la nota', error)
      }
    }
  }

  const deleteNota = async (id) => {
    const anterior = notas.find((n) => n.id === id)
    const indiceAnterior = notas.findIndex((n) => n.id === id)
    setNotas((prev) => prev.filter((n) => n.id !== id))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('notas').delete().eq('id', id)
      if (error) {
        setNotas((prev) => {
          if (!anterior || prev.some((n) => n.id === id)) return prev
          const restauradas = [...prev]
          restauradas.splice(Math.max(0, Math.min(indiceAnterior, restauradas.length)), 0, anterior)
          return restauradas
        })
        reportError('No se pudo eliminar la nota', error)
      }
    }
  }

  const sendMensaje = async (paciente, texto, clienteId) => {
    const horaActual = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date())
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
      const { error } = await supabase.from('mensajes').insert({ ...nuevoMensaje, barberia_id: barberiaId })
      if (error) {
        setConversaciones((prev) => prev.map((c) => {
          if (!esLaConversacion(c)) return c
          return { ...c, mensajes: mensajesAnteriores, ultimaHora: conversacionAnterior?.ultimaHora ?? null, ultimoCreatedAt: conversacionAnterior?.ultimoCreatedAt ?? new Date(0).toISOString() }
        }))
        reportError('No se pudo guardar el mensaje', error)
      }
    }

    const telefono = clienteId ? pacientes.find((p) => p.id === clienteId)?.telefono : null
    if (telefono && N8N_SEND_WEBHOOK_URL) {
      try {
        const res = await fetch(N8N_SEND_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefono, texto }),
        })
        if (!res.ok) reportError('El mensaje se guardo pero no se pudo enviar por WhatsApp', new Error(`HTTP ${res.status}`))
      } catch (err) {
        reportError('El mensaje se guardo pero no se pudo enviar por WhatsApp', err)
      }
    } else if (!telefono) {
      reportError('No se pudo enviar por WhatsApp', new Error('Este cliente no tiene un telefono cargado en su ficha'))
    }

    if (botActivo) {
      setBotActivo(false)
      if (isSupabaseConfigured) {
        const { error } = await supabase
          .from('config')
          .upsert({ barberia_id: barberiaId, clave: 'bot_activo', valor: 'false' })
        if (error) reportError('No se pudo apagar el bot', error)
      }
    }
  }

  const addServicio = async () => {
    const base = { nombre: 'Nuevo servicio', precio: 0, duracion: 30, activo: true }
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('servicios')
        .insert({ nombre: base.nombre, precio: base.precio, duracion_min: base.duracion, activo: base.activo, barberia_id: barberiaId })
        .select()
      if (error) { reportError('No se pudo crear el servicio', error); return }
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
    } else {
      setServicios((prev) => [...prev, { id: nextLocalId(prev), ...base }])
    }
  }

  const updateServicio = async (id, field, value) => {
    const parsed = field === 'nombre' ? value : Number(value) || 0
    const anterior = servicios.find((s) => s.id === id)
    setServicios((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: parsed } : s)))
    if (isSupabaseConfigured) {
      const dbField = field === 'duracion' ? 'duracion_min' : field
      const { error } = await supabase.from('servicios').update({ [dbField]: parsed }).eq('id', id)
      if (error) {
        if (anterior) setServicios((prev) => prev.map((s) => (s.id === id ? anterior : s)))
        reportError('No se pudo actualizar el servicio', error)
      }
    }
  }

  const reactivarServicio = async (id) => {
    const anterior = servicios.find((s) => s.id === id)
    setServicios((prev) => prev.map((s) => (s.id === id ? { ...s, activo: true } : s)))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('servicios').update({ activo: true }).eq('id', id)
      if (error) {
        if (anterior) setServicios((prev) => prev.map((s) => (s.id === id ? anterior : s)))
        reportError('No se pudo reactivar el servicio', error)
      }
    }
  }

  const deleteServicio = async (id) => {
    if (!isSupabaseConfigured) {
      setServicios((prev) => prev.filter((s) => s.id !== id))
      return
    }

    const { error } = await supabase.from('servicios').delete().eq('id', id)

    if (!error) {
      setServicios((prev) => prev.filter((s) => s.id !== id))
      return
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
        return
      }
      if (data?.[0]) setServicios((prev) => prev.map((s) => (s.id === id ? servicioFromDb(data[0]) : s)))
      setDbError('Este servicio tiene turnos asociados, asi que no se puede borrar sin perder ese historial. Lo desactivamos: ya no va a aparecer para agendar turnos nuevos.')
      return
    }

    reportError('No se pudo eliminar el servicio', error)
  }

  const addBarbero = async () => {
    const base = { nombre: `Barbero ${barberos.length + 1}`, rol: 'Barbero', color: '#9B6A2F', horario: 'Lun, Mar, Mié, Jue y Vie 09:00-18:00', activo: true }
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('barberos')
        .insert({ nombre: base.nombre, especialidad: base.rol, color: base.color, horario_texto: base.horario, activo: base.activo, barberia_id: barberiaId })
        .select()
      if (error) { reportError('No se pudo crear el barbero', error); return }
      if (data?.[0]) {
        const nuevoBarbero = data[0]
        // El alta conserva el horario inicial que muestra el panel y deja al
        // profesional disponible para los servicios activos. De esta forma la
        // reserva pública y el panel no se desincronizan al crear equipo.
        const horariosIniciales = [1, 2, 3, 4, 5].map((day_of_week) => ({
          barberia_id: barberiaId, barbero_id: nuevoBarbero.id, day_of_week,
          start_time: '09:00', end_time: '18:00', activo: true,
        }))
        const { error: horarioError } = await supabase.from('horarios_barbero').insert(horariosIniciales)
        if (horarioError) reportError('El barbero fue creado, pero no se pudieron guardar sus horarios', horarioError)
        const relaciones = servicios.filter((s) => s.activo).map((s) => ({ barbero_id: nuevoBarbero.id, servicio_id: s.id }))
        if (relaciones.length) {
          const { error: serviciosError } = await supabase.from('barbero_servicios').insert(relaciones)
          if (serviciosError) reportError('El barbero fue creado, pero no se pudieron guardar sus servicios', serviciosError)
        }
        setBarberos((prev) => [...prev, barberoFromDb(nuevoBarbero)])
      }
    } else {
      setBarberos((prev) => [...prev, { id: nextLocalId(prev), ...base }])
    }
  }

  // Guarda, para cada (barbero, campo), cuál es el último valor que el
  // usuario pidió guardar y si ya hay un guardado en curso para ese par.
  // Así, si tocás/destocás rápido una habilidad, los guardados a Supabase
  // salen siempre de a uno y en orden — nunca se pisan entre sí ni puede
  // "ganar" un click viejo por llegar después que uno nuevo.
  const barberoWritesRef = useRef({})

  const updateBarbero = async (id, field, value) => {
    setBarberos((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)))
    if (!isSupabaseConfigured) return

    const key = `${id}:${field}`
    const estado = barberoWritesRef.current[key] || { inFlight: false, latest: value }
    estado.latest = value
    barberoWritesRef.current[key] = estado

    if (estado.inFlight) return // ya hay un guardado de este campo en curso, el loop de abajo lo va a mandar solo

    const dbFieldMap = { rol: 'especialidad', horario: 'horario_texto', habilidades: 'habilidades' }
    const dbField = dbFieldMap[field] || field

    estado.inFlight = true
    try {
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
        }
        if (!error && field === 'horario') {
          const franjas = parseHorarioTexto(valorAGuardar)
          if (!franjas) {
            setDbError('El texto del horario se guardó, pero no pudimos convertirlo en agenda. Usá un formato como “Lun, Mar y Vie 09:00-18:00” o agregá “break 13:00-14:00”.')
          } else {
            const { error: borrarError } = await supabase.from('horarios_barbero').delete().eq('barbero_id', id)
            if (borrarError) reportError('No se pudo actualizar la agenda del barbero', borrarError)
            else {
              const { error: crearError } = await supabase.from('horarios_barbero').insert(
                franjas.map((franja) => ({ ...franja, barberia_id: barberiaId, barbero_id: id, activo: true }))
              )
              if (crearError) reportError('No se pudo actualizar la agenda del barbero', crearError)
            }
          }
        }
        if (estado.latest === valorAGuardar) break // no llego nada nuevo mientras se guardaba, listo
        // si llego un valor mas nuevo mientras se guardaba, el loop repite y lo manda
      }
    } finally {
      estado.inFlight = false
    }
  }

  const deleteBarbero = async (id) => {
    const anterior = barberos.find((b) => b.id === id)
    const indiceAnterior = barberos.findIndex((b) => b.id === id)
    setBarberos((prev) => prev.filter((b) => b.id !== id))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('barberos').delete().eq('id', id)
      if (error) {
        setBarberos((prev) => {
          if (!anterior || prev.some((b) => b.id === id)) return prev
          const restaurados = [...prev]
          restaurados.splice(Math.max(0, Math.min(indiceAnterior, restaurados.length)), 0, anterior)
          return restaurados
        })
        reportError('No se pudo eliminar el barbero', error)
      }
    }
  }

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

  const deleteBloqueo = async (id) => {
    const anterior = bloqueos.find((b) => b.id === id)
    const indiceAnterior = bloqueos.findIndex((b) => b.id === id)
    setBloqueos((prev) => prev.filter((b) => b.id !== id))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('bloqueos_agenda').delete().eq('id', id)
      if (error) {
        setBloqueos((prev) => {
          if (!anterior || prev.some((b) => b.id === id)) return prev
          const restaurados = [...prev]
          restaurados.splice(Math.max(0, Math.min(indiceAnterior, restaurados.length)), 0, anterior)
          return restaurados
        })
        reportError('No se pudo eliminar el día libre', error)
      }
    }
  }

  const turnosHoy = turnos.filter((t) => t.fecha === todayKey).sort((a, b) => a.hora.localeCompare(b.hora))
  const unreadCount = conversaciones.filter((c) => c.noLeido).length
  const hoyLegible = format(new Date(`${todayKey}T12:00:00`), "EEEE d 'de' MMMM", { locale: es })

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        setView={navigateFromMenu}
        clinicName={barberiaNombre || DEFAULT_BUSINESS_NAME}
        unreadCount={unreadCount}
        theme={theme}
        onToggleTheme={toggleTheme}
        botActivo={botActivo}
        onToggleBot={toggleBot}
        onLogout={logout}
      />
      <main className="main">
        {!isSupabaseConfigured && (
          <div className="demo-banner">
            <Info size={15} />
            Mostrando datos de ejemplo. Conecta Supabase en <code>.env</code> para ver datos reales de la barberia.
          </div>
        )}

        {dbError && (
          <div
            className="demo-banner"
            style={{ background: 'var(--rose-soft)', color: 'var(--rose-text)', cursor: 'pointer' }}
            onClick={() => setDbError('')}
          >
            <AlertTriangle size={15} />
            {dbError}
            <X size={14} style={{ marginLeft: 'auto' }} />
          </div>
        )}

        {!botActivo && (
          <div className="demo-banner" style={{ background: 'var(--rose-soft)', color: 'var(--rose-text)' }}>
            <Bot size={15} />
            El bot de WhatsApp esta desactivado. Estas atendiendo los mensajes manualmente. Lo reactivas desde el interruptor del menu.
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
                <StatsCards turnos={turnosHoy} conversaciones={conversaciones} todayKey={todayKey} />
                <div className="two-col">
                  <div className="panel resumen-agenda-panel">
                    <p className="panel-title">
                      <span className="panel-title-icon"><CalendarCheck size={16} style={{ color: 'var(--accent)' }} />Agenda de hoy</span>
                      <button className="link-btn" onClick={openNewTurno}>
                        <Plus size={13} strokeWidth={2.5} />
                        Nuevo
                      </button>
                    </p>
                    <div className="resumen-agenda-scroll">
                      <Agenda
                        turnos={turnosHoy}
                        onChangeEstado={pedirEstadoOCobro}
                        onDeleteTurno={deleteTurno}
                        onEditTurno={openEditTurno}
                        notas={notas}
                        onAddNota={addNota}
                        barberos={barberos}
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
            <div className="page-header">
              <div>
                <p className="page-kicker">Calendario operativo</p>
                <h1 className="page-title">Agenda</h1>
              </div>
              <div className="page-actions">
                <span className="page-date">{turnos.length} turnos en total</span>
                <button
                  className="btn"
                  onClick={() => exportarCSV('turnos.csv', turnos, [
                    { key: 'fecha', label: 'Fecha' },
                    { key: 'hora', label: 'Hora' },
                    { key: 'paciente', label: 'Cliente' },
                    { key: 'motivo', label: 'Motivo' },
                    { key: 'estado', label: 'Estado' },
                  ])}
                >
                  <Download size={14} />
                  Exportar
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
              <span className="page-date">Que tiene agendado cada barbero</span>
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
              <Stats turnos={turnos} pacientes={pacientes} conversaciones={conversaciones} todayKey={todayKey} barberos={barberos} servicios={servicios} pagos={pagos} />
            )}
          </div>
        )}

        {view === 'operacion' && (
          <div className="fade-in">
            <div className="page-header">
              <div>
                <p className="page-kicker">Configuracion comercial</p>
                <h1 className="page-title">Operacion</h1>
              </div>
              <span className="page-date">Precios, duracion y barberos disponibles</span>
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
      </main>

      <NewTurnoModal
        open={newTurnoOpen}
        onClose={closeTurnoModal}
        onSubmit={saveTurno}
        defaultDate={turnoFechaPrefijada || todayKey}
        turnoExistente={editingTurno}
        turnosExistentes={turnos}
        servicios={servicios}
        barberos={barberos}
        clientes={pacientes}
        bloqueos={bloqueos}
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
