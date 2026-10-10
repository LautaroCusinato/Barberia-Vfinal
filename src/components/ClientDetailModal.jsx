import { useId } from 'react'
import { X, Phone, CalendarDays, StickyNote, MessageCircle } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { statusMeta } from './StatusSelect'
import { formatTelefonoDisplay, formatFechaVisible } from '../lib/text'
import { conPresencia } from '../lib/presencia'
import { notaDelCliente } from '../lib/clientNotes'
import { FocusTrap } from './ui'

function ClientDetailModal({ paciente, turnos, notas, onClose, onStartChat, tieneMensajes = false }) {
  const titleId = useId()
  if (!paciente) return null

  // El nombre del turno puede ser un alias de reserva o el de un homónimo.
  // Los fixtures antiguos de demo usan paciente_id; Supabase usa cliente_id.
  const esDelPaciente = (item) => {
    const clienteId = item.cliente_id ?? item.paciente_id ?? item.clienteId
    return clienteId != null && String(clienteId) === String(paciente.id)
      && (item.barberia_id == null || paciente.barberia_id == null || String(item.barberia_id) === String(paciente.barberia_id))
  }

  const turnosDelPaciente = turnos
    .filter(esDelPaciente)
    .slice()
    .sort((a, b) => (b.fecha + b.hora).localeCompare(a.fecha + a.hora))

  const notasDelPaciente = notas.filter((nota) => notaDelCliente(nota, paciente))

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <FocusTrap onEscape={onClose} className="modal-box" style={{ maxWidth: 480 }} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="modal-header">
          <span id={titleId} className="panel-title-icon" style={{ fontSize: 15.5, fontWeight: 600 }}>
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
            <Phone size={13} /> {formatTelefonoDisplay(paciente.telefono)}
          </p>
        )}

        {onStartChat && (
          <div style={{ marginBottom: 16 }}>
            {/* Abre (o crea vacío) el hilo de este cliente en Mensajes; no envía nada. */}
            <button type="button" className="btn btn-primary" onClick={() => onStartChat(paciente.id)}>
              <MessageCircle size={14} aria-hidden="true" />
              {tieneMensajes ? 'Abrir chat' : 'Iniciar chat'}
            </button>
          </div>
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
                    <span className="detail-date">{formatFechaVisible(t.fecha)} {t.hora}</span>
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
                  <p className="note-meta">{formatFechaVisible(n.fecha)}</p>
                  <p className="note-text">{n.texto}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </FocusTrap>
    </div>
  )
}

// Animación de salida sin cambiar la lógica del modal.
export default conPresencia(ClientDetailModal, 'paciente')
