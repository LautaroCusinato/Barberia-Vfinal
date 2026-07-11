import { useEffect, useMemo, useRef, useState } from 'react'
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
import { ChevronLeft, ChevronRight, ChevronDown, Check, CalendarX, LayoutGrid, List, Plus, Users } from 'lucide-react'
import { slotsOcupados, parseHorarioBarbero } from '../lib/text'
import TurnoRow from './TurnoRow'
import { statusMeta } from './StatusSelect'

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function timeSlots(startHour = 9, endHour = 18, stepMin = 30) {
  const slots = []
  for (let m = startHour * 60; m < endHour * 60; m += stepMin) {
    const h = String(Math.floor(m / 60)).padStart(2, '0')
    const mm = String(m % 60).padStart(2, '0')
    slots.push(`${h}:${mm}`)
  }
  return slots
}

// La vista "Semana" antes mostraba siempre 9 a 18hs fijo. Como los
// barberos reales trabajan en distintas franjas (algunos hasta las
// 19 o 20hs), cualquier turno fuera de ese rango quedaba agendado en
// la base pero invisible en la planilla. Esta funcion calcula el
// rango real a mostrar en base a los horarios de los barberos visibles.
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

function floorToSlot(hora, stepMin = 30) {
  const [h, m] = hora.split(':').map(Number)
  const totalMin = h * 60 + m
  const flooredMin = Math.floor(totalMin / stepMin) * stepMin
  const fh = String(Math.floor(flooredMin / 60)).padStart(2, '0')
  const fm = String(flooredMin % 60).padStart(2, '0')
  return `${fh}:${fm}`
}

// Hora de fin de un turno, para mostrar "10:00–10:50" en los tooltips
// y que quede claro cuanto tiempo real ocupa (no solo el bloque de grilla).
function horaFin(hora, duracionMin) {
  const [h, m] = hora.split(':').map(Number)
  const total = h * 60 + m + (Number(duracionMin) || 30)
  const fh = String(Math.floor(total / 60) % 24).padStart(2, '0')
  const fm = String(total % 60).padStart(2, '0')
  return `${fh}:${fm}`
}

