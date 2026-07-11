import { CalendarCheck, Clock, MessageSquare, Bot } from 'lucide-react'
import { statusMeta } from './StatusSelect'

export default function StatsCards({ turnos, conversaciones, todayKey }) {
  const hoy = turnos.length
  // Turnos de hoy que todavia estan activos (ni atendidos ni no_asistio).
  const porAtender = turnos.filter((t) => statusMeta(t.estado).value === 'confirmado').length
  const noLeidos = conversaciones.filter((c) => c.noLeido).length

  const esDeHoy = (m) => {
    if (!m.created_at) return true
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date(m.created_at)) === todayKey
  }

  const agendadosPorBot = conversaciones.reduce(
    (acc, c) => acc + c.mensajes.filter((m) => m.de === 'bot' && esDeHoy(m)).length,
    0
  )

  const stats = [
    { label: 'Turnos hoy', value: hoy, Icon: CalendarCheck, bg: 'var(--accent-soft)', color: 'var(--accent-strong)' },
    { label: 'Por atender hoy', value: porAtender, Icon: Clock, bg: 'var(--amber-soft)', color: 'var(--amber-text)' },
    { label: 'Mensajes sin leer', value: noLeidos, Icon: MessageSquare, bg: 'var(--rose-soft)', color: 'var(--rose-text)' },
    { label: 'Respuestas del bot (hoy)', value: agendadosPorBot, Icon: Bot, bg: 'var(--surface-muted)', color: 'var(--ink-soft)' },
  ]

  return (
    <div className="stats-row">
      {stats.map((s, i) => (
        <div className="stat-card fade-in" key={s.label} style={{ animationDelay: `${i * 40}ms` }}>
          <div>
            <p className="stat-label">{s.label}</p>
            <p className="stat-value">{s.value}</p>
          </div>
          <div className="stat-icon" style={{ background: s.bg, color: s.color }}>
            <s.Icon size={17} strokeWidth={2} />
          </div>
        </div>
      ))}
    </div>
  )
}
