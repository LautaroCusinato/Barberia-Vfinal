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

        <div className="detail-section">
          <p className="detail-section-title">
            <CalendarDays size={14} />
            Turnos ({turnosDelPaciente.length})
          </p>
          <div className="detail-scroll">
            {turnosDelPaciente.length === 0 ? (
              <p className="detail-empty">Sin turnos registrados</p>
            ) : (
              turnosDelPaciente.map((t) => {
                const meta = statusMeta(t.estado)
                return (
                  <div key={t.id} className="detail-row">
                    <span className="detail-date">{t.fecha} {t.hora}</span>
                    <span className="detail-desc">{t.motivo}</span>
                    <span className="badge" style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="detail-section">
          <p className="detail-section-title">
            <StickyNote size={14} />
            Notas ({notasDelPaciente.length})
          </p>
          <div className="detail-scroll">
            {notasDelPaciente.length === 0 ? (
              <p className="detail-empty">Sin notas registradas</p>
            ) : (
              notasDelPaciente.map((n) => (
                <div className="detail-note" key={n.id}>
                  <p className="note-meta">{n.fecha}</p>
                  <p className="note-text">{n.texto}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
