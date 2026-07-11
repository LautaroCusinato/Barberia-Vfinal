import { useMemo } from 'react'
import { BarChart3, TrendingUp, Users2, CalendarX2, Wallet } from 'lucide-react'
import { STATUS_OPTIONS, statusMeta } from './StatusSelect'
import { normalizar } from '../lib/text'

const money = (n) =>
  (n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })

function ultimosNDias(n, todayKey) {
  const dias = []
  const base = new Date(`${todayKey}T12:00:00`)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setDate(d.getDate() - i)
    dias.push(d.toISOString().slice(0, 10))
  }
  return dias
}

export default function Stats({ turnos, pacientes, conversaciones, todayKey, barberos = [] }) {
  const atendidos = useMemo(() => turnos.filter((t) => statusMeta(t.estado).value === 'atendido'), [turnos])
  const ingresosTotales = useMemo(() => atendidos.reduce((acc, t) => acc + (Number(t.precio) || 0), 0), [atendidos])
  const ticketPromedio = atendidos.length > 0 ? Math.round(ingresosTotales / atendidos.length) : 0

  const ingresosPorBarbero = useMemo(() => {
    const nombreDe = (id) => barberos.find((b) => String(b.id) === String(id))?.nombre || 'Sin barbero'
    const colorDe = (id) => barberos.find((b) => String(b.id) === String(id))?.color || 'var(--accent)'
    const totales = {}
    for (const t of atendidos) {
      const key = String(t.barbero_id)
      if (!totales[key]) totales[key] = { label: nombreDe(t.barbero_id), color: colorDe(t.barbero_id), total: 0, turnos: 0 }
      totales[key].total += Number(t.precio) || 0
      totales[key].turnos += 1
    }
    return Object.values(totales).sort((a, b) => b.total - a.total)
  }, [atendidos, barberos])

  const maxIngresoBarbero = Math.max(1, ...ingresosPorBarbero.map((b) => b.total))

  // Se cuenta por el estado ya normalizado (statusMeta), asi un turno
  // viejo que haya quedado con un estado heredado del panel dental
  // (pendiente, llego, en_atencion, cancelado) cae en uno de los 3
  // baldes reales en vez de aparecer como una categoria aparte.
  const porEstado = useMemo(() => {
    const counts = {}
    for (const t of turnos) {
      const v = statusMeta(t.estado).value
      counts[v] = (counts[v] || 0) + 1
    }
    return STATUS_OPTIONS.map((o) => ({ ...o, count: counts[o.value] || 0 })).filter((o) => o.count > 0)
  }, [turnos])

  const totalTurnos = turnos.length
  const maxEstado = Math.max(1, ...porEstado.map((o) => o.count))

  const resueltos = turnos.filter((t) => ['atendido', 'no_asistio'].includes(statusMeta(t.estado).value))
  const asistieron = turnos.filter((t) => statusMeta(t.estado).value === 'atendido').length
  const tasaAsistencia = resueltos.length > 0 ? Math.round((asistieron / resueltos.length) * 100) : null

  const motivos = useMemo(() => {
    const counts = {}
    for (const t of turnos) {
      const key = normalizar(t.motivo || 'sin motivo').trim()
      if (!key) continue
      counts[key] = counts[key] || { label: t.motivo || 'Sin motivo', count: 0 }
      counts[key].count += 1
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [turnos])

  const maxMotivo = Math.max(1, ...motivos.map((m) => m.count))

  const dias = ultimosNDias(8, todayKey)
  const porDia = dias.map((key) => ({
    key,
    count: turnos.filter((t) => t.fecha === key).length,
  }))
  const maxDia = Math.max(1, ...porDia.map((d) => d.count))

  // Ya no existe un estado "pendiente" separado: un turno recien
  // agendado nace en "confirmado" y ese es el que todavia esta activo
  // (no se resolvio como atendido o no_asistio).
  const confirmadosTotal = turnos.filter((t) => statusMeta(t.estado).value === 'confirmado').length

  return (
    <div>
      <div className="stats-row">
        <div className="stat-card">
          <div>
            <p className="stat-label">Turnos registrados</p>
            <p className="stat-value">{totalTurnos}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
            <BarChart3 size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Tasa de asistencia</p>
            <p className="stat-value">{tasaAsistencia === null ? '—' : `${tasaAsistencia}%`}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--blue-soft)', color: 'var(--blue-text)' }}>
            <TrendingUp size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Clientes totales</p>
            <p className="stat-value">{pacientes.length}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--violet-soft)', color: 'var(--violet-text)' }}>
            <Users2 size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Turnos confirmados</p>
            <p className="stat-value">{confirmadosTotal}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--amber-soft)', color: 'var(--amber-text)' }}>
            <CalendarX2 size={17} />
          </div>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div>
            <p className="stat-label">Ingresos facturados</p>
            <p className="stat-value">{money(ingresosTotales)}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--blue-soft)', color: 'var(--blue-text)' }}>
            <Wallet size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Ticket promedio</p>
            <p className="stat-value">{money(ticketPromedio)}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--violet-soft)', color: 'var(--violet-text)' }}>
            <TrendingUp size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Cortes atendidos</p>
            <p className="stat-value">{atendidos.length}</p>
          </div>
          <div className="stat-icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
            <BarChart3 size={17} />
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <p className="panel-title">
            <span className="panel-title-icon">Turnos por estado</span>
          </p>
          {porEstado.length === 0 ? (
            <p className="note-popover-empty">Todavia no hay turnos cargados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {porEstado.map((o) => (
                <div key={o.value}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                    <span>{o.label}</span>
                    <span style={{ color: 'var(--ink-faint)' }}>{o.count}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 100, background: 'var(--surface-muted)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(o.count / maxEstado) * 100}%`, background: o.color, borderRadius: 100 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <p className="panel-title">
            <span className="panel-title-icon">Servicios mas frecuentes</span>
          </p>
          {motivos.length === 0 ? (
            <p className="note-popover-empty">Todavia no hay turnos cargados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {motivos.map((m) => (
                <div key={m.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ textTransform: 'capitalize' }}>{m.label}</span>
                    <span style={{ color: 'var(--ink-faint)' }}>{m.count}</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 100, background: 'var(--surface-muted)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(m.count / maxMotivo) * 100}%`, background: 'var(--accent)', borderRadius: 100 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {ingresosPorBarbero.length > 0 && (
        <div className="panel" style={{ marginTop: '1.15rem' }}>
          <p className="panel-title">
            <span className="panel-title-icon">Ingresos por barbero</span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ingresosPorBarbero.map((b) => (
              <div key={b.label}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                  <span>{b.label} <span style={{ color: 'var(--ink-faint)' }}>({b.turnos} cortes)</span></span>
                  <span style={{ color: 'var(--ink-faint)' }}>{money(b.total)}</span>
                </div>
                <div style={{ height: 7, borderRadius: 100, background: 'var(--surface-muted)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(b.total / maxIngresoBarbero) * 100}%`, background: b.color, borderRadius: 100 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: '1.15rem' }}>
        <p className="panel-title">
          <span className="panel-title-icon">Turnos de los ultimos 8 dias</span>
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 120, paddingTop: 8 }}>
          {porDia.map((d) => (
            <div key={d.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)' }}>{d.count}</span>
              <div
                style={{
                  width: '100%',
                  maxWidth: 34,
                  height: `${Math.max(6, (d.count / maxDia) * 88)}px`,
                  background: d.key === todayKey ? 'var(--accent)' : 'var(--accent-soft-2)',
                  borderRadius: 5,
                }}
              />
              <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{d.key.slice(8, 10)}/{d.key.slice(5, 7)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
