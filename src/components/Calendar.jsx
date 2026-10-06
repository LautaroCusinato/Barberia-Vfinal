import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  parseISO,
} from 'date-fns'
import { es } from 'date-fns/locale'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ChevronDown, Check, CalendarX, LayoutGrid, List, Plus, Users, Clock3, Coffee, Ban, UserRound } from 'lucide-react'
import { capitalizar, slotsOcupados, parseHorarioBarbero, barberoDisponible, turnosSeSuperponen } from '../lib/text'
import TurnoRow from './TurnoRow'
import { statusMeta } from './StatusSelect'
import { EmptyState } from './ui'
import { esBloqueoDiaCompleto } from '../lib/bloqueosAgenda.js'
import './calendar-polish.css'

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function turnosLabel(count) {
  return `${count} turno${count === 1 ? '' : 's'}`
}

function dayAriaLabel(day, count, bloqueado) {
  const estadoBloqueo = bloqueado === 'parcial' ? ', bloqueo parcial' : bloqueado ? ', bloqueado' : ''
  return `${format(day, "EEEE d 'de' MMMM", { locale: es })}, ${count ? turnosLabel(count) : 'sin turnos'}${estadoBloqueo}`
}

function timeSlots(startHour = 9, endHour = 18, stepMin = 30) {
  const slots = []
  for (let m = startHour * 60; m < endHour * 60; m += stepMin) {
    const h = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push(`${h}:${mm}`)
  }
  return slots
}

function calcularRangoSemana(barberos) {
  let minMin = null
  let maxMin = null
  for (const b of barberos) {
    const mapa = parseHorarioBarbero(b.horario)
    if (!mapa) continue
    for (const bloques of Object.values(mapa)) {
      for (const bloque of bloques) {
        if (minMin === null || bloque.ini < minMin) minMin = bloque.ini
        if (maxMin === null || bloque.fin > maxMin) maxMin = bloque.fin
      }
    }
  }
  if (minMin === null || maxMin === null) return { startHour: 9, endHour: 20 }
  return {
    startHour: Math.max(0, Math.floor(minMin / 60)),
    endHour: Math.min(24, Math.ceil(maxMin / 60)),
  }
}

function horaFin(hora, duracionMin) {
  const [h, m] = hora.split(':').map(Number)
  const total = h * 60 + m + (Number(duracionMin) || 30)
  const fh = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const fm = String(total % 60).padStart(2, '0')
  return `${fh}:${fm}`
}

function toMinutes(hora) {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

function formatCurrentTime(date) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(date)
}

function minutosAHora(min) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function prefiereMenosMovimiento() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

// Un turno "no_asistio" (o el estado heredado "cancelado") libera el horario:
// no bloquea a otros y tampoco se puede arrastrar.
const ESTADOS_LIBERADOS = new Set(['no_asistio', 'cancelado'])
const SLOT_MIN = 30
const SNAP_MIN = 15
const UMBRAL_MOUSE_PX = 4
const UMBRAL_TOUCH_PX = 8
const LONG_PRESS_MS = 300
const BORDE_AUTOSCROLL_PX = 44

// Geometría de la grilla semanal relativa a su esquina: filas de 30 min (alto
// variable según cuántos turnos haya) y columnas de cada día.
function medirGrilla(grid) {
  const g = grid.getBoundingClientRect()
  const rows = [...grid.querySelectorAll('.week-time-label[data-slot]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { min: toMinutes(el.dataset.slot), top: r.top - g.top, height: r.height }
  })
  const cols = [...grid.querySelectorAll('.week-day-header[data-fecha]')].map((el) => {
    const r = el.getBoundingClientRect()
    return { fecha: el.dataset.fecha, left: r.left - g.left, width: r.width }
  })
  return { rows, cols }
}

function yDeMinutos(rows, min) {
  if (!rows.length) return null
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (min < first.min) return null
  if (min >= last.min + SLOT_MIN) return last.top + last.height
  const row = rows.find((r) => min >= r.min && min < r.min + SLOT_MIN)
  return row ? row.top + ((min - row.min) / SLOT_MIN) * row.height : null
}

function minutosDeY(rows, y) {
  const first = rows[0]
  const last = rows[rows.length - 1]
  let row = rows.find((r) => y >= r.top && y < r.top + r.height)
  if (!row) row = y < first.top ? first : last
  const frac = Math.min(1, Math.max(0, (y - row.top) / row.height))
  const snapped = Math.round((row.min + frac * SLOT_MIN) / SNAP_MIN) * SNAP_MIN
  return Math.min(Math.max(snapped, first.min), last.min + SLOT_MIN - SNAP_MIN)
}

function colDeX(cols, x) {
  if (!cols.length) return null
  return cols.find((c) => x >= c.left && x < c.left + c.width)
    || (x < cols[0].left ? cols[0] : cols[cols.length - 1])
}

