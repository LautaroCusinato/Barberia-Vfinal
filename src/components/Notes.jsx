import { useEffect, useMemo, useState } from 'react'
import { NotebookPen, StickyNote, Check, Search, X, Pencil, Trash2 } from 'lucide-react'
import { formatFechaVisible, normalizar } from '../lib/text'
import { despuesDelColapso } from '../lib/collapseDelete'
import { EmptyState } from './ui'
import { asociacionNota, clienteDeNota, etiquetaClienteNota, nombreDeNota, notaDelCliente } from '../lib/clientNotes'

const PACIENTE_GENERAL = '__general__'
const OTRO_PACIENTE = '__otro__'

function NoteCard({ nota, onUpdate, onDelete, pacientes }) {
  const [editando, setEditando] = useState(false)
  const [draft, setDraft] = useState(nota.texto)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false) // fila colapsándose
  const [errorMsg, setErrorMsg] = useState('')
  const [clienteSel, setClienteSel] = useState('__conservar__')

  const guardar = async () => {
    if (!draft.trim()) return
    setSaving(true)
    setErrorMsg('')
    try {
      const asociacion = clienteSel === '__conservar__' ? undefined : asociacionNota(clienteSel, pacientes)
      if (clienteSel !== '__conservar__' && !asociacion) { setErrorMsg('El cliente ya no está disponible. Revisá la selección.'); return }
      const saved = await onUpdate?.(nota.id, draft.trim(), asociacion)
      if (saved !== false) setEditando(false)
      else setErrorMsg('No se pudo actualizar la nota. El texto quedó preservado.')
    } catch {
      setErrorMsg('No se pudo actualizar la nota. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  // Sin confirmación: la tarjeta se colapsa y el aviso ofrece "Deshacer".
  const eliminar = () => {
    if (deleting) return
    setDeleting(true)
    despuesDelColapso(() => { if (onDelete?.(nota.id) === false) setDeleting(false) })
  }

  const cancelar = () => {
    setDraft(nota.texto)
    setClienteSel('__conservar__')
    setEditando(false)
  }

  return (
    <div className={`collapse-row${deleting ? ' is-collapsing' : ''}`}>
    <div className="collapse-row__inner">
    <div className="note-card fade-in">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <p className="note-meta">{nombreDeNota(nota, pacientes)} · {formatFechaVisible(nota.fecha)}{nota.cliente_id == null && nota.paciente !== 'General' && (clienteDeNota(nota, pacientes) ? ' · Nota anterior, vinculada por nombre' : ' · Sin vínculo a una ficha')}</p>
        {!editando && (
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button className="btn-icon-plain" onClick={() => { setErrorMsg(''); setClienteSel('__conservar__'); setEditando(true) }} disabled={deleting} aria-label="Editar nota" title="Editar nota">
              <Pencil size={13} />
            </button>
            <button className="btn-icon-plain" onClick={eliminar} disabled={deleting} aria-label="Eliminar nota" title="Eliminar nota">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      {editando ? (
        <div style={{ marginTop: 6 }}>
          <label>Cliente de esta nota
            <select className="text-input" aria-label="Cliente de esta nota" value={clienteSel} onChange={(e) => setClienteSel(e.target.value)} disabled={saving}>
              <option value="__conservar__">Conservar vínculo actual</option>
              <option value={PACIENTE_GENERAL}>General (sin cliente puntual)</option>
              {(pacientes || []).map((p) => <option key={p.id} value={String(p.id)}>{etiquetaClienteNota(p, pacientes)}</option>)}
            </select>
          </label>
          <textarea className="note-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus disabled={saving} />
          {errorMsg && <p className="login-error" role="alert">{errorMsg}</p>}
          <div style={{ marginTop: 6, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={cancelar} disabled={saving}>Cancelar</button>
            <button className="btn btn-primary" onClick={guardar} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      ) : (
        <p className="note-text">{nota.texto}</p>
      )}
    </div>
    </div>
    </div>
  )
}

export default function Notes({ notas, onAdd, onUpdate, onDelete, pacientes = [], filtroInicial, filtroClienteId, onClearCliente }) {
  const [texto, setTexto] = useState('')
  const [pacienteSel, setPacienteSel] = useState(filtroClienteId != null ? String(filtroClienteId) : PACIENTE_GENERAL)
  const [pacienteLibre, setPacienteLibre] = useState('')
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [query, setQuery] = useState(typeof filtroInicial === 'string' ? filtroInicial : '')

  // Si llegamos acá desde "ver notas" de un paciente puntual (en la sección
  // Pacientes), precargamos el filtro con su nombre.
  useEffect(() => {
    if (typeof filtroInicial === 'string' && filtroInicial) setQuery(filtroInicial)
  }, [filtroInicial])
  useEffect(() => {
    if (filtroClienteId != null) setPacienteSel(String(filtroClienteId))
  }, [filtroClienteId])

  const notasFiltradas = useMemo(() => {
    const q = query.trim()
    const qn = normalizar(q)
    const cliente = pacientes.find((p) => String(p.id) === String(filtroClienteId))
    return notas.filter((n) => (filtroClienteId == null || notaDelCliente(n, cliente, pacientes)) && (!q || normalizar(nombreDeNota(n, pacientes)).includes(qn)))
  }, [notas, query, filtroClienteId, pacientes])

  const submit = async () => {
    if (!texto.trim()) return
    const asociacion = asociacionNota(pacienteSel, pacientes, pacienteLibre)
    if (!asociacion) { setErrorMsg('El cliente ya no está disponible. Revisá la selección.'); return }
    setSaving(true)
    setErrorMsg('')
    try {
      const saved = await onAdd({ ...asociacion, texto: texto.trim() })
      if (saved !== false) {
        setTexto('')
        setPacienteLibre('')
      } else setErrorMsg('No se pudo guardar la nota. El borrador quedó preservado.')
    } catch {
      setErrorMsg('No se pudo guardar la nota. Revisá tu conexión e intentá de nuevo.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="notes-screen">
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
          aria-label="Cliente de la nota"
          value={pacienteSel}
          onChange={(e) => setPacienteSel(e.target.value)}
          disabled={saving}
          style={{ marginBottom: 8 }}
        >
          <option value={PACIENTE_GENERAL}>General (sin cliente puntual)</option>
          {(pacientes || []).map((p) => (
            <option key={p.id} value={String(p.id)}>{etiquetaClienteNota(p, pacientes)}</option>
          ))}
          <option value={OTRO_PACIENTE}>Sin ficha (escribir nombre)...</option>
        </select>

        {pacienteSel === OTRO_PACIENTE && (
          <input
            className="text-input"
            aria-label="Nombre del cliente"
            placeholder="Nombre del cliente"
            value={pacienteLibre}
            onChange={(e) => setPacienteLibre(e.target.value)}
            disabled={saving}
            style={{ marginBottom: 8 }}
          />
        )}

        <textarea
          className="note-input"
          aria-label="Contenido de la nota"
          placeholder="Escribí una preferencia del cliente o recordatorio…"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          disabled={saving}
        />
        {errorMsg && <p className="login-error" role="alert">{errorMsg}</p>}
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={submit} disabled={saving}>
            <Check size={14} strokeWidth={2.5} />
            {saving ? 'Guardando…' : 'Guardar nota'}
          </button>
        </div>
      </div>

      {filtroClienteId != null && <p className="settings-notice">Notas de {etiquetaClienteNota(pacientes.find((p) => String(p.id) === String(filtroClienteId)) || {id:filtroClienteId,nombre:'Cliente no disponible'}, pacientes)} · <button type="button" className="link-btn" onClick={() => { setQuery(''); onClearCliente?.() }}>Ver todas las notas</button></p>}
      <div className="search-bar">
        <Search size={16} style={{ color: 'var(--ink-faint)' }} />
        <input
          className="search-input"
          aria-label="Filtrar notas por cliente"
          placeholder="Filtrar notas por cliente…"
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
        <EmptyState className="empty-state" icon={<StickyNote size={26} style={{ color: 'var(--border-strong)' }} />} description="Todavía no hay notas guardadas" />
      ) : notasFiltradas.length === 0 ? (
        <EmptyState className="empty-state" icon={<Search size={26} style={{ color: 'var(--border-strong)' }} />} description={`Ninguna nota coincide con "${query}"`} />
      ) : (
        <div className="notes-list">
          {notasFiltradas.map((n) => (
            <NoteCard key={n.id} nota={n} onUpdate={onUpdate} onDelete={onDelete} pacientes={pacientes} />
          ))}
        </div>
      )}
    </div>
  )
}
