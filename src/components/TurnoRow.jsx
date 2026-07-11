import { useEffect, useRef, useState } from 'react'
import { StickyNote, Trash2, Check, X, Pencil } from 'lucide-react'
import StatusSelect from './StatusSelect'

export default function TurnoRow({ turno, compact, onChangeEstado, onDeleteTurno, onEditTurno, notas, onAddNota, barberos = [] }) {
  const [notesOpen, setNotesOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const wrapRef = useRef(null)

  const notasPaciente = (notas || []).filter((n) => n.paciente === turno.paciente)
  const barbero = barberos.find((b) => String(b.id) === String(turno.barbero_id))

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
    await onAddNota({ paciente: turno.paciente, texto: draft.trim() })
    setDraft('')
    setSaving(false)
  }

  return (
    <div className="agenda-item" ref={wrapRef}>
      <span className="agenda-time">{turno.hora}</span>
      <div className="agenda-info">
        <p className="agenda-patient">{turno.paciente}</p>
        {!compact && (
          <p className="agenda-reason">
            {turno.motivo}
            {barbero ? ` - ${barbero.nombre}` : ''}
            {turno.duracion ? ` - ${turno.duracion} min` : ''}
          </p>
        )}
      </div>

      <div className="agenda-actions">
        <button
          className={`btn-icon-plain ${notasPaciente.length > 0 ? 'has-notes' : ''}`}
          onClick={() => { setNotesOpen((v) => !v); setConfirmDelete(false) }}
          aria-label="Notas del cliente"
          title="Notas del cliente"
        >
          <StickyNote size={15} />
          {notasPaciente.length > 0 && <span className="note-count">{notasPaciente.length}</span>}
        </button>

        <StatusSelect value={turno.estado} onChange={(v) => onChangeEstado(turno.id, v)} />

        <button className="btn-icon-plain" onClick={() => onEditTurno(turno)} aria-label="Editar turno" title="Editar turno">
          <Pencil size={14} />
        </button>

        <span className="delete-btn-wrap">
          <button
            className={`btn-icon-plain ${confirmDelete ? 'danger-active' : ''}`}
            onClick={() => { setConfirmDelete((v) => !v); setNotesOpen(false) }}
            aria-label="Eliminar turno"
            title="Eliminar turno"
          >
            <Trash2 size={15} />
          </button>
          {confirmDelete && (
            <div className="delete-confirm-popover">
              <p className="delete-confirm-text">¿Eliminar este turno?</p>
              <div className="delete-confirm-buttons">
                <button className="btn-icon-plain danger-solid" onClick={() => onDeleteTurno(turno.id)} aria-label="Confirmar eliminar turno">
                  <Check size={13} strokeWidth={2.75} />
                  <span>Eliminar</span>
                </button>
                <button className="btn-icon-plain" onClick={() => setConfirmDelete(false)} aria-label="Cancelar">
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
          />
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
    </div>
  )
}
