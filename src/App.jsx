import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { Info, CalendarCheck, MessageCircle, Plus, Bot, Download, AlertTriangle, X } from 'lucide-react'
import NewTurnoModal from './components/NewTurnoModal'
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
import {
  mockBarberiaConfig,
  mockBarberos,
  mockConversaciones,
  mockNotas,
  mockPacientes,
  mockServicios,
  mockTurnos,
} from './data/mockData'

const CLINIC_NAME = 'Barberia Central'
const TZ = 'America/Argentina/Buenos_Aires'
const THEME_KEY = 'barberia-central-theme'
const BARBERIA_ID = Number(import.meta.env.VITE_BARBERIA_ID) || 1
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

function initialTheme() {
  const saved = localStorage.getItem(THEME_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function SkeletonBlock({ height = 90 }) {
  return <div className="skeleton" style={{ height, width: '100%', marginBottom: 10 }} />
}

export default function App() {
  const [view, setView] = useState('resumen')
  const [turnos, setTurnos] = useState(mockTurnos)
  const [conversaciones, setConversaciones] = useState(mockConversaciones)
  const [pacientes, setPacientes] = useState(mockPacientes)
  const [notas, setNotas] = useState(mockNotas)
  const [servicios, setServicios] = useState(mockServicios)
  const [barberos, setBarberos] = useState(mockBarberos)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [selectedConversationId, setSelectedConversationId] = useState(null)
  const [theme, setTheme] = useState(initialTheme)
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
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  const toggleBot = async () => {
    const nuevo = !botActivo
    setBotActivo(nuevo)
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from('config')
        .upsert({ barberia_id: BARBERIA_ID, clave: 'bot_activo', valor: String(nuevo) })
      if (error) reportError('No se pudo cambiar el estado del bot', error)
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
        .from('turnos').select('*').eq('barberia_id', BARBERIA_ID).order('fecha').order('hora')
      if (error) reportError('No se pudieron cargar los turnos', error)
      setTurnos((data ?? []).map(turnoFromDb))
    }

    async function cargarClientes() {
      const { data, error } = await supabase.from('clientes').select('*').eq('barberia_id', BARBERIA_ID)
      if (error) reportError('No se pudieron cargar los clientes', error)
      setPacientes(data ?? [])
    }

    async function cargarNotas() {
      const { data, error } = await supabase
        .from('notas').select('*').eq('barberia_id', BARBERIA_ID).order('fecha', { ascending: false })
      if (error) reportError('No se pudieron cargar las notas', error)
      setNotas(data ?? [])
    }

    async function cargarServicios() {
      const { data, error } = await supabase
        .from('servicios').select('*').eq('barberia_id', BARBERIA_ID).order('nombre')
      if (error) reportError('No se pudieron cargar los servicios', error)
      if (data) setServicios(data.map(servicioFromDb))
    }

    async function cargarBarberos() {
      const { data, error } = await supabase
        .from('barberos').select('*').eq('barberia_id', BARBERIA_ID).order('nombre')
      if (error) reportError('No se pudieron cargar los barberos', error)
      if (data) {
        const barberosConHabilidades = data.map(b => ({
          ...barberoFromDb(b),
          habilidades: b.habilidades ? JSON.parse(b.habilidades) : []
        }))
        setBarberos(barberosConHabilidades)
      }
    }

    async function cargarConfig() {
      const { data } = await supabase
        .from('config').select('*').eq('barberia_id', BARBERIA_ID).eq('clave', 'bot_activo').maybeSingle()
      if (data) setBotActivo(data.valor === 'true')
    }

    async function cargarMensajes() {
      const [{ data }, { data: clientesData }] = await Promise.all([
        supabase.from('mensajes').select('*').eq('barberia_id', BARBERIA_ID).order('created_at'),
        supabase.from('clientes').select('id, nombre').eq('barberia_id', BARBERIA_ID),
      ])

      // Agrupamos por cliente_id, NO por nombre. Si agrupáramos por nombre,
      // un mismo cliente puede aparecer duplicado apenas el texto no calza
      // exacto (ej: se cargó "Lauta" desde Agendar o desde el bot, y en el
      // mensaje quedó guardado "Lauta Gómez" — dos claves distintas, mismo
      // cliente). El cliente_id no cambia nunca, así que es la clave correcta.
      const agrupados = {}
      for (const m of data ?? []) {
        const key = m.cliente_id != null ? `id-${m.cliente_id}` : `sin-id-${m.paciente}`
        if (!agrupados[key]) {
          agrupados[key] = { id: key, paciente: m.paciente, clienteId: m.cliente_id ?? null, ultimaHora: m.hora, ultimoCreatedAt: m.created_at, noLeido: false, mensajes: [] }
        }
        agrupados[key].mensajes.push(m)
        agrupados[key].ultimaHora = m.hora
        agrupados[key].ultimoCreatedAt = m.created_at
        agrupados[key].paciente = m.paciente
        if (m.cliente_id) agrupados[key].clienteId = m.cliente_id
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
      ])
      setLoading(false)
    }

    cargarTodo()

    const channel = supabase
      .channel('dashboard-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mensajes' }, () => cargarMensajes())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'turnos' }, () => cargarTurnos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notas' }, () => cargarNotas())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => { cargarClientes(); cargarMensajes() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'servicios' }, () => cargarServicios())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'barberos' }, () => cargarBarberos())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config' }, () => cargarConfig())
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const addNota = async (nueva) => {
    const conFecha = { ...nueva, fecha: todayKey }
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('notas').insert({ ...conFecha, barberia_id: BARBERIA_ID }).select()
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
      const base = supabase.from('mensajes').update({ leido: true }).eq('barberia_id', BARBERIA_ID).eq('leido', false)
      const { error } = conv.clienteId != null
        ? await base.eq('cliente_id', conv.clienteId)
        : await base.eq('paciente', conv.paciente)
      if (error) reportError('No se pudo marcar la conversacion como leida', error)
    }
  }

  const updateTurnoEstado = async (turnoId, nuevoEstado) => {
    setTurnos((prev) => prev.map((t) => (t.id === turnoId ? { ...t, estado: nuevoEstado } : t)))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('turnos').update({ estado: nuevoEstado }).eq('id', turnoId)
      if (error) reportError('No se pudo actualizar el estado del turno', error)
    }
  }

  const deleteTurno = async (turnoId) => {
    setTurnos((prev) => prev.filter((t) => t.id !== turnoId))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('turnos').delete().eq('id', turnoId)
      if (error) reportError('No se pudo eliminar el turno', error)
    }
  }

  const saveTurno = async ({ paciente, telefono, fecha, hora, motivo, estado, servicio_id, barbero_id, precio, duracion }, existingId) => {
    const payload = { paciente, fecha, hora, motivo, estado, servicio_id, barbero_id, precio, duracion }
    const dbPayload = { paciente, fecha, hora, motivo, estado, servicio_id, barbero_id, precio, duracion_min: duracion }

    if (existingId) {
      setTurnos((prev) => prev.map((t) => (t.id === existingId ? { ...t, ...payload } : t)))
      if (isSupabaseConfigured) {
        const { error } = await supabase.from('turnos').update(dbPayload).eq('id', existingId)
        if (error) reportError('No se pudo guardar el turno', error)
      }
      return
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('turnos').insert({ ...dbPayload, barberia_id: BARBERIA_ID }).select()
      if (error) { reportError('No se pudo crear el turno', error); return }
      if (data?.[0]) setTurnos((prev) => [...prev, turnoFromDb(data[0])])
    } else {
      setTurnos((prev) => [...prev, { id: nextLocalId(prev), ...payload }])
    }

    if (telefono) {
      const yaExiste = pacientes.some((p) => p.telefono === telefono)
      if (!yaExiste) {
        const nuevoPaciente = { nombre: paciente, telefono, ultima_visita: null, proximo_turno: fecha }
        if (isSupabaseConfigured) {
          const { data, error } = await supabase.from('clientes').insert({ ...nuevoPaciente, barberia_id: BARBERIA_ID }).select()
          if (error) reportError('No se pudo guardar el cliente nuevo', error)
          if (data?.[0]) setPacientes((prev) => [...prev, data[0]])
        } else {
          setPacientes((prev) => [...prev, { id: nextLocalId(prev), ...nuevoPaciente }])
        }
      }
    }
  }

  const openNewTurno = () => { setEditingTurno(null); setTurnoFechaPrefijada(null); setNewTurnoOpen(true) }
  const openNewTurnoConFecha = (fecha) => { setEditingTurno(null); setTurnoFechaPrefijada(fecha); setNewTurnoOpen(true) }
  const openEditTurno = (turno) => { setEditingTurno(turno); setTurnoFechaPrefijada(null); setNewTurnoOpen(true) }
  const closeTurnoModal = () => { setNewTurnoOpen(false); setEditingTurno(null); setTurnoFechaPrefijada(null) }

  const updatePaciente = async (id, cambios) => {
    setPacientes((prev) => prev.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('clientes').update(cambios).eq('id', id)
      if (error) reportError('No se pudo actualizar el cliente', error)
    }
  }

  const deletePaciente = async (id) => {
    setPacientes((prev) => prev.filter((p) => p.id !== id))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('clientes').delete().eq('id', id)
      if (error) reportError('No se pudo eliminar el cliente', error)
    }
  }

  const updateNota = async (id, texto) => {
    setNotas((prev) => prev.map((n) => (n.id === id ? { ...n, texto } : n)))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('notas').update({ texto }).eq('id', id)
      if (error) reportError('No se pudo actualizar la nota', error)
    }
  }

  const deleteNota = async (id) => {
    setNotas((prev) => prev.filter((n) => n.id !== id))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('notas').delete().eq('id', id)
      if (error) reportError('No se pudo eliminar la nota', error)
    }
  }

  const sendMensaje = async (paciente, texto, clienteId) => {
    const horaActual = new Intl.DateTimeFormat('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date())
    const nuevoMensaje = { paciente, texto, de: 'clinica', hora: horaActual, leido: true, cliente_id: clienteId ?? null }
    const esLaConversacion = (c) => (clienteId != null ? c.clienteId === clienteId : c.paciente === paciente)

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
      const { error } = await supabase.from('mensajes').insert({ ...nuevoMensaje, barberia_id: BARBERIA_ID })
      if (error) reportError('No se pudo enviar el mensaje', error)
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
          .upsert({ barberia_id: BARBERIA_ID, clave: 'bot_activo', valor: 'false' })
        if (error) reportError('No se pudo apagar el bot', error)
      }
    }
  }

  const addServicio = async () => {
    const base = { nombre: 'Nuevo servicio', precio: 0, duracion: 30, activo: true }
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('servicios')
        .insert({ nombre: base.nombre, precio: base.precio, duracion_min: base.duracion, activo: base.activo, barberia_id: BARBERIA_ID })
        .select()
      if (error) { reportError('No se pudo crear el servicio', error); return }
      if (data?.[0]) setServicios((prev) => [...prev, servicioFromDb(data[0])])
    } else {
      setServicios((prev) => [...prev, { id: nextLocalId(prev), ...base }])
    }
  }

  const updateServicio = async (id, field, value) => {
    const parsed = field === 'nombre' ? value : Number(value) || 0
    setServicios((prev) => prev.map((s) => (s.id === id ? { ...s, [field]: parsed } : s)))
    if (isSupabaseConfigured) {
      const dbField = field === 'duracion' ? 'duracion_min' : field
      const { error } = await supabase.from('servicios').update({ [dbField]: parsed }).eq('id', id)
      if (error) reportError('No se pudo actualizar el servicio', error)
    }
  }

  const reactivarServicio = async (id) => {
    setServicios((prev) => prev.map((s) => (s.id === id ? { ...s, activo: true } : s)))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('servicios').update({ activo: true }).eq('id', id)
      if (error) reportError('No se pudo reactivar el servicio', error)
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
        .insert({ nombre: base.nombre, especialidad: base.rol, color: base.color, horario_texto: base.horario, activo: base.activo, barberia_id: BARBERIA_ID })
        .select()
      if (error) { reportError('No se pudo crear el barbero', error); return }
      if (data?.[0]) setBarberos((prev) => [...prev, barberoFromDb(data[0])])
    } else {
      setBarberos((prev) => [...prev, { id: nextLocalId(prev), ...base }])
    }
  }

  const updateBarbero = async (id, field, value) => {
    setBarberos((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)))
    if (isSupabaseConfigured) {
      const dbFieldMap = { rol: 'especialidad', horario: 'horario_texto', habilidades: 'habilidades' }
      const dbField = dbFieldMap[field] || field
      const { error } = await supabase.from('barberos').update({ [dbField]: value }).eq('id', id)
      if (error) reportError('No se pudo actualizar el barbero', error)
    }
  }

  const deleteBarbero = async (id) => {
    setBarberos((prev) => prev.filter((b) => b.id !== id))
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('barberos').delete().eq('id', id)
      if (error) reportError('No se pudo eliminar el barbero', error)
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
        clinicName={CLINIC_NAME}
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
                        onChangeEstado={updateTurnoEstado}
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
                onChangeEstado={updateTurnoEstado}
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
                onChangeEstado={updateTurnoEstado}
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
              <Stats turnos={turnos} pacientes={pacientes} conversaciones={conversaciones} todayKey={todayKey} barberos={barberos} />
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
      />
    </div>
  )
}