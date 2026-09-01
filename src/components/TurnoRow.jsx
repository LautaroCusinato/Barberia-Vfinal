import { useEffect, useRef, useState } from 'react'
import { StickyNote, Trash2, Check, X, Pencil, MessageCircle, Clock3, Scissors, UserRound, Timer } from 'lucide-react'
import StatusSelect, { statusMeta } from './StatusSelect'

export default function TurnoRow({ turno, compact, onChangeEstado, onDeleteTurno, onEditTurno, notas, onAddNota, barberos = [] }) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const wrapRef = useRef(null)

  const notasPaciente = (notas || []).filter((n) => n.paciente === turno.paciente)
  const barbero = barberos.find((b) => String(b.id) === String(turno.barbero_id))
  const meta = statusMeta(turno.estado)
  const serviceLabel = turno.motivo || 'Servicio sin especificar'
  const durationLabel = `${turno.duracion || 30} min`

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setNotesOpen(false)
        setConfirmDelete(false)
      }
    }
    if (notesOpen || confirmDelete) document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [notesOpen, confirmDelete])

  const guardarNota = async () => {
    if (!draft.trim()) return
    setSaving(true)
    setErrorMsg('')
    try {
      const saved = await onAddNota({ paciente: turno.paciente, texto: draft.trim() })
      if (saved !== false) setDraft('')
      else setErrorMsg('No se pudo guardar la nota. El borrador quedó preservado.')
    } catch {
      setErrorMsg('No se pudo guardar la nota. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  const eliminarTurno = async () => {
    if (deleting) return
    setDeleting(true)
    setErrorMsg('')
    try {
      const removed = await onDeleteTurno(turno.id)
      if (removed !== false) setConfirmDelete(false)
      else setErrorMsg('No se pudo eliminar el turno. Sigue disponible para reintentar.')
    } catch {
      setErrorMsg('No se pudo eliminar el turno. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <article
      className={`agenda-item agenda-item--enhanced agenda-item--${meta.value}${notesOpen ? ' agenda-item--notes-open' : ''}${confirmDelete ? ' agenda-item--delete-open' : ''}`}
      ref={wrapRef}
      style={{ '--agenda-barber-color': barbero?.color || 'var(--accent)' }}
      aria-label={`${turno.paciente}, ${serviceLabel}, ${barbero?.nombre || 'sin profesional'}, ${durationLabel}, ${meta.label}`}
    >
      <div className="agenda-time-block">
        <span className="agenda-time"><Clock3 size={13} aria-hidden="true" />{turno.hora}</span>
        <span className="agenda-time-divider" aria-hidden="true" />
        <span className="agenda-duration"><Timer size={12} aria-hidden="true" />{durationLabel}</span>
      </div>
      <div className="agenda-info">
        <div className="agenda-card-heading">
          <p className="agenda-patient">
          <span className="agenda-patient-name">{turno.paciente}</span>
          {turno.origen === 'whatsapp' && (
            <span className="origen-badge origen-badge--wsp" title="Agendado por WhatsApp">
              <MessageCircle size={10} strokeWidth={2.5} />
              WhatsApp
            </span>
          )}
          </p>
        </div>
        <div className="agenda-card-meta">
          <span><Scissors size={12} aria-hidden="true" />{serviceLabel}</span>
          <span><UserRound size={12} aria-hidden="true" />{barbero?.nombre || 'Sin profesional'}</span>
          {compact && <span className="agenda-card-meta-duration"><Timer size={12} aria-hidden="true" />{durationLabel}</span>}
        </div>
      </div>

      <div className="agenda-actions" style={{ flexShrink: 0 }}>
        <button
          className={`btn-icon-plain ${notasPaciente.length > 0 ? 'has-notes' : ''}`}
          onClick={() => { setErrorMsg(''); setNotesOpen((v) => !v); setConfirmDelete(false) }}
          disabled={saving || deleting}
          aria-label="Notas del cliente"
          title="Notas del cliente"
        >
          <StickyNote size={15} />
          {notasPaciente.length > 0 && <span className="note-count">{notasPaciente.length}</span>}
        </button>

        <StatusSelect value={turno.estado} onChange={(v) => onChangeEstado(turno.id, v)} />

        <button className="btn-icon-plain" onClick={() => onEditTurno(turno)} disabled={saving || deleting} aria-label="Editar turno" title="Editar turno">
          <Pencil size={14} />
        </button>

        <span className="delete-btn-wrap">
          <button
            className={`btn-icon-plain ${confirmDelete ? 'danger-active' : ''}`}
            onClick={() => { setErrorMsg(''); setConfirmDelete((v) => !v); setNotesOpen(false) }}
            disabled={saving || deleting}
            aria-label="Eliminar turno"
            title="Eliminar turno"
          >
            <Trash2 size={15} />
          </button>
          {confirmDelete && (
            <div className="delete-confirm-popover">
              <p className="delete-confirm-text">¿Eliminar este turno?</p>
              <div className="delete-confirm-buttons">
                <button className="btn-icon-plain danger-solid" onClick={eliminarTurno} disabled={deleting} aria-label="Confirmar eliminar turno">
                  <Check size={13} strokeWidth={2.75} />
                  <span>{deleting ? 'Eliminando...' : 'Eliminar'}</span>
                </button>
                <button className="btn-icon-plain" onClick={() => setConfirmDelete(false)} disabled={deleting} aria-label="Cancelar">
                  <X size={13} strokeWidth={2.75} />
                  <span>Cancelar</span>
                </button>
              </div>
            </div>
          )}
        </span>
      </div>

      {notesOpen && (
        <div className="note-popover">
          <p className="note-popover-title">Notas de {turno.paciente}</p>
          {notasPaciente.length === 0 ? (
            <p className="note-popover-empty">Sin notas todavia</p>
          ) : (
            <div className="note-popover-list">
              {notasPaciente.map((n) => (
                <div className="note-popover-item" key={n.id}>
                  <p className="note-meta">{n.fecha}</p>
                  <p className="note-text">{n.texto}</p>
                </div>
              ))}
            </div>
          )}
          <textarea
            className="note-input"
            placeholder="Agregar una nota sobre este cliente..."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            disabled={saving}
          />
          {errorMsg && <p className="login-error" role="alert">{errorMsg}</p>}
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
            onClick={guardarNota}
            disabled={saving}
          >
            {saving ? 'Guardando...' : 'Agregar nota'}
          </button>
        </div>
      )}
    </article>
  )
}