export default function Calendar({ turnos, todayKey, onChangeEstado, onDeleteTurno, onEditTurno, notas, onAddNota, onNewTurno, barberos = [] }) {
  const initial = parseISO(todayKey)
  const [month, setMonth] = useState(initial)
  const [selected, setSelected] = useState(initial)
  const [viewMode, setViewMode] = useState('mes')
  const [barberoFiltro, setBarberoFiltro] = useState('')
  const [barberoMenuOpen, setBarberoMenuOpen] = useState(false)
  const barberoMenuRef = useRef(null)
  const dayListRef = useRef(null)
  const [dayListScrollState, setDayListScrollState] = useState({ scrolled: false, hasMore: false })

  const checkDayListScroll = () => {
    const el = dayListRef.current
    if (!el) return
    const scrolled = el.scrollTop > 2
    const hasMore = el.scrollTop + el.clientHeight < el.scrollHeight - 2
    setDayListScrollState({ scrolled, hasMore })
  }

  useEffect(() => {
    function onClickOutside(e) {
      if (barberoMenuRef.current && !barberoMenuRef.current.contains(e.target)) setBarberoMenuOpen(false)
    }
    if (barberoMenuOpen) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [barberoMenuOpen])

  const turnosFiltrados = useMemo(() => {
    if (!barberoFiltro) return turnos
    return turnos.filter((t) => String(t.barbero_id) === barberoFiltro)
  }, [turnos, barberoFiltro])

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
  const barberoNombre = (id) => barberos.find((b) => String(b.id) === String(id))?.nombre || 'Sin barbero'
  const turnosDelDia = (byDate[selectedKey] || [])
    .slice()
    .sort((a, b) => a.hora.localeCompare(b.hora) || barberoNombre(a.barbero_id).localeCompare(barberoNombre(b.barbero_id)))

  useEffect(() => {
    checkDayListScroll()
    window.addEventListener('resize', checkDayListScroll)
    return () => window.removeEventListener('resize', checkDayListScroll)
  }, [turnosDelDia])

  const goPrevious = () => {
    if (viewMode === 'mes') {
      setMonth((m) => subMonths(m, 1))
      setSelected((d) => subMonths(d, 1))
    } else {
      setSelected((d) => subWeeks(d, 1))
    }
  }

  const goNext = () => {
    if (viewMode === 'mes') {
      setMonth((m) => addMonths(m, 1))
      setSelected((d) => addMonths(d, 1))
    } else {
      setSelected((d) => addWeeks(d, 1))
    }
  }

  const goToday = () => {
    setMonth(initial)
    setSelected(initial)
  }

  return (
    <div className={viewMode === 'mes' ? 'calendar-wrap calendar-wrap-modern' : 'calendar-board'}>
      <div className="panel">
        <div className="calendar-toolbar">
          <div className="calendar-heading">
            <span className="calendar-heading-kicker">{viewMode === 'mes' ? 'Vista mensual' : 'Vista semanal'}</span>
            <h2 className="calendar-heading-title">
              {viewMode === 'mes'
                ? format(month, 'MMMM yyyy', { locale: es })
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
              <button className={viewMode === 'mes' ? 'active' : ''} onClick={() => setViewMode('mes')}>
                <LayoutGrid size={13} /> Mes
              </button>
              <button className={viewMode === 'semana' ? 'active' : ''} onClick={() => setViewMode('semana')}>
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
              <button className="btn calendar-today-btn" onClick={goToday}>Hoy</button>
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

        {viewMode === 'mes' ? (
          <div className="calendar-grid">
            {DOW.map((d) => (
              <div className="calendar-dow" key={d}>{d}</div>
            ))}
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd')
              const outside = !isSameMonth(day, month)
              const eventos = byDate[key] || []

              return (
                <div
                  key={key}
                  className={`calendar-day ${outside ? 'outside' : ''} ${key === todayKey ? 'today' : ''} ${isSameDay(day, selected) ? 'selected' : ''}`}
                  onClick={() => {
                    if (outside) return
                    setSelected(day)
                  }}
                >
                  <span className="calendar-day-num">{format(day, 'd')}</span>
                  {!outside && (
                    <span className="calendar-day-add" onClick={(e) => { e.stopPropagation(); setSelected(day); onNewTurno?.(key) }}>
                      <Plus size={12} strokeWidth={2.7} />
                    </span>
                  )}
                  {!outside && eventos.length > 0 && (
                    <div className="calendar-day-dots">
                      {eventos.slice(0, 4).map((ev) => {
                        const barbero = barberos.find((b) => String(b.id) === String(ev.barbero_id))
                        // Un no-show se marca en rojo para que se note de un
                        // vistazo en el mes, sin importar el color del barbero.
                        const noAsistio = statusMeta(ev.estado).value === 'no_asistio'
                        return (
                          <span
                            key={ev.id}
                            className={`calendar-dot ${noAsistio ? 'rose' : ''}`}
                            style={!noAsistio && barbero ? { backgroundColor: barbero.color } : undefined}
                            title={`${ev.hora} · ${ev.paciente} · ${barbero?.nombre || 'Sin barbero'}${noAsistio ? ' · No asistió' : ''}`}
                          />
                        )
                      })}
                      {eventos.length > 4 && (
                        <span className="calendar-day-count">+{eventos.length - 4}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="week-scroll">
            <div className="week-grid" style={{ gridTemplateRows: `54px repeat(${slots.length}, minmax(56px, auto))` }}>
              <div className="week-cell week-corner" />
              {weekDays.map((day) => {
                const key = format(day, 'yyyy-MM-dd')
                const barberoUnico = barberoFiltro ? barberosVisibles[0] : null
                const noAtiende = barberoUnico && !parseHorarioBarbero(barberoUnico.horario)?.[day.getDay()]
                return (
                  <div
                    key={key}
                    className={`week-cell week-day-header ${key === todayKey ? 'today' : ''} ${noAtiende ? 'week-day-off' : ''}`}
                    onClick={() => setSelected(day)}
                    title={noAtiende ? `${barberoUnico.nombre} no atiende este dia` : undefined}
                  >
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase' }}>
                      {format(day, 'EEE', { locale: es })}
                    </span>
                    {format(day, 'd')}
                  </div>
                )
              })}

              {slots.map((slot) => (
                <div key={`row-${slot}`} style={{ display: 'contents' }}>
                  <div className="week-cell week-time-label">{slot}</div>
                  {weekDays.map((day) => {
                    const key = format(day, 'yyyy-MM-dd')
                    const eventos = (byDate[key] || [])
                      .filter((t) => floorToSlot(t.hora) === slot)
                      .sort((a, b) => barberoNombre(a.barbero_id).localeCompare(barberoNombre(b.barbero_id)))
                    const barberoUnico = barberoFiltro ? barberosVisibles[0] : null
                    const noAtiende = barberoUnico && !parseHorarioBarbero(barberoUnico.horario)?.[day.getDay()]
                    return (
                      <div
                        key={key + slot}
                        className={`week-cell week-slot ${noAtiende ? 'week-day-off' : ''}`}
                        onClick={() => {
                          if (noAtiende) return
                          setSelected(day)
                          onNewTurno?.(key)
                        }}
                      >
                        {eventos.map((t) => {
                          const meta = statusMeta(t.estado)
                          const span = slotsOcupados(t.duracion, 30)
                          return (
                            <button
                              key={t.id}
                              className={`week-chip ${span > 1 ? 'week-chip--largo' : ''}`}
                              style={{ background: meta.bg, color: meta.color }}
                              onClick={(e) => { e.stopPropagation(); onEditTurno(t) }}
                              title={`${t.hora}–${horaFin(t.hora, t.duracion)} · ${t.paciente} (${t.motivo}) · ${t.duracion || 30} min`}
                            >
                              <span className="week-chip-time">{t.hora}</span>
                              <span className="week-chip-name">{t.paciente}</span>
                              <span className="week-chip-barber">{barberoNombre(t.barbero_id)}</span>
                              {span > 1 && <span className="week-chip-dur">{t.duracion}min</span>}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              ))}

            </div>
          </div>
        )}
      </div>

      {viewMode === 'mes' && (
        <div className="panel day-side-panel">
          <div className="day-panel-header">
            <span className="day-panel-date">{format(selected, "EEEE d 'de' MMMM", { locale: es })}</span>
            {onNewTurno && (
              <button className="btn btn-primary day-panel-new" onClick={() => onNewTurno(selectedKey)}>
                <Plus size={15} strokeWidth={2.5} />
                Agendar en este dia
              </button>
            )}
          </div>
          <p className="day-panel-sub">
            {turnosDelDia.length === 0
              ? 'Sin turnos agendados'
              : `${turnosDelDia.length} turno${turnosDelDia.length > 1 ? 's' : ''}`}
          </p>

          {turnosDelDia.length === 0 ? (
            <div className="empty-state day-empty-state">
              <CalendarX size={26} style={{ color: 'var(--border-strong)' }} />
              <p>No hay turnos para este dia</p>
            </div>
          ) : (
            <div className={`day-side-list-wrap ${dayListScrollState.scrolled ? 'is-scrolled' : ''} ${dayListScrollState.hasMore ? 'has-more' : ''}`}>
              <div className="day-side-list" ref={dayListRef} onScroll={checkDayListScroll}>
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
            </div>
          )}
        </div>
      )}
    </div>
  )
}
