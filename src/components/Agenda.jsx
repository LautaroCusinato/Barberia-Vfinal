import { CalendarOff } from 'lucide-react'
import TurnoRow from './TurnoRow'

export default function Agenda({ turnos, compact, onChangeEstado, onDeleteTurno, onEditTurno, notas, onAddNota, barberos = [] }) {
  if (turnos.length === 0) {
    return (
      <div className="empty-state">
        <CalendarOff size={26} style={{ color: 'var(--border-strong)' }} />
        <p>No hay turnos agendados para hoy</p>
      </div>
    )
  }

  // Solo agrupamos por barbero si hay mas de uno; con un solo barbero
  // el agrupado no aporta nada y solo agrega ruido visual.
  if (barberos.length <= 1) {
    return (
      <div>
        {turnos.map((t) => (
          <TurnoRow
            key={t.id}
            turno={t}
            compact={compact}
            onChangeEstado={onChangeEstado}
            onDeleteTurno={onDeleteTurno}
            onEditTurno={onEditTurno}
            notas={notas}
            onAddNota={onAddNota}
            barberos={barberos}
          />
        ))}
      </div>
    )
  }

  const grupos = barberos
    .map((barbero) => ({
      barbero,
      turnos: turnos.filter((t) => String(t.barbero_id) === String(barbero.id)),
    }))
    .filter((g) => g.turnos.length > 0)

  const sinBarbero = turnos.filter((t) => !barberos.some((b) => String(b.id) === String(t.barbero_id)))

  return (
    <div className="agenda-groups">
      {grupos.map(({ barbero, turnos: turnosBarbero }) => (
        <section className="agenda-section" key={barbero.id}>
          <h3 className="agenda-section-title">
            <span className="agenda-section-dot" style={{ background: barbero.color }} />
            {barbero.nombre}
            <span className="agenda-section-count">{turnosBarbero.length}</span>
          </h3>
          {turnosBarbero.map((t) => (
            <TurnoRow
              key={t.id}
              turno={t}
              compact={compact}
              onChangeEstado={onChangeEstado}
              onDeleteTurno={onDeleteTurno}
              onEditTurno={onEditTurno}
              notas={notas}
              onAddNota={onAddNota}
              barberos={barberos}
            />
          ))}
        </section>
      ))}

      {sinBarbero.length > 0 && (
        <section className="agenda-section">
          <h3 className="agenda-section-title">
            <span className="agenda-section-dot" style={{ background: 'var(--ink-faint)' }} />
            Sin barbero asignado
            <span className="agenda-section-count">{sinBarbero.length}</span>
          </h3>
          {sinBarbero.map((t) => (
            <TurnoRow
              key={t.id}
              turno={t}
              compact={compact}
              onChangeEstado={onChangeEstado}
              onDeleteTurno={onDeleteTurno}
              onEditTurno={onEditTurno}
              notas={notas}
              onAddNota={onAddNota}
              barberos={barberos}
            />
          ))}
        </section>
      )}
    </div>
  )
}