// Arrastre de turnos en la vista semanal con pointer events. Vive fuera del
// render: la sesión y los handlers se guardan en refs y solo se actualiza el
// estado cuando cambia el destino (fecha/hora), no en cada pixel.
function crearArrastre(setVista) {
  // Estado mutable propio del controlador (no participa del render).
  const latestRef = { current: { habilitado: false, validar: () => ({ estado: 'invalid' }), alSoltar: () => {} } }
  const sesionRef = { current: null }
  const labelRef = { current: null }
  const clickBloqueadoRef = { current: false }
  const bloquearClick = (ms) => {
    clickBloqueadoRef.current = true
    if (ms != null) window.setTimeout(() => { clickBloqueadoRef.current = false }, ms)
  }

  const onTouchMove = (e) => {
    // Con el arrastre activo el dedo mueve el turno, no la página.
    if (sesionRef.current?.active && e.cancelable) e.preventDefault()
  }
  const onContextMenu = (e) => {
    if (sesionRef.current) e.preventDefault()
  }

  const colocarFlotantes = (s) => {
    const dx = s.lastX - s.startX
    const dy = s.lastY - s.startY
    if (s.ghost) s.ghost.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
    const label = labelRef.current
    if (label) {
      const x = Math.min(Math.max(8, s.lastX + 14), window.innerWidth - 180)
      const y = Math.max(8, s.lastY - (s.pointerType === 'touch' ? 72 : 44))
      label.style.transform = `translate3d(${x}px, ${y}px, 0)`
    }
  }

  const calcularDestino = (s) => {
    const { rows, cols } = s.metricas
    if (!rows.length || !cols.length) return
    const g = s.grid.getBoundingClientRect()
    const col = colDeX(cols, s.lastX - g.left)
    const min = minutosDeY(rows, s.lastY - s.offsetY - g.top + 1)
    const hora = minutosAHora(min)
    if (s.target && s.target.fecha === col.fecha && s.target.hora === hora) return
    const resultado = latestRef.current.validar(s.turno, col.fecha, hora)
    s.target = { fecha: col.fecha, hora, ...resultado }
    const top = yDeMinutos(rows, min)
    const bottom = yDeMinutos(rows, min + (Number(s.turno.duracion) || 30)) ?? top
    setVista({
      id: s.turno.id,
      fecha: col.fecha,
      hora,
      estado: resultado.estado,
      motivo: resultado.motivo || '',
      preview: { left: col.left, top, width: col.width, height: Math.max(18, bottom - top) },
    })
  }

  const tick = () => {
    const s = sesionRef.current
    if (!s?.active) return
    const sc = s.scroller
    if (sc && sc.scrollHeight > sc.clientHeight) {
      const r = sc.getBoundingClientRect()
      let delta = 0
      if (s.lastY < r.top + BORDE_AUTOSCROLL_PX) delta = -Math.ceil((r.top + BORDE_AUTOSCROLL_PX - s.lastY) / 4)
      else if (s.lastY > r.bottom - BORDE_AUTOSCROLL_PX) delta = Math.ceil((s.lastY - (r.bottom - BORDE_AUTOSCROLL_PX)) / 4)
      if (delta) {
        sc.scrollTop += delta
        calcularDestino(s)
      }
    }
    s.raf = window.requestAnimationFrame(tick)
  }

  const activar = (s) => {
    s.active = true
    window.clearTimeout(s.timer)
    s.metricas = medirGrilla(s.grid)
    const ghost = s.el.cloneNode(true)
    ghost.classList.add('week-chip-ghost')
    ghost.removeAttribute('title')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.tabIndex = -1
    // Con !important inline: la hoja global fuerza position/z-index/transition en .week-chip.
    const fijar = {
      position: 'fixed',
      left: `${s.rect.left}px`,
      top: `${s.rect.top}px`,
      width: `${s.rect.width}px`,
      height: `${s.rect.height}px`,
      'min-height': '0',
      'max-width': 'none',
      flex: 'none',
      margin: '0',
      'z-index': '1000',
      'pointer-events': 'none',
      transition: 'none',
    }
    for (const [prop, valor] of Object.entries(fijar)) ghost.style.setProperty(prop, valor, 'important')
    document.body.appendChild(ghost)
    s.ghost = ghost
    try { s.el.setPointerCapture(s.pointerId) } catch { /* el puntero ya no existe */ }
    colocarFlotantes(s)
    calcularDestino(s)
    s.raf = window.requestAnimationFrame(tick)
  }

  const terminar = (soltar, { escape = false } = {}) => {
    const s = sesionRef.current
    if (!s) return
    sesionRef.current = null
    window.clearTimeout(s.timer)
    if (s.raf) window.cancelAnimationFrame(s.raf)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    document.removeEventListener('touchmove', onTouchMove)
    document.removeEventListener('contextmenu', onContextMenu)
    s.ghost?.remove()
    try { s.el.releasePointerCapture(s.pointerId) } catch { /* ya liberado */ }
    if (s.active) {
      if (escape) {
        // El botón sigue presionado: el click que llega al soltarlo no debe abrir la edición.
        bloquearClick(null)
        window.addEventListener('pointerup', () => bloquearClick(400), { once: true, capture: true })
      } else {
        bloquearClick(400)
      }
    }
    setVista(null)
    if (soltar && s.active && s.target?.estado === 'ok'
      && latestRef.current.validar(s.turno, s.target.fecha, s.target.hora).estado === 'ok') {
      latestRef.current.alSoltar(s.turno, { fecha: s.target.fecha, hora: s.target.hora })
    }
  }

  function onMove(e) {
    const s = sesionRef.current
    if (!s || e.pointerId !== s.pointerId) return
    s.lastX = e.clientX
    s.lastY = e.clientY
    if (!s.active) {
      const dist = Math.hypot(s.lastX - s.startX, s.lastY - s.startY)
      if (s.pointerType === 'touch') {
        // Se movió antes del long-press: es un scroll, no un arrastre.
        if (dist > UMBRAL_TOUCH_PX) terminar(false)
        return
      }
      if (dist < UMBRAL_MOUSE_PX) return
      activar(s)
      return
    }
    e.preventDefault()
    colocarFlotantes(s)
    calcularDestino(s)
  }

  function onUp(e) {
    const s = sesionRef.current
    if (!s || e.pointerId !== s.pointerId) return
    terminar(true)
  }

  function onCancel(e) {
    const s = sesionRef.current
    if (!s || e.pointerId !== s.pointerId) return
    terminar(false)
  }

  function onKey(e) {
    if (e.key !== 'Escape' || !sesionRef.current) return
    e.preventDefault()
    e.stopPropagation()
    terminar(false, { escape: true })
  }

  const onPointerDown = (e, turno) => {
    if (!latestRef.current.habilitado || ESTADOS_LIBERADOS.has(turno.estado)) return
    if (sesionRef.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const el = e.currentTarget
    const grid = el.closest('.week-grid')
    if (!grid) return
    const rect = el.getBoundingClientRect()
    const s = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      turno,
      el,
      grid,
      scroller: grid.closest('.week-scroll'),
      rect,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      offsetY: e.clientY - rect.top,
      active: false,
      timer: null,
      raf: null,
      target: null,
      ghost: null,
    }
    sesionRef.current = s
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    document.addEventListener('contextmenu', onContextMenu)
    if (e.pointerType === 'touch') {
      s.timer = window.setTimeout(() => {
        if (sesionRef.current === s && !s.active) activar(s)
      }, LONG_PRESS_MS)
    } else {
      try { el.setPointerCapture(e.pointerId) } catch { /* sin captura igual funciona con listeners en window */ }
    }
  }

  const consumirClick = () => {
    if (!clickBloqueadoRef.current) return false
    clickBloqueadoRef.current = false
    return true
  }

  return {
    onPointerDown,
    consumirClick,
    cancelar: () => terminar(false),
    configurar: (opciones) => { latestRef.current = opciones },
    setLabel: (el) => { labelRef.current = el },
  }
}

