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
import { ChevronLeft, ChevronRight, ChevronDown, Check, CalendarX, LayoutGrid, List, Plus, Users, Clock3, Coffee, Ban, UserRound } from 'lucide-react'
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

export default function Calendar({ turnos, todayKey, onChangeEstado, onDeleteTurno, onEditTurno, notas, onAddNota, onNewTurno, barberos = [], bloqueos = [] }) {
  const initial = parseISO(todayKey)
  const [month, setMonth] = useState(initial)
  const [selected, setSelected] = useState(initial)
  const [viewMode, setViewMode] = useState('mes')
  const [barberoFiltro, setBarberoFiltro] = useState('')
  const [barberoMenuOpen, setBarberoMenuOpen] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const barberoMenuRef = useRef(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

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
  const bloqueosDelDia = (fecha) => bloqueos.filter((b) => b.fecha === fecha && (b.barbero_id == null || !barberoFiltro || String(b.barbero_id) === barberoFiltro))
  const bloqueoSeleccionado = bloqueosDelDia(selectedKey)
  const mapaBarberoSeleccionado = barberosVisibles.length === 1 ? parseHorarioBarbero(barberosVisibles[0]?.horario) : null
  const breakBlocksForDay = (day) => {
    if (!mapaBarberoSeleccionado) return []
    return (mapaBarberoSeleccionado[day.getDay()] || []).filter((block) => block.break)
  }
  const hasBreaks = barberos.some((barbero) => Object.values(parseHorarioBarbero(barbero.horario) || {}).some((blocks) => blocks.some((block) => block.break)))
  const currentTimeLabel = formatCurrentTime(now)

  const turnosDelDia = (byDate[selectedKey] || [])
    .slice()
    .sort((a, b) => a.hora.localeCompare(b.hora) || barberoNombre(a.barbero_id).localeCompare(barberoNombre(b.barbero_id)))

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

  // ===== FUNCIÓN PARA AGRUPAR TURNOS POR HORA EN UN SLOT =====
  const getTurnosAgrupadosPorHora = (eventos, slot) => {
    const slotMin = toMinutes(slot)
    // Filtrar turnos que ocupan este slot
    const activos = eventos.filter(t => {
      const tMin = toMinutes(t.hora)
      const tFin = tMin + (t.duracion || 30)
      return slotMin >= tMin && slotMin < tFin
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
                  className={`calendar-day ${outside ? 'outside' : ''} ${key === todayKey ? 'today' : ''} ${isSameDay(day, selected) ? 'selected' : ''} ${bloqueosDelDia(key).length ? 'is-blocked' : ''}`}
                  role="gridcell"
                  tabIndex={outside ? -1 : 0}
                  aria-selected={isSameDay(day, selected)}
                  aria-label={`${format(day, "EEEE d 'de' MMMM", { locale: es })}${eventos.length ? `, ${eventos.length} turnos` : ', sin turnos'}${bloqueosDelDia(key).length ? ', bloqueado' : ''}`}
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
                  {bloqueosDelDia(key).length > 0 && <span className="calendar-day-state"><Ban size={11} aria-hidden="true" /> Bloqueado</span>}
                  {!outside && eventos.length > 0 && (
                    <div className="calendar-day-dots">
                      {eventos.slice(0, 4).map((ev) => {
                        const barbero = barberos.find((b) => String(b.id) === String(ev.barbero_id))
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
                const bloqueado = bloqueosDelDia(key).length > 0
                return (
                  <div
                    key={key}
                    className={`week-cell week-day-header ${key === todayKey ? 'today' : ''} ${noAtiende ? 'week-day-off' : ''} ${bloqueado ? 'week-day-blocked' : ''}`}
                    onClick={() => setSelected(day)}
                    title={bloqueado ? 'Día bloqueado' : noAtiende ? `${barberoUnico.nombre} no atiende este día` : undefined}
                  >
                    <span style={{ display: 'block', fontSize: 10, color: 'var(--ink-faint)', textTransform: 'uppercase' }}>
                      {format(day, 'EEE', { locale: es })}
                    </span>
                    {format(day, 'd')}
                    {bloqueado && <Ban size={13} aria-label="Día bloqueado" />}
                  </div>
                )
              })}

              {slots.map((slot) => (
                <div key={`row-${slot}`} style={{ display: 'contents' }}>
                  <div className="week-cell week-time-label">{slot}</div>
                  {weekDays.map((day) => {
                    const key = format(day, 'yyyy-MM-dd')
                    const eventos = byDate[key] || []
                    const bloqueado = bloqueosDelDia(key).length > 0
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

                            return (
                              <button
                                key={t.id}
                                className={`week-chip ${span > 1 ? 'week-chip--largo' : ''}`}
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
                                  transition: 'all 0.15s ease',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  justifyContent: 'center',
                                  lineHeight: '1.2',
                                  position: 'relative',
                                  zIndex: 5,
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                }}
                                onClick={(e) => { e.stopPropagation(); onEditTurno(t) }}
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
            </div>
          </div>
        )}
      </div>

      {viewMode === 'mes' && (
        <div className="panel day-side-panel">
          <div className="day-panel-header">
            <div>
              <span className="day-panel-eyebrow">Detalle del día</span>
              <span className="day-panel-date">{format(selected, "EEEE d 'de' MMMM", { locale: es })}</span>
            </div>
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

          <div className="day-panel-metrics" aria-label="Resumen del día">
            <span><strong>{turnosDelDia.length}</strong><small>turnos</small></span>
            <span><strong>{barberos.length}</strong><small>profesionales</small></span>
            <span className={bloqueoSeleccionado.length ? 'is-blocked' : ''}><strong>{bloqueoSeleccionado.length ? 'Sí' : 'No'}</strong><small>bloqueo</small></span>
          </div>

          {barberos.length > 0 && (
            <div className="day-panel-team" aria-label="Profesionales del día">
              <span className="day-panel-eyebrow"><UserRound size={12} /> Equipo</span>
              <div className="day-panel-team-list">
                {barberos.map((barbero) => {
                  const trabaja = Boolean(parseHorarioBarbero(barbero.horario)?.[selected.getDay()]) && !bloqueos.some((b) => b.fecha === selectedKey && (b.barbero_id == null || String(b.barbero_id) === String(barbero.id)))
                  return <span className={`day-panel-team-chip ${trabaja ? 'is-working' : 'is-off'}`} key={barbero.id}><i style={{ background: barbero.color }} />{barbero.nombre}<small>{trabaja ? 'Trabaja' : 'No disponible'}</small></span>
                })}
              </div>
            </div>
          )}

          {turnosDelDia.length === 0 ? (
            <div className="empty-state day-empty-state">
              <CalendarX size={26} style={{ color: 'var(--border-strong)' }} />
              <p>No hay turnos para este dia</p>
            </div>
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
