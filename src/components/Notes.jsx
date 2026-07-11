import { useEffect, useMemo, useState } from 'react'
import { NotebookPen, StickyNote, Check, Search, X, Pencil, Trash2 } from 'lucide-react'
import { normalizar } from '../lib/text'

const PACIENTE_GENERAL = 'General'
const OTRO_PACIENTE = '__otro__'

function NoteCard({ nota, onUpdate, onDelete }) {
  const [editando, setEditando] = useState(false)
  const [draft, setDraft] = useState(nota.texto)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  const guardar = async () => {
    if (!draft.trim()) return
    setSaving(true)
    await onUpdate?.(nota.id, draft.trim())
    setSaving(false)
    setEditando(false)
  }

  const cancelar = () => {
    setDraft(nota.texto)
    setEditando(false)
  }

  return (
    <div className="note-card fade-in">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <p className="note-meta">{nota.paciente} · {nota.fecha}</p>
        {!editando && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="btn-icon-plain" onClick={() => setEditando(true)} aria-label="Editar nota" title="Editar nota">
              <Pencil size={13} />
            </button>
            {confirmDelete ? (
              <span className="confirm-delete">
                <button className="btn-icon-plain danger-solid" onClick={() => onDelete?.(nota.id)} aria-label="Confirmar eliminar nota">
                  <Check size={12} strokeWidth={2.75} />
                </button>
                <button className="btn-icon-plain" onClick={() => setConfirmDelete(false)} aria-label="Cancelar">
                  <X size={12} strokeWidth={2.75} />
                </button>
              </span>
            ) : (
              <button className="btn-icon-plain" onClick={() => setConfirmDelete(true)} aria-label="Eliminar nota" title="Eliminar nota">
                <Trash2 size={13} />
              </button>
            )}
          </div>
        )}
      </div>

      {editando ? (
        <div style={{ marginTop: 6 }}>
          <textarea className="note-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={cancelar}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar'}
            </button>
          </div>
        </div>
      ) : (
        <p className="note-text">{nota.texto}</p>
      )}
    </div>
  )
}

export default function Notes({ notas, onAdd, onUpdate, onDelete, pacientes, filtroInicial }) {
  const [texto, setTexto] = useState('')
  const [pacienteSel, setPacienteSel] = useState(PACIENTE_GENERAL)
  const [pacienteLibre, setPacienteLibre] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState(filtroInicial || '')

  // Si llegamos acá desde "ver notas" de un paciente puntual (en la sección
  // Pacientes), precargamos el filtro con su nombre.
  useEffect(() => {
    if (filtroInicial) setQuery(filtroInicial)
  }, [filtroInicial])

  const notasFiltradas = useMemo(() => {
    const q = query.trim()
    if (!q) return notas
    const qn = normalizar(q)
    return notas.filter((n) => normalizar(n.paciente || '').includes(qn))
  }, [notas, query])

  const submit = async () => {
    if (!texto.trim()) return
    const pacienteFinal = pacienteSel === OTRO_PACIENTE ? pacienteLibre.trim() || PACIENTE_GENERAL : pacienteSel
    setSaving(true)
    await onAdd({ paciente: pacienteFinal, texto: texto.trim() })
    setTexto('')
    setPacienteLibre('')
    setSaving(false)
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: '1.15rem' }}>
        <p className="panel-title">
          <span className="panel-title-icon">
            <NotebookPen size={16} style={{ color: 'var(--accent)' }} />
            Nueva nota
          </span>
        </p>

        {/* Listado de pacientes para elegir a quién corresponde la nota,
            en vez de tener que escribir el nombre a mano. */}
        <select
          className="text-input"
          value={pacienteSel}
          onChange={(e) => setPacienteSel(e.target.value)}
          style={{ marginBottom: 8 }}
        >
          <option value={PACIENTE_GENERAL}>General (sin cliente puntual)</option>
          {(pacientes || []).map((p) => (
            <option key={p.id} value={p.nombre}>{p.nombre}</option>
          ))}
          <option value={OTRO_PACIENTE}>Otro cliente (escribir nombre)...</option>
        </select>

        {pacienteSel === OTRO_PACIENTE && (
          <input
            className="text-input"
            placeholder="Nombre del cliente"
            value={pacienteLibre}
            onChange={(e) => setPacienteLibre(e.target.value)}
            style={{ marginBottom: 8 }}
          />
        )}

        <textarea
          className="note-input"
          placeholder="Escribi una preferencia del cliente o recordatorio..."
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            <Check size={14} strokeWidth={2.5} />
            {saving ? 'Guardando...' : 'Guardar nota'}
          </button>
        </div>
      </div>

      <div className="search-bar">
        <Search size={16} style={{ color: 'var(--ink-faint)' }} />
        <input
          className="search-input"
          placeholder="Filtrar notas por cliente..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="btn-icon-plain" onClick={() => setQuery('')} aria-label="Limpiar filtro">
            <X size={15} />
          </button>
        )}
      </div>

      {notas.length === 0 ? (
        <div className="empty-state">
          <StickyNote size={26} style={{ color: 'var(--border-strong)' }} />
          <p>Todavia no hay notas guardadas</p>
        </div>
      ) : notasFiltradas.length === 0 ? (
        <div className="empty-state">
          <Search size={26} style={{ color: 'var(--border-strong)' }} />
          <p>Ninguna nota coincide con "{query}"</p>
        </div>
      ) : (
        notasFiltradas.map((n) => (
          <NoteCard key={n.id} nota={n} onUpdate={onUpdate} onDelete={onDelete} />
        ))
      )}
    </div>
  )
}