function useArrastreSemana({ habilitado, validar, alSoltar }) {
  const [vista, setVista] = useState(null)
  const [arrastre] = useState(() => crearArrastre(setVista))

  useLayoutEffect(() => {
    arrastre.configurar({ habilitado, validar, alSoltar })
  })

  useEffect(() => {
    if (!habilitado) arrastre.cancelar()
  }, [habilitado, arrastre])

  useEffect(() => () => arrastre.cancelar(), [arrastre])

  return [vista, arrastre]
}

export default function Calendar({ turnos, todayKey, onChangeEstado, onDeleteTurno, onEditTurno, notas, onAddNota, onNewTurno, onMoverTurno, onSelectDate, barberos = [], bloqueos = [] }) {
  const initial = parseISO(todayKey)
  const [month, setMonth] = useState(initial)
  const [selected, setSelected] = useState(initial)
  const [viewMode, setViewMode] = useState('mes')
  const [barberoFiltro, setBarberoFiltro] = useState('')
  const [barberoMenuOpen, setBarberoMenuOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const barberoMenuRef = useRef(null)

  // Reloj alineado al minuto: la línea "Ahora" avanza justo cuando cambia la hora visible.
  useEffect(() => {
    let interval = null
    const tick = () => setNow(new Date())
    const timeout = window.setTimeout(() => {
      tick()
      interval = window.setInterval(tick, 60_000)
    }, 60_000 - (Date.now() % 60_000) + 50)
    return () => {
      window.clearTimeout(timeout)
      if (interval) window.clearInterval(interval)
    }
  }, [])

  // Vista provisional hasta que el padre confirma (o rechaza) cada guardado.
  const [movidos, setMovidos] = useState({})

  const turnosVista = useMemo(() => {
    if (!Object.keys(movidos).length) return turnos
    return turnos.map((t) => (movidos[String(t.id)] ? { ...t, ...movidos[String(t.id)] } : t))
  }, [turnos, movidos])

  const validarMovimiento = useCallback((turno, fecha, hora) => {
    if (fecha === turno.fecha && hora === turno.hora) return { estado: 'same', motivo: 'Mismo horario' }
    const duracion = Number(turno.duracion) || 30
    const ahoraMin = toMinutes(formatCurrentTime(new Date()))
    if (fecha < todayKey || (fecha === todayKey && toMinutes(hora) < ahoraMin)) return { estado: 'invalid', motivo: 'Horario pasado' }
    const barbero = barberos.find((b) => String(b.id) === String(turno.barbero_id))
    if (!barbero) return { estado: 'invalid', motivo: 'Sin barbero asignado' }
    if (!barberoDisponible(barbero, fecha, hora, duracion, [])) return { estado: 'invalid', motivo: 'Fuera de horario' }
    if (!barberoDisponible(barbero, fecha, hora, duracion, bloqueos)) return { estado: 'invalid', motivo: 'Horario bloqueado' }
    const choque = turnosVista.find((o) => (
      o.id !== turno.id
      && String(o.barbero_id) === String(turno.barbero_id)
      && o.fecha === fecha
      && !ESTADOS_LIBERADOS.has(o.estado)
      && turnosSeSuperponen(hora, duracion, o.hora, Number(o.duracion) || 30)
    ))
    if (choque) return { estado: 'invalid', motivo: `Se superpone con ${choque.paciente || 'otro turno'}` }
    return { estado: 'ok', motivo: '' }
  }, [todayKey, barberos, bloqueos, turnosVista])

  const moverTurno = useCallback((turno, destino) => {
    if (!onMoverTurno) return
    const id = String(turno.id)
    const movimiento = { ...destino }
    const revertir = () => setMovidos((prev) => {
      // Una respuesta vieja no debe borrar la posición provisional más nueva,
      // incluso cuando ambos arrastres terminan en el mismo horario.
      if (prev[id] !== movimiento) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
    setMovidos((prev) => ({ ...prev, [id]: movimiento }))
    return Promise.resolve()
      .then(() => onMoverTurno(turno, destino))
      .then((ok) => { revertir(); return ok === true }, () => { revertir(); return false })
  }, [onMoverTurno])

  const [dragVista, arrastre] = useArrastreSemana({ habilitado: typeof onMoverTurno === 'function', validar: validarMovimiento, alSoltar: moverTurno })
  const { onPointerDown: onChipPointerDown, consumirClick, setLabel: setDragLabel } = arrastre

  useEffect(() => {
    function onClickOutside(e) {
      if (barberoMenuRef.current && !barberoMenuRef.current.contains(e.target)) setBarberoMenuOpen(false)
    }
    if (barberoMenuOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [barberoMenuOpen])

  const turnosFiltrados = useMemo(() => {
    if (!barberoFiltro) return turnosVista
    return turnosVista.filter((t) => String(t.barbero_id) === barberoFiltro)
  }, [turnosVista, barberoFiltro])

  const byDate = useMemo(() => {
    const map = {}
    for (const t of turnosFiltrados) {
      const key = t.fecha
      if (!key) continue
      if (!map[key]) map[key] = []
      map[key].push(t)
    }
    return map
  }, [turnosFiltrados])

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(month), { weekStartsOn: 1 })
    const end = endOfWeek(endOfMonth(month), { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [month])

  const weekDays = useMemo(() => {
    const start = startOfWeek(selected, { weekStartsOn: 1 })
    const end = endOfWeek(selected, { weekStartsOn: 1 })
    return eachDayOfInterval({ start, end })
  }, [selected])

  const barberosVisibles = useMemo(() => {
    if (!barberoFiltro) return barberos
    return barberos.filter((b) => String(b.id) === barberoFiltro)
  }, [barberos, barberoFiltro])

  const rangoSemana = useMemo(
    () => calcularRangoSemana(barberosVisibles.length ? barberosVisibles : barberos),
    [barberosVisibles, barberos]
  )

  const slots = useMemo(
    () => timeSlots(rangoSemana.startHour, rangoSemana.endHour),
    [rangoSemana]
  )

  const selectedKey = format(selected, 'yyyy-MM-dd')
  // La cabecera de Agenda abre «Bloquear» con el día elegido como valor inicial.
  useEffect(() => { onSelectDate?.(selectedKey) }, [selectedKey, onSelectDate])
  const barberoNombre = (id) => barberos.find((b) => String(b.id) === String(id))?.nombre || 'Sin barbero'
  const bloqueosDelDia = (fecha) => bloqueos.filter((b) => b.fecha === fecha && (b.barbero_id == null || !barberoFiltro || String(b.barbero_id) === barberoFiltro))
  // 'completo' si algún bloqueo visible cubre el día; 'parcial' si sólo hay franjas.
  const estadoBloqueoDia = (fecha) => {
    const delDia = bloqueosDelDia(fecha)
    if (!delDia.length) return ''
    return delDia.some(esBloqueoDiaCompleto) ? 'completo' : 'parcial'
  }
  const slotBloqueado = (fecha, minutosSlot) => bloqueosDelDia(fecha).some((b) => {
    const [hi, mi] = String(b.start_time || '00:00').slice(0, 5).split(':').map(Number)
    const [hf, mf] = String(b.end_time || '23:59').slice(0, 5).split(':').map(Number)
    return minutosSlot < hf * 60 + mf && minutosSlot + 30 > hi * 60 + mi
  })
  const bloqueoSeleccionado = bloqueosDelDia(selectedKey)
  const bloqueoDiaCompleto = bloqueoSeleccionado.some(esBloqueoDiaCompleto)
  // El estado del día por profesional distingue el bloqueo de día completo
  // del parcial: un parcial no lo saca del día, sólo de esas horas.
  const estadoBloqueoBarbero = (barberoId) => {
    const propios = bloqueos.filter((b) => b.fecha === selectedKey && (b.barbero_id == null || String(b.barbero_id) === String(barberoId)))
    if (propios.some(esBloqueoDiaCompleto)) return 'completo'
    return propios.length ? 'parcial' : ''
  }
  const mapaBarberoSeleccionado = barberosVisibles.length === 1 ? parseHorarioBarbero(barberosVisibles[0]?.horario) : null
  const breakBlocksForDay = (day) => {
    if (!mapaBarberoSeleccionado) return []
    return (mapaBarberoSeleccionado[day.getDay()] || []).filter((block) => block.break)
  }
  const hasBreaks = barberos.some((barbero) => Object.values(parseHorarioBarbero(barbero.horario) || {}).some((blocks) => blocks.some((block) => block.break)))
  const currentTimeLabel = formatCurrentTime(now)
  const nowMin = toMinutes(currentTimeLabel)
  const weekKey = format(weekDays[0], 'yyyy-MM-dd')

  useLayoutEffect(() => {
    arrastre.cancelar()
  }, [arrastre, viewMode, weekKey, barberoFiltro])

  // ===== LÍNEA "AHORA" EN LA GRILLA SEMANAL =====
  const weekGridRef = useRef(null)
  const weekScrollRef = useRef(null)
  const autoScrollHechoRef = useRef(false)
  const [nowPos, setNowPos] = useState(null)

  useLayoutEffect(() => {
    const grid = weekGridRef.current
    if (viewMode !== 'semana' || !grid) {
      setNowPos(null)
      return undefined
    }
    const medir = () => {
      const { rows, cols } = medirGrilla(grid)
      const hoy = cols.find((c) => c.fecha === todayKey)
      const enRango = rows.length > 0 && nowMin >= rows[0].min && nowMin < rows[rows.length - 1].min + SLOT_MIN
      const top = enRango ? yDeMinutos(rows, nowMin) : null
      if (!hoy || top == null) {
        setNowPos(null)
        return
      }
      const first = cols[0]
      const last = cols[cols.length - 1]
      const next = {
        top: Math.round(top),
        left: Math.round(first.left),
        width: Math.round(last.left + last.width - first.left),
        todayLeft: Math.round(hoy.left - first.left),
        todayWidth: Math.round(hoy.width),
      }
      setNowPos((prev) => (prev && Object.keys(next).every((k) => prev[k] === next[k]) ? prev : next))
    }
    medir()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(medir)
    observer.observe(grid)
    return () => observer.disconnect()
  }, [viewMode, nowMin, todayKey, weekKey, turnosFiltrados, slots])

  // La primera vez que se abre la semana, la hora actual queda arriba a la vista.
  useEffect(() => {
    if (viewMode !== 'semana' || autoScrollHechoRef.current) return
    const scroller = weekScrollRef.current
    const grid = weekGridRef.current
    if (!scroller || !grid) return
    autoScrollHechoRef.current = true
    const scrollVertical = scroller.scrollHeight > scroller.clientHeight + 1
    const scrollHorizontal = scroller.scrollWidth > scroller.clientWidth + 1
    if (!scrollVertical && !scrollHorizontal) return
    const { rows, cols } = medirGrilla(grid)
    if (!rows.length) return
    const g = grid.getBoundingClientRect()
    const s = scroller.getBoundingClientRect()
    const destino = {}
    if (scrollVertical) {
      const top = yDeMinutos(rows, Math.max(Math.floor(nowMin / 60) * 60, rows[0].min))
      const header = grid.querySelector('.week-day-header')?.offsetHeight || 54
      if (top != null) destino.top = Math.max(0, g.top - s.top + scroller.scrollTop + top - header - 6)
    }
    // Celular: la grilla es más ancha que la pantalla; se trae el día de hoy a la vista.
    const hoy = cols.find((c) => c.fecha === todayKey)
    if (scrollHorizontal && hoy) {
      const labels = grid.querySelector('.week-time-label')?.offsetWidth || 56
      const izquierda = g.left - s.left + scroller.scrollLeft + hoy.left - labels
      const visible = hoy.left + g.left - s.left >= labels && hoy.left + hoy.width + g.left - s.left <= scroller.clientWidth
      if (!visible) destino.left = Math.max(0, izquierda)
    }
    if (destino.top == null && destino.left == null) return
    scroller.scrollTo({ ...destino, behavior: prefiereMenosMovimiento() ? 'auto' : 'smooth' })
  }, [viewMode, nowMin, todayKey])

  const turnosDelDia = (byDate[selectedKey] || [])
    .slice()
    .sort((a, b) => a.hora.localeCompare(b.hora) || barberoNombre(a.barbero_id).localeCompare(barberoNombre(b.barbero_id)))

  // Dirección de la última navegación: el período nuevo entra desde ese lado.
  const [navDir, setNavDir] = useState('none')

  const goPrevious = () => {
    setNavDir('prev')
    if (viewMode === 'mes') {
      setMonth((m) => subMonths(m, 1))
      setSelected((d) => subMonths(d, 1))
    } else {
      setSelected((d) => subWeeks(d, 1))
    }
  }

  const goNext = () => {
    setNavDir('next')
    if (viewMode === 'mes') {
      setMonth((m) => addMonths(m, 1))
      setSelected((d) => addMonths(d, 1))
    } else {
      setSelected((d) => addWeeks(d, 1))
    }
  }

  const goToday = () => {
    setNavDir('none')
    setMonth(initial)
    setSelected(initial)
  }

  // ===== FUNCIÓN PARA AGRUPAR TURNOS POR HORA EN UN SLOT =====
  const getTurnosAgrupadosPorHora = (eventos, slot) => {
    const slotMin = toMinutes(slot)
    // Un turno aparece en toda franja de 30 min que se superpone con él. Antes
    // se exigía que la franja empezara después del inicio, así un turno de
    // 11:15 no se veía en la franja 11:00, donde realmente empieza.
    const activos = eventos.filter(t => {
      const tMin = toMinutes(t.hora)
      const tFin = tMin + (t.duracion || 30)
      return slotMin < tFin && slotMin + 30 > tMin
    })
    // Agrupar por hora de inicio exacta
    const grupos = {}
    activos.forEach(t => {
      const key = t.hora
      if (!grupos[key]) grupos[key] = []
      grupos[key].push(t)
    })
    return grupos
  }

  return (
    <div className={`${viewMode === 'mes' ? 'calendar-wrap calendar-wrap-modern' : 'calendar-board'} agenda-calendar-shell`} aria-label="Agenda del negocio">
      <div className="panel">
        <div className="calendar-toolbar">
          <div className="calendar-heading">
            <span className="calendar-heading-kicker">{viewMode === 'mes' ? 'Vista mensual' : 'Vista semanal'}</span>
            <h2 className="calendar-heading-title">
              {viewMode === 'mes'
                ? capitalizar(format(month, 'MMMM yyyy', { locale: es }))
                : `${format(weekDays[0], 'd MMM', { locale: es })} al ${format(weekDays[6], 'd MMM', { locale: es })}`}
            </h2>
            <span className="calendar-heading-sub">
              Seleccionado: {format(selected, "EEEE d 'de' MMMM", { locale: es })}
            </span>
          </div>

          <div className="calendar-actions">
            {barberos.length > 0 && (
              <div className="barbero-filter" ref={barberoMenuRef}>
                <button
                  type="button"
                  className="barbero-filter-trigger"
                  onClick={() => setBarberoMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={barberoMenuOpen}
                >
                  <Users size={13} style={{ color: 'var(--ink-faint)' }} />
                  <span>{barberoFiltro ? barberos.find((b) => String(b.id) === barberoFiltro)?.nombre : 'Todos los barberos'}</span>
                  <ChevronDown size={13} strokeWidth={2.5} className={`barbero-filter-chevron ${barberoMenuOpen ? 'open' : ''}`} />
                </button>

                {barberoMenuOpen && (
                  <div className="barbero-filter-list">
                    <button
                      type="button"
                      className="barbero-filter-item"
                      onClick={() => { setBarberoFiltro(''); setBarberoMenuOpen(false) }}
                    >
                      <span>Todos los barberos</span>
                      {!barberoFiltro && <Check size={13} strokeWidth={2.8} />}
                    </button>
                    {barberos.map((b) => (
                      <button
                        type="button"
                        key={b.id}
                        className="barbero-filter-item"
                        onClick={() => { setBarberoFiltro(String(b.id)); setBarberoMenuOpen(false) }}
                      >
                        <span>{b.nombre}</span>
                        {barberoFiltro === String(b.id) && <Check size={13} strokeWidth={2.8} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="view-toggle">
              <button type="button" className={viewMode === 'mes' ? 'active' : ''} aria-pressed={viewMode === 'mes'} onClick={() => setViewMode('mes')}>
                <LayoutGrid size={13} /> Mes
              </button>
              <button type="button" className={viewMode === 'semana' ? 'active' : ''} aria-pressed={viewMode === 'semana'} onClick={() => setViewMode('semana')}>
                <List size={13} /> Semana
              </button>
            </div>
            <div className="calendar-stepper">
              <button
                className="btn calendar-arrow-btn"
                onClick={goPrevious}
                aria-label={viewMode === 'mes' ? 'Mes anterior' : 'Semana anterior'}
              >
                <ChevronLeft size={16} strokeWidth={2.25} />
                <span>Anterior</span>
              </button>
              <button type="button" className="btn calendar-today-btn" onClick={goToday}>Hoy</button>
              <button
                className="btn calendar-arrow-btn"
                onClick={goNext}
                aria-label={viewMode === 'mes' ? 'Mes siguiente' : 'Semana siguiente'}
              >
                <span>Siguiente</span>
                <ChevronRight size={16} strokeWidth={2.25} />
              </button>
            </div>
          </div>
        </div>

        <div className="agenda-utility-row" aria-label="Referencias de agenda">
          <div className="agenda-now-indicator" role="status" aria-live="polite">
            <span className="agenda-now-line" aria-hidden="true" />
            <Clock3 size={14} aria-hidden="true" />
            <span>Ahora {currentTimeLabel}</span>
          </div>
          <div className="agenda-legend" aria-label="Leyenda de estados">
            <span><i className="agenda-legend-swatch agenda-legend-swatch--turno" aria-hidden="true" />Turno</span>
            {hasBreaks && <span><i className="agenda-legend-swatch agenda-legend-swatch--break" aria-hidden="true" /><Coffee size={12} aria-hidden="true" />Pausa</span>}
            <span><i className="agenda-legend-swatch agenda-legend-swatch--blocked" aria-hidden="true" /><Ban size={12} aria-hidden="true" />Bloqueo</span>
          </div>
        </div>

        {viewMode === 'mes' ? (
          <>
            <div className="calendar-grid calendar-swap" key={`grid-${format(month, 'yyyy-MM')}`} data-dir={navDir}>
            {DOW.map((d) => (
              <div className="calendar-dow" key={d}>{d}</div>
            ))}
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd')
              const outside = !isSameMonth(day, month)
              const eventos = byDate[key] || []
              const bloqueado = estadoBloqueoDia(key)

              return (
                <div
                  key={key}
                  className={`calendar-day ${outside ? 'outside' : ''} ${key === todayKey ? 'today' : ''} ${isSameDay(day, selected) ? 'selected' : ''} ${bloqueado ? 'is-blocked' : ''} ${!outside && eventos.length ? 'has-turnos' : ''}`}
                  role="gridcell"
                  tabIndex={outside ? -1 : 0}
                  aria-selected={isSameDay(day, selected)}
                  aria-label={dayAriaLabel(day, outside ? 0 : eventos.length, bloqueado)}
                  onClick={() => {
                    if (outside) return
                    setSelected(day)
                  }}
                  onKeyDown={(event) => {
                    if (!outside && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault()
                      setSelected(day)
                    }
                  }}
                >
                  <span className="calendar-day-num">{format(day, 'd')}</span>
                  {!outside && (
                    <button type="button" className="calendar-day-add" aria-label={`Agendar turno el ${format(day, "d 'de' MMMM", { locale: es })}`} onClick={(e) => { e.stopPropagation(); setSelected(day); onNewTurno?.(key) }}>
                      <Plus size={12} strokeWidth={2.7} />
                    </button>
                  )}
                  {(bloqueado || (!outside && eventos.length > 0)) && (
                    <div className={`calendar-day-badges ${bloqueado && !outside && eventos.length > 0 ? 'is-stacked' : ''}`} aria-hidden="true">
                      {bloqueado && <span className="calendar-day-state" title={bloqueado === 'parcial' ? 'Bloqueo parcial' : 'Bloqueado'}><Ban size={11} aria-hidden="true" /> <span className="calendar-day-state-label">{bloqueado === 'parcial' ? 'Parcial' : 'Bloqueado'}</span></span>}
                      {/* El texto va por CSS (data-label) para que el contenido de la celda siga siendo solo el número del día; el aria-label de la celda ya informa la cantidad. */}
                      {!outside && eventos.length > 0 && (
                        <span className="calendar-day-pill" data-label={turnosLabel(eventos.length)} data-short={eventos.length} title={turnosLabel(eventos.length)} />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
            <div className="calendar-mobile-days calendar-swap" key={`mobile-${format(month, 'yyyy-MM')}`} data-dir={navDir} role="grid" aria-label="Días del mes">
            {days.filter((day) => isSameMonth(day, month)).map((day) => {
              const key = format(day, 'yyyy-MM-dd')
              const eventos = byDate[key] || []
              const bloqueado = estadoBloqueoDia(key)
              const selectedDay = isSameDay(day, selected)
              return (
                <div
                  key={`mobile-${key}`}
                  className={`calendar-mobile-day ${key === todayKey ? 'today' : ''} ${selectedDay ? 'selected' : ''} ${bloqueado ? 'is-blocked' : ''} ${eventos.length ? 'has-turnos' : ''}`}
                  role="gridcell"
                  tabIndex={0}
                  aria-selected={selectedDay}
                  aria-label={dayAriaLabel(day, eventos.length, bloqueado)}
                  onClick={() => setSelected(day)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelected(day)
                    }
                  }}
                >
                  <div className="calendar-mobile-day-head">
                    <span className="calendar-mobile-day-weekday">{format(day, 'EEE', { locale: es })}</span>
                    <strong>{format(day, 'd')}</strong>
                    <button type="button" className="calendar-mobile-day-add" aria-label={`Agendar turno el ${format(day, "d 'de' MMMM", { locale: es })}`} onClick={(event) => { event.stopPropagation(); setSelected(day); onNewTurno?.(key) }}>
                      <Plus size={15} strokeWidth={2.7} />
                    </button>
                  </div>
                  {(bloqueado || eventos.length > 0) && (
                    <div className="calendar-mobile-day-meta" aria-hidden="true">
                      {bloqueado && <span className="calendar-mobile-day-state"><Ban size={13} /> {bloqueado === 'parcial' ? 'Parcial' : 'Bloqueado'}</span>}
                      {eventos.length > 0 && <span className="calendar-day-pill calendar-day-pill--mobile">{turnosLabel(eventos.length)}</span>}
                    </div>
                  )}
                </div>
              )
            })}
            </div>
          </>
        ) : (
          <div className="week-scroll" ref={weekScrollRef}>
            <div ref={weekGridRef} className={`week-grid calendar-swap ${dragVista ? 'is-dragging' : ''}`} key={`week-${weekKey}`} data-dir={navDir} style={{ gridTemplateRows: `54px repeat(${slots.length}, minmax(56px, auto))` }}>
              <div className="week-cell week-corner" />
              {weekDays.map((day) => {
                const key = format(day, 'yyyy-MM-dd')
                const barberoUnico = barberoFiltro ? barberosVisibles[0] : null
                const noAtiende = barberoUnico && !parseHorarioBarbero(barberoUnico.horario)?.[day.getDay()]
                const bloqueado = estadoBloqueoDia(key)
                return (
                  <div
                    key={key}
                    data-fecha={key}
                    className={`week-cell week-day-header ${key === todayKey ? 'today' : ''} ${noAtiende ? 'week-day-off' : ''} ${bloqueado ? 'week-day-blocked' : ''}`}
                    onClick={() => setSelected(day)}
                    title={bloqueado === 'parcial' ? 'Bloqueo parcial' : bloqueado ? 'Día bloqueado' : noAtiende ? `${barberoUnico.nombre} no atiende este día` : undefined}
                  >
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase' }}>
                      {format(day, 'EEE', { locale: es })}
                    </span>
                    {format(day, 'd')}
                    {bloqueado && <Ban size={13} aria-label={bloqueado === 'parcial' ? 'Bloqueo parcial' : 'Día bloqueado'} />}
                  </div>
                )
              })}

              {slots.map((slot) => (
                <div key={`row-${slot}`} style={{ display: 'contents' }}>
                  <div className="week-cell week-time-label" data-slot={slot}>{slot}</div>
                  {weekDays.map((day) => {
                    const key = format(day, 'yyyy-MM-dd')
                    const eventos = byDate[key] || []
                    const bloqueado = Boolean(slotBloqueado(key, toMinutes(slot)))
                    const breaks = breakBlocksForDay(day)
                    const slotMinutes = toMinutes(slot)
                    const breakActive = breaks.some((block) => slotMinutes >= block.ini && slotMinutes < block.fin)
                    const breakStarts = breaks.some((block) => slotMinutes === block.ini)

                    // ===== OBTENER TURNOS AGRUPADOS POR HORA =====
                    const grupos = getTurnosAgrupadosPorHora(eventos, slot)
                    const totalTurnos = Object.values(grupos).reduce((acc, arr) => acc + arr.length, 0)
                    const barberoUnico = barberoFiltro ? barberosVisibles[0] : null
                    const noAtiende = barberoUnico && !parseHorarioBarbero(barberoUnico.horario)?.[day.getDay()]

                    if (totalTurnos === 0) {
                      return (
                        <div
                          key={key + slot}
                          className={`week-cell week-slot ${noAtiende ? 'week-day-off' : ''} ${bloqueado ? 'week-slot--blocked' : ''} ${breakActive ? 'week-slot--break' : ''}`}
                          onClick={() => {
                            if (noAtiende) return
                            setSelected(day)
                            onNewTurno?.(key)
                          }}
                          style={{ minHeight: '52px', padding: '3px' }}
                        >
                          {bloqueado && slot === slots[0] && <span className="week-slot-state week-slot-state--blocked"><Ban size={12} /> Bloqueado</span>}
                          {!bloqueado && breakStarts && <span className="week-slot-state week-slot-state--break"><Coffee size={12} /> Pausa</span>}
                        </div>
                      )
                    }

                    return (
                      <div
                        key={key + slot}
                        className={`week-cell week-slot ${noAtiende ? 'week-day-off' : ''} ${bloqueado ? 'week-slot--blocked' : ''} ${breakActive ? 'week-slot--break' : ''}`}
                        onClick={() => {
                          if (noAtiende) return
                          setSelected(day)
                          onNewTurno?.(key)
                        }}
                        style={{
                          minHeight: `${20 + totalTurnos * 28}px`,
                          padding: '3px',
                          display: 'flex',
                          flexDirection: 'row',
                          flexWrap: 'wrap',
                          gap: '3px',
                          alignItems: 'stretch',
                          alignContent: 'flex-start'
                        }}
                      >
                        {Object.values(grupos).map((turnos) => {
                          let widthPercent
                          if (totalTurnos === 1) {
                            widthPercent = 100
                          } else if (totalTurnos === 2) {
                            widthPercent = 48
                          } else if (totalTurnos === 3) {
                            widthPercent = 31
                          } else {
                            widthPercent = Math.min(100 / totalTurnos - 1, 48)
                          }

                          return turnos.map((t) => {
                            const meta = statusMeta(t.estado)
                            const span = slotsOcupados(t.duracion, 30)
                            // En las franjas siguientes a la de inicio el turno se muestra
                            // como banda de continuación: antes se repetía la tarjeta
                            // completa y un turno de 45 min parecía dos turnos.
                            if (toMinutes(t.hora) < toMinutes(slot)) {
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  tabIndex={-1}
                                  aria-hidden="true"
                                  className="week-chip week-chip--cont"
                                  style={{ background: meta.bg, color: meta.color, flex: `0 0 ${widthPercent}%`, maxWidth: `${widthPercent}%` }}
                                  onClick={(e) => { e.stopPropagation(); onEditTurno(t) }}
                                  title={`${t.paciente} · continúa hasta ${horaFin(t.hora, t.duracion)}`}
                                />
                              )
                            }

                            const arrastrable = Boolean(onMoverTurno) && !ESTADOS_LIBERADOS.has(t.estado)
                            return (
                              <button
                                key={t.id}
                                type="button"
                                className={`week-chip ${span > 1 ? 'week-chip--largo' : ''} ${arrastrable ? 'week-chip--draggable' : ''} ${dragVista?.id === t.id ? 'is-drag-source' : ''}`}
                                style={{
                                  background: meta.bg,
                                  color: meta.color,
                                  flex: `0 0 ${widthPercent}%`,
                                  maxWidth: `${widthPercent}%`,
                                  minHeight: totalTurnos > 1 ? '24px' : '32px',
                                  borderRadius: '6px',
                                  padding: totalTurnos > 1 ? '2px 4px' : '4px 8px',
                                  fontSize: totalTurnos > 1 ? '9px' : '10px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  border: '1px solid rgba(0,0,0,0.08)',
                                  transition: 'opacity var(--motion-fast) var(--ease-standard), transform var(--motion-fast) var(--ease-standard)',
                                  cursor: arrastrable ? 'grab' : 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'center',
                                  lineHeight: '1.2',
                                  position: 'relative',
                                  zIndex: 5,
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                }}
                                onPointerDown={arrastrable ? (e) => onChipPointerDown(e, t) : undefined}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  if (consumirClick()) return
                                  onEditTurno(t)
                                }}
                                title={`${t.hora}–${horaFin(t.hora, t.duracion)} · ${t.paciente} (${t.motivo}) · ${t.duracion || 30} min${t.origen === 'whatsapp' ? ' · vía WhatsApp' : ''}`}
                              >
                                {t.origen === 'whatsapp' && (
                                  <span
                                    title="Agendado por WhatsApp"
                                    style={{
                                      position: 'absolute',
                                      top: 3,
                                      right: 3,
                                      width: 6,
                                      height: 6,
                                      borderRadius: '50%',
                                      background: '#25D366',
                                      boxShadow: '0 0 0 1px rgba(255,255,255,0.6)',
                                    }}
                                  />
                                )}
                                <span className="week-chip-time" style={{ fontSize: totalTurnos > 1 ? '8px' : '10px', opacity: 0.8 }}>
                                  {t.hora}
                                </span>
                                <span className="week-chip-name" style={{ fontSize: totalTurnos > 1 ? '9px' : '12px', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {t.paciente}
                                </span>
                                <span className="week-chip-barber" style={{ fontSize: totalTurnos > 1 ? '7px' : '10px', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {barberoNombre(t.barbero_id)}
                                </span>
                                {span > 1 && <span className="week-chip-dur" style={{ fontSize: totalTurnos > 1 ? '7px' : '9px' }}>{t.duracion}min</span>}
                              </button>
                            )
                          })
                        })}
                        {bloqueado && slot === slots[0] && <span className="week-slot-state week-slot-state--blocked"><Ban size={12} /> Bloqueado</span>}
                        {!bloqueado && breakStarts && <span className="week-slot-state week-slot-state--break"><Coffee size={12} /> Pausa</span>}
                      </div>
                    )
                  })}
                </div>
              ))}
              {/* Superposiciones al final para no alterar el :nth-child de las celdas. */}
              {nowPos && (
                <div
                  className="week-now-line"
                  aria-hidden="true"
                  style={{ transform: `translate3d(${nowPos.left}px, ${nowPos.top}px, 0)`, width: `${nowPos.width}px` }}
                >
                  <span className="week-now-line-today" style={{ transform: `translateX(${nowPos.todayLeft}px)`, width: `${nowPos.todayWidth}px` }}>
                    <span className="week-now-dot" />
                  </span>
                </div>
              )}
              {dragVista?.preview && dragVista.preview.top != null && (
                <div
                  className={`week-drop-preview is-${dragVista.estado}`}
                  aria-hidden="true"
                  style={{
                    transform: `translate3d(${dragVista.preview.left + 3}px, ${dragVista.preview.top}px, 0)`,
                    width: `${Math.max(0, dragVista.preview.width - 6)}px`,
                    height: `${dragVista.preview.height}px`,
                  }}
                />
              )}
            </div>
          </div>
        )}
        {onMoverTurno && typeof document !== 'undefined' && createPortal(
          <div
            ref={setDragLabel}
            className={`week-drag-label ${dragVista ? `is-visible is-${dragVista.estado}` : ''}`}
            role="status"
            aria-live="polite"
          >
            {dragVista && (
              <>
                <strong>{capitalizar(format(parseISO(dragVista.fecha), 'EEE d', { locale: es }))} · {dragVista.hora}</strong>
                {dragVista.estado === 'invalid' && <span>{dragVista.motivo}</span>}
                {dragVista.estado === 'same' && <span>Sin cambios</span>}
              </>
            )}
          </div>,
          document.body
        )}
      </div>

      {viewMode === 'mes' && (
        <div className="panel day-side-panel">
          <div className="day-panel-header">
            <div>
              <span className="day-panel-eyebrow">Detalle del día</span>
              <span className="day-panel-date">{capitalizar(format(selected, "EEEE d 'de' MMMM", { locale: es }))}</span>
            </div>
            {onNewTurno && (
              <button className="btn btn-primary day-panel-new" onClick={() => onNewTurno(selectedKey)} aria-label={`Agendar turno el ${format(selected, "d 'de' MMMM", { locale: es })}`}>
                <Plus size={15} strokeWidth={2.5} />
                Agendar
              </button>
            )}
          </div>
          <p className="day-panel-sub">
            {turnosDelDia.length === 0
              ? 'Sin turnos agendados'
              : turnosLabel(turnosDelDia.length)}
          </p>

          <div className="day-panel-metrics" aria-label="Resumen del día">
            <span><strong>{turnosDelDia.length}</strong><small>turnos</small></span>
            <span><strong>{barberos.length}</strong><small>profesionales</small></span>
            <span className={bloqueoSeleccionado.length ? 'is-blocked' : ''}><strong>{bloqueoDiaCompleto ? 'Sí' : bloqueoSeleccionado.length ? 'Parcial' : 'No'}</strong><small>bloqueo</small></span>
          </div>

          {barberos.length > 0 && (
            <div className="day-panel-team" aria-label="Profesionales del día">
              <span className="day-panel-eyebrow"><UserRound size={12} /> Equipo</span>
              <div className="day-panel-team-list">
                {barberos.map((barbero) => {
                  const bloqueoBarbero = estadoBloqueoBarbero(barbero.id)
                  const trabaja = Boolean(parseHorarioBarbero(barbero.horario)?.[selected.getDay()]) && bloqueoBarbero !== 'completo'
                  const etiqueta = !trabaja ? 'No disponible' : bloqueoBarbero === 'parcial' ? 'Bloqueo parcial' : 'Trabaja'
                  return <span className={`day-panel-team-chip ${trabaja ? 'is-working' : 'is-off'}`} key={barbero.id}><i style={{ background: barbero.color }} aria-hidden="true" /><span className="day-panel-team-name">{barbero.nombre}</span><small>{etiqueta}</small></span>
                })}
              </div>
            </div>
          )}

          {turnosDelDia.length === 0 ? (
            <EmptyState className="day-empty-state" icon={<CalendarX size={26} style={{ color: 'var(--border-strong)' }} />} description="No hay turnos para este dia" />
          ) : (
            <div className="day-side-list">
              {turnosDelDia.map((t) => (
                <TurnoRow
                  key={t.id}
                  turno={t}
                  onChangeEstado={onChangeEstado}
                  onDeleteTurno={onDeleteTurno}
                  onEditTurno={onEditTurno}
                  notas={notas}
                  onAddNota={onAddNota}
                  barberos={barberos}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
