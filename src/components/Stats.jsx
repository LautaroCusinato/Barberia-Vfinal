import { useMemo, useState } from 'react'
import { CalendarCheck, CalendarDays, CheckCircle2, Coins, Percent, Receipt, Users2, Wallet, Banknote, CreditCard, Landmark, Search, UserX, X } from 'lucide-react'
import { STATUS_OPTIONS, statusMeta } from './StatusSelect'
import AnimatedNumber from './AnimatedNumber'
import { capitalizar, formatPrecio, normalizar } from '../lib/text'
import { fechaPago, resumenCobros } from '../lib/paymentStats'

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires'

const money = (n) => formatPrecio(n)

const METODO_META = {
  efectivo: { label: 'Efectivo', Icon: Banknote, bg: 'var(--green-soft)', color: 'var(--green-text)' },
  mercadopago: { label: 'Mercado Pago', Icon: CreditCard, bg: 'var(--blue-soft)', color: 'var(--blue-text)' },
  transferencia: { label: 'Transferencia', Icon: Landmark, bg: 'var(--violet-soft)', color: 'var(--violet-text)' },
}

function ultimosNDias(n, todayKey) {
  const dias = []
  const base = new Date(`${todayKey}T12:00:00Z`)
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base)
    d.setUTCDate(d.getUTCDate() - i)
    dias.push(d.toISOString().slice(0, 10))
  }
  return dias
}

