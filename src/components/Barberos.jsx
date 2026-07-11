import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'
import { CalendarCheck, Wallet, Clock, ChevronRight, Users2, X } from 'lucide-react'
import TurnoRow from './TurnoRow'
import { statusMeta } from './StatusSelect'

const money = (n) =>
  (n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

function fechaLegible(fecha, todayKey) {
  if (fecha === todayKey) return 'Hoy'
  try {
    return format(parseISO(fecha), "EEEE d 'de' MMMM", { locale: es })
  } catch {
    return fecha
  }
}

export default function Barberos({
  barberos,
  turnos,
  todayKey,
  notas,
  onChangeEstado,
  onDeleteTurno,
  onEditTurno,
  onAddNota,
}) {
  const [selectedId, setSelectedId] = useState(null)

  const stats = useMemo(() => {
    return barberos.map((b) => {
      const mios = turnos.filter((t) => String(t.barbero_id) === String(b.id))
      const hoy = mios.filter((t) => t.fecha === todayKey)
      // Solo se factura lo que ya se cobró: turnos que efectivamente se atendieron.
      // Antes esto sumaba tambien pendientes/confirmados/en atencion, mostrando
      // plata "cobrada" por turnos que todavia ni pasaron por el sillon.
      const atendidosHoy = hoy.filter((t) => statusMeta(t.estado).value === 'atendido')
      const ingresosHoy = atendidosHoy.reduce((acc, t) => acc + (Number(t.precio) || 0), 0)
      // "Confirmados de hoy": turnos de hoy que todavia estan activos,
      // ni atendidos ni marcados como no_asistio.
      const confirmadosHoy = hoy.filter((t) => statusMeta(t.estado).value === 'confirmado').length

      const futuros = mios
        .filter((t) => t.fecha >= todayKey && statusMeta(t.estado).value === 'confirmado')
        .sort((a, b2) => a.fecha.localeCompare(b2.fecha) || a.hora.localeCompare(b2.hora))

      const atendidos = mios.filter((t) => statusMeta(t.estado).value === 'atendido')
      const totalIngresos = atendidos.reduce((acc, t) => acc + (Number(t.precio) || 0), 0)

      return {
        barbero: b,
        turnosHoy: hoy.length,
        ingresosHoy,
        confirmadosHoy,
        proximo: futuros[0] || null,
        proximosCount: futuros.length,
        totalAtendidos: atendidos.length,
        totalIngresos,
        agenda: futuros,
      }
    })
  }, [barberos, turnos, todayKey])

  const equipo = useMemo(
    () => ({
      turnosHoy: stats.reduce((acc, s) => acc + s.turnosHoy, 0),
      ingresosHoy: stats.reduce((acc, s) => acc + s.ingresosHoy, 0),
      confirmadosHoy: stats.reduce((acc, s) => acc + s.confirmadosHoy, 0),
    }),
    [stats]
  )

  const seleccionado = stats.find((s) => String(s.barbero.id) === String(selectedId))

  const agendaAgrupada = useMemo(() => {
    if (!seleccionado) return []
    const grupos = {}
    for (const t of seleccionado.agenda) {
      if (!grupos[t.fecha]) grupos[t.fecha] = []
      grupos[t.fecha].push(t)
    }
    return Object.entries(grupos).sort(([a], [b]) => a.localeCompare(b))
  }, [seleccionado])

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card">
          <div>
            <p className="stat-label">Barberos activos</p>
            <p className="stat-value">{barberos.filter((b) => b.activo).length}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--violet-soft)', color: 'var(--violet-text)' }}>
            <Users2 size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Turnos hoy (equipo)</p>
            <p className="stat-value">{equipo.turnosHoy}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
            <CalendarCheck size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Ingresos de hoy (equipo)</p>
            <p className="stat-value">{money(equipo.ingresosHoy)}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--blue-soft)', color: 'var(--blue-text)' }}>
            <Wallet size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Confirmados de hoy</p>
            <p className="stat-value">{equipo.confirmadosHoy}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--amber-soft)', color: 'var(--amber-text)' }}>
            <Clock size={17} />
          </div>
        </div>
      </div>

      <div className="barberos-grid">
        {stats.map((s) => {
          const activo = String(selectedId) === String(s.barbero.id)
          return (
            <button
              key={s.barbero.id}
              className={`barbero-card ${activo ? 'active' : ''}`}
              style={{ '--barbero-color': s.barbero.color || 'var(--accent)' }}
              onClick={() => setSelectedId(activo ? null : s.barbero.id)}
            >
              <div className="barbero-card-top">
                <span className="ops-avatar" style={{ background: s.barbero.color || 'var(--accent)' }}>
                  {s.barbero.nombre.slice(0, 2).toUpperCase()}
                </span>
                <div className="barbero-card-name">
                  <p>{s.barbero.nombre}</p>
                  <span>{s.barbero.rol}</span>
                </div>
                <ChevronRight size={16} className="barbero-card-chevron" />
              </div>

              <div className="barbero-card-metrics">
                <div>
                  <span className="barbero-metric-value">{s.turnosHoy}</span>
                  <span className="barbero-metric-label">Turnos hoy</span>
                </div>
                <div>
                  <span className="barbero-metric-value">{money(s.ingresosHoy)}</span>
                  <span className="barbero-metric-label">Ingresos hoy</span>
                </div>
                <div>
                  <span className="barbero-metric-value">{s.proximosCount}</span>
                  <span className="barbero-metric-label">Turnos futuros</span>
                </div>
              </div>

              <p className="barbero-card-next">
                {s.proximo
                  ? `Próximo: ${fechaLegible(s.proximo.fecha, todayKey)} ${s.proximo.hora} — ${s.proximo.paciente}`
                  : 'Sin próximos turnos agendados'}
              </p>

              {!s.barbero.activo && <span className="barbero-card-inactive">Inactivo</span>}
            </button>
          )
        })}
      </div>

      {seleccionado && (
        <div className="panel" style={{ marginTop: '1.15rem' }}>
          <div className="day-panel-header">
            <span className="day-panel-date">Agenda de {seleccionado.barbero.nombre}</span>
            <button className="link-btn" onClick={() => setSelectedId(null)}>
              <X size={13} strokeWidth={2.5} />
              Cerrar
            </button>
          </div>
          <p className="day-panel-sub">
            {seleccionado.agenda.length === 0
              ? 'Sin turnos pendientes o futuros'
              : `${seleccionado.agenda.length} turno${seleccionado.agenda.length > 1 ? 's' : ''} por delante · ${seleccionado.totalAtendidos} atendidos en total · ${money(seleccionado.totalIngresos)} facturados`}
          </p>

          {agendaAgrupada.length === 0 ? (
            <div className="empty-state">
              <CalendarCheck size={26} style={{ color: 'var(--border-strong)' }} />
              <p>No hay turnos agendados para este barbero</p>
            </div>
          ) : (
            agendaAgrupada.map(([fecha, items]) => (
              <div key={fecha} style={{ marginBottom: 14 }}>
                <p className="barbero-fecha-label">{fechaLegible(fecha, todayKey)}</p>
                {items.map((t) => (
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
            ))
          )}
        </div>
      )}
    </div>
  )
}
