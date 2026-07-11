import { X, Phone, CalendarDays, StickyNote } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { statusMeta } from './StatusSelect'

export default function PatientDetailModal({ paciente, turnos, notas, onClose }) {
  if (!paciente) return null

  const turnosDelPaciente = turnos
    .filter((t) => t.paciente === paciente.nombre)
    .slice()
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora))

  const notasDelPaciente = notas.filter((n) => n.paciente === paciente.nombre)

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <span className="panel-title-icon" style={{ fontSize: 15.5, fontWeight: 600 }}>
            <div className="avatar" style={{ background: colorFor(paciente.nombre), width: 30, height: 30, fontSize: 12 }}>
              {initials(paciente.nombre)}
            </div>
            {paciente.nombre}
          </span>
          <button className="btn-icon-plain" onClick={onClose} aria-label="Cerrar">
            <X size={17} />
          </button>
        </div>

        {paciente.telefono && (
          <p style={{ fontSize: 12.5, color: 'var(--ink-faint)', display: 'flex', alignItems: 'center', gap: 6, marginTop: -6, marginBottom: 16 }}>
            <Phone size={13} /> {paciente.telefono}
          </p>
        )}

        <p className="panel-title" style={{ fontSize: 13, marginBottom: 8 }}>
          <span className="panel-title-icon"><CalendarDays size={15} style={{ color: 'var(--accent)' }} />Turnos ({turnosDelPaciente.length})</span>
        </p>
        <div style={{ maxHeight: 180, overflowY: 'auto', marginBottom: 18 }}>
          {turnosDelPaciente.length === 0 ? (
            <p className="note-popover-empty">Sin turnos registrados</p>
          ) : (
            turnosDelPaciente.map((t) => {
              const meta = statusMeta(t.estado)
              return (
                <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 2px', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-faint)', width: 88, flexShrink: 0 }}>{t.fecha} {t.hora}</span>
                  <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.motivo}</span>
                  <span className="badge" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                </div>
              )
            })
          )}
        </div>

        <p className="panel-title" style={{ fontSize: 13, marginBottom: 8 }}>
          <span className="panel-title-icon"><StickyNote size={15} style={{ color: 'var(--accent)' }} />Notas ({notasDelPaciente.length})</span>
        </p>
        <div style={{ maxHeight: 160, overflowY: 'auto' }}>
          {notasDelPaciente.length === 0 ? (
            <p className="note-popover-empty">Sin notas registradas</p>
          ) : (
            notasDelPaciente.map((n) => (
              <div className="note-popover-item" key={n.id} style={{ marginBottom: 6 }}>
                <p className="note-meta">{n.fecha}</p>
                <p className="note-text">{n.texto}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