export default function Stats({ turnos, pacientes, conversaciones: _conversaciones, todayKey, barberos = [], servicios = [], pagos = [], pagosEstado = 'listo', timezone = DEFAULT_TZ }) {
  const atendidos = useMemo(() => turnos.filter((t) => statusMeta(t.estado).value === 'atendido'), [turnos])
  const resumen = useMemo(() => resumenCobros(pagos, turnos, barberos), [pagos, turnos, barberos])
  const ingresosPorBarbero = resumen.porProfesional
  const pagosListos = pagosEstado === 'listo'
  const dineroConfirmado = (valor) => pagosListos ? money(valor) : '—'
  const avisoPagos = pagosEstado === 'cargando'
    ? 'Cargando cobros. Los importes se mostrarán cuando termine la lectura.'
    : pagosEstado === 'incompleto'
      ? 'La lectura de pagos está incompleta. No se pueden confirmar los totales ni las estimaciones.'
      : 'No se pudieron actualizar los pagos. Los totales no están confirmados; el historial conservado puede estar desactualizado.'

  const maxIngresoBarbero = Math.max(1, ...ingresosPorBarbero.map((b) => b.total))

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
    // Contamos por servicio_id real (con fallback al texto de "motivo" solo
    // para turnos viejos que no tengan servicio_id cargado). Así da igual
    // si el turno vino del bot, del panel, o qué texto haya quedado en
    // motivo — siempre se agrupa por el servicio real que se hizo.
    const nombreServicio = (id) => servicios.find((s) => String(s.id) === String(id))?.nombre
    const counts = {}
    for (const t of turnos) {
      const nombre = (t.servicio_id != null && nombreServicio(t.servicio_id)) || t.motivo || 'Sin servicio'
      const key = normalizar(nombre).trim()
      if (!key) continue
      counts[key] = counts[key] || { label: nombre, count: 0 }
      counts[key].count += 1
    }
    return Object.values(counts).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [turnos, servicios])

  const maxMotivo = Math.max(1, ...motivos.map((m) => m.count))

  const dias = ultimosNDias(8, todayKey)
  const porDia = dias.map((key) => ({
    key,
    count: turnos.filter((t) => t.fecha === key).length,
  }))
  const maxDia = Math.max(1, ...porDia.map((d) => d.count))

  const confirmadosTotal = turnos.filter((t) => statusMeta(t.estado).value === 'confirmado').length

  const pagosHoy = useMemo(
    () => pagos.filter((p) => fechaPago(p.created_at, timezone) === todayKey),
    [pagos, todayKey, timezone]
  )

  const totalesPorMetodoHoy = useMemo(() => {
    const totales = { efectivo: 0, mercadopago: 0, transferencia: 0 }
    for (const p of pagosHoy) totales[p.metodo] = (totales[p.metodo] || 0) + (Number(p.monto) || 0)
    return totales
  }, [pagosHoy])

  const totalCajaHoy = pagosHoy.reduce((sum, p) => sum + (Number(p.monto) || 0), 0)

  const [filtroPagoNombre, setFiltroPagoNombre] = useState('')
  const [filtroPagoFecha, setFiltroPagoFecha] = useState('')

  const historialPagos = useMemo(() => {
    const q = normalizar(filtroPagoNombre.trim())
    return pagos
      .filter((p) => !filtroPagoFecha || fechaPago(p.created_at, timezone) === filtroPagoFecha)
      .filter((p) => !q || normalizar(p.paciente || '').includes(q))
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [pagos, filtroPagoNombre, filtroPagoFecha, timezone])

  return (
    <div>
      <p className="note-popover-empty">Cobros en pesos de los pagos cargados. Caja usa la fecha del pago en la zona del negocio.</p>
      {!pagosListos && <p role={pagosEstado === 'cargando' ? 'status' : 'alert'} className="note-popover-empty">{avisoPagos}</p>}
      <div className="stats-row">
        <div className="stat-card">
          <div>
            <p className="stat-label">Turnos registrados</p>
            <p className="stat-value"><AnimatedNumber value={totalTurnos} /></p>
          </div>
          <div className="stat-icon">
            <CalendarDays size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Tasa de asistencia</p>
            <p className="stat-value"><AnimatedNumber value={tasaAsistencia === null ? '—' : `${tasaAsistencia}%`} /></p>
          </div>
          <div className="stat-icon">
            <Percent size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Clientes totales</p>
            <p className="stat-value"><AnimatedNumber value={pacientes.length} /></p>
          </div>
          <div className="stat-icon">
            <Users2 size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Turnos confirmados</p>
            <p className="stat-value"><AnimatedNumber value={confirmadosTotal} /></p>
          </div>
          <div className="stat-icon">
            <CalendarCheck size={17} />
          </div>
        </div>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div>
            <p className="stat-label">Cobrado registrado</p>
            <p className="stat-value"><AnimatedNumber value={dineroConfirmado(resumen.cobrado)} /></p>
          </div>
          <div className="stat-icon">
            <Wallet size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Promedio por cobro</p>
            <p className="stat-value"><AnimatedNumber value={dineroConfirmado(resumen.ticketPorCobro)} /></p>
            <p className="note-popover-empty">Total cobrado ÷ cantidad de cobros registrados.</p>
          </div>
          <div className="stat-icon">
            <Receipt size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Turnos atendidos</p>
            <p className="stat-value"><AnimatedNumber value={atendidos.length} /></p>
          </div>
          <div className="stat-icon">
            <CheckCircle2 size={17} />
          </div>
        </div>
        <div className="stat-card">
          <div>
            <p className="stat-label">Ausencias</p>
            <p className="stat-value"><AnimatedNumber value={resueltos.length - asistieron} /></p>
          </div>
          <div className="stat-icon">
            <UserX size={17} />
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: '1.15rem' }}>
        <p className="panel-title">Valor estimado de atendidos sin cobro registrado</p>
        <p className="stat-value"><AnimatedNumber value={dineroConfirmado(resumen.estimadoSinCobro)} /></p>
        <p className="note-popover-empty">Precio de lista de {pagosListos ? resumen.atendidosSinCobro : '—'} turnos atendidos sin pago en los datos cargados. Es una estimación; no confirma dinero recibido ni deuda.</p>
      </div>

      <div className="two-col stats-two-col">
        <div className="panel">
          <p className="panel-title">
            <span className="panel-title-icon">Turnos por estado</span>
          </p>
          {porEstado.length === 0 ? (
            <p className="note-popover-empty">Todavía no hay turnos cargados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {porEstado.map((o) => (
                <div key={o.value}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                    <span>{o.label}</span>
                    <span style={{ color: 'var(--ink-faint)' }}>{o.count}</span>
                  </div>
                  <div className="stat-bar">
                    <div className="stat-bar-fill" style={{ width: `${(o.count / maxEstado) * 100}%`, background: o.color }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <p className="panel-title">
            <span className="panel-title-icon">Servicios más frecuentes</span>
          </p>
          {motivos.length === 0 ? (
            <p className="note-popover-empty">Todavía no hay turnos cargados</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {motivos.map((m) => (
                <div key={m.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                    <span>{capitalizar(m.label)}</span>
                    <span style={{ color: 'var(--ink-faint)' }}>{m.count}</span>
                  </div>
                  <div className="stat-bar">
                    <div className="stat-bar-fill" style={{ width: `${(m.count / maxMotivo) * 100}%`, background: 'var(--accent)' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {pagosListos && ingresosPorBarbero.length > 0 && (
        <div className="panel" style={{ marginTop: '1.15rem' }}>
          <p className="panel-title">
            <span className="panel-title-icon">Cobrado por profesional</span>
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ingresosPorBarbero.map((b) => (
              <div key={b.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                  <span>{b.label} <span style={{ color: 'var(--ink-faint)' }}>({b.cobros} {b.cobros === 1 ? 'cobro' : 'cobros'})</span></span>
                  <span style={{ color: 'var(--ink-faint)' }}>{money(b.total)}</span>
                </div>
                <div className="stat-bar">
                  <div className="stat-bar-fill" style={{ width: `${(b.total / maxIngresoBarbero) * 100}%`, background: b.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: '1.15rem' }}>
        <p className="panel-title">
          <span className="panel-title-icon">Turnos de los últimos 8 días</span>
        </p>
        <div className="bar-chart-row">
          {porDia.map((d) => (
            <div key={d.key} className="bar-chart-col">
              <span className="bar-chart-value">{d.count}</span>
              <div
                className="bar-chart-bar"
                style={{
                  height: `${Math.max(6, (d.count / maxDia) * 88)}px`,
                  background: d.key === todayKey ? 'var(--accent)' : 'var(--accent-soft-2)',
                }}
              />
              <span className="bar-chart-label">{d.key.slice(8, 10)}/{d.key.slice(5, 7)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel" style={{ marginTop: '1.15rem' }}>
        <p className="panel-title">
          <span className="panel-title-icon">Caja de hoy</span>
        </p>
        <div className="stats-row" style={{ marginBottom: 0 }}>
          {Object.entries(METODO_META).map(([key, meta]) => (
            <div className="stat-card" key={key}>
              <div>
                <p className="stat-label">{meta.label}</p>
                <p className="stat-value"><AnimatedNumber value={dineroConfirmado(totalesPorMetodoHoy[key])} /></p>
              </div>
              <div className="stat-icon">
                <meta.Icon size={17} />
              </div>
            </div>
          ))}
          <div className="stat-card">
            <div>
              <p className="stat-label">Total en caja hoy</p>
              <p className="stat-value"><AnimatedNumber value={dineroConfirmado(totalCajaHoy)} /></p>
            </div>
            <div className="stat-icon">
              <Coins size={17} />
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: '1.15rem' }}>
        <p className="panel-title">
          <span className="panel-title-icon">Historial de pagos</span>
        </p>

        <div className="toolbar-row" style={{ marginBottom: 12 }}>
          <div className="search-bar toolbar-search">
            <Search size={15} style={{ color: 'var(--ink-faint)' }} />
            <input
              className="search-input"
              aria-label="Filtrar pagos por cliente"
              placeholder="Buscar por cliente…"
              value={filtroPagoNombre}
              onChange={(e) => setFiltroPagoNombre(e.target.value)}
            />
            {filtroPagoNombre && (
              <button className="btn-icon-plain" onClick={() => setFiltroPagoNombre('')} aria-label="Limpiar búsqueda">
                <X size={15} />
              </button>
            )}
          </div>
          <input
            className="text-input"
            type="date"
            aria-label="Filtrar pagos por fecha"
            style={{ maxWidth: 170 }}
            value={filtroPagoFecha}
            onChange={(e) => setFiltroPagoFecha(e.target.value)}
          />
          {filtroPagoFecha && (
            <button className="btn" onClick={() => setFiltroPagoFecha('')}>Ver todos los días</button>
          )}
        </div>

        {historialPagos.length === 0 ? (
          <p className="note-popover-empty">
            {!pagosListos ? 'Esperando una lectura completa de pagos.' : pagos.length === 0 ? 'Todavía no se registró ningún cobro' : 'Ningún cobro coincide con el filtro'}
          </p>
        ) : (
          <div className="table-scroll table-scroll--pagos">
            <table className="table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Cliente</th>
                  <th>Servicio</th>
                  <th>Método</th>
                  <th>Monto</th>
                </tr>
              </thead>
              <tbody>
                {historialPagos.map((p) => {
                  const meta = METODO_META[p.metodo]
                  const fecha = new Date(p.created_at)
                  return (
                    <tr key={p.id}>
                      <td>
                        {fechaPago(p.created_at, timezone) ? new Intl.DateTimeFormat('es-AR', { timeZone: timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(fecha) : 'Fecha no disponible'}
                      </td>
                      <td>{p.paciente || '—'}</td>
                      <td>{p.servicio || '—'}</td>
                      <td>
                        {meta && (
                          <span className="origen-badge" style={{ background: meta.bg, color: meta.color }}>
                            <meta.Icon size={10} strokeWidth={2.5} />
                            {meta.label}
                          </span>
                        )}
                      </td>
                      <td>{money(p.monto)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
