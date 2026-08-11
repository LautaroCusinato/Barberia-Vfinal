import { useMemo, useState } from 'react'
import { Users, Search, X, StickyNote, UserPlus, Pencil, Trash2, Check } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { normalizar, soloDigitos, formatTelefonoDisplay, formatFechaVisible } from '../lib/text'
import PatientDetailModal from './PatientDetailModal'
import EditPatientModal from './EditPatientModal'
import NewPatientModal from './NewPatientModal'

export default function Patients({ pacientes, notas, turnos, onViewNotes, onAddPaciente, onUpdatePaciente, onDeletePaciente }) {
  const [query, setQuery] = useState('')
  const [detalle, setDetalle] = useState(null)
  const [editando, setEditando] = useState(null)
  const [agregando, setAgregando] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)

  const filtrados = useMemo(() => {
    const q = query.trim()
    if (!q) return pacientes

    const qNombre = normalizar(q)
    const qTelefono = soloDigitos(q)

    return pacientes.filter((p) => {
      const coincideNombre = normalizar(p.nombre || '').includes(qNombre)
      const coincideTelefono = qTelefono.length > 0 && soloDigitos(p.telefono || '').includes(qTelefono)
      return coincideNombre || coincideTelefono
    })
  }, [pacientes, query])

  const notasPorPaciente = (nombre) => (notas || []).filter((n) => n.paciente === nombre).length

  return (
    <div className="management-screen management-clients">
      <div className="toolbar-row">
        <div className="search-bar toolbar-search">
          <Search size={16} style={{ color: 'var(--ink-faint)' }} />
          <input
            className="search-input"
            placeholder="Buscar por nombre o teléfono…"
            aria-label="Buscar clientes por nombre o teléfono"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="btn-icon-plain" onClick={() => setQuery('')} aria-label="Limpiar busqueda">
              <X size={15} />
            </button>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setAgregando(true)} title="Agregar cliente">
          <UserPlus size={14} />
          Agregar
        </button>
      </div>

      {pacientes.length === 0 ? (
        <div className="empty-state">
          <Users size={26} style={{ color: 'var(--border-strong)' }} />
          <p>Todavia no hay clientes registrados</p>
        </div>
      ) : filtrados.length === 0 ? (
        <div className="empty-state">
          <Search size={26} style={{ color: 'var(--border-strong)' }} />
          <p>Ningun cliente coincide con "{query}"</p>
        </div>
      ) : (
        <div className="table-scroll clients-desktop-table">
        <table className="table management-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Telefono</th>
              <th>Ultima visita</th>
              <th>Proximo turno</th>
              <th>Notas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const cantidad = notasPorPaciente(p.nombre)
              return (
                <tr key={p.id}>
                  <td>
                    <div
                      className="table-name-cell"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setDetalle(p)}
                      title="Ver ficha completa"
                    >
                      <div className="avatar" style={{ background: colorFor(p.nombre), width: 28, height: 28, fontSize: 11 }}>
                        {initials(p.nombre)}
                      </div>
                      {p.nombre}
                    </div>
                  </td>
                  <td data-label="Teléfono" className="management-phone">{formatTelefonoDisplay(p.telefono)}</td>
                  <td>{formatFechaVisible(p.ultima_visita)}</td>
                  <td>{formatFechaVisible(p.proximo_turno)}</td>
                  <td data-label="Notas">
                    <button
                      className="btn"
                      style={{ padding: '5px 10px', fontSize: 11.5 }}
                      onClick={() => onViewNotes(p.nombre)}
                    >
                      <StickyNote size={13} style={{ color: cantidad > 0 ? 'var(--accent)' : 'var(--ink-faint)' }} />
                      {cantidad > 0 ? cantidad : 'Ver'}
                    </button>
                  </td>
                  <td data-label="Acciones">
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn-icon-plain" onClick={() => setEditando(p)} aria-label="Editar cliente" title="Editar cliente">
                        <Pencil size={14} />
                      </button>
                      {confirmDeleteId === p.id ? (
                        <span className="confirm-delete">
                          <button
                            className="btn-icon-plain danger-solid"
                            onClick={() => { onDeletePaciente?.(p.id); setConfirmDeleteId(null) }}
                            aria-label="Confirmar eliminar cliente"
                          >
                            <Check size={13} strokeWidth={2.75} />
                          </button>
                          <button className="btn-icon-plain" onClick={() => setConfirmDeleteId(null)} aria-label="Cancelar">
                            <X size={13} strokeWidth={2.75} />
                          </button>
                        </span>
                      ) : (
                        <button
                          className="btn-icon-plain"
                          onClick={() => setConfirmDeleteId(p.id)}
                          aria-label="Eliminar cliente"
                          title="Eliminar cliente"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      {pacientes.length > 0 && filtrados.length > 0 && (
        <div className="clients-mobile-list" aria-label="Clientes">
          {filtrados.map((p) => {
            const cantidad = notasPorPaciente(p.nombre)
            return (
              <article className="client-mobile-card" key={p.id}>
                <div className="client-mobile-card-head">
                  <button type="button" className="client-mobile-identity" onClick={() => setDetalle(p)}>
                    <div className="avatar" style={{ background: colorFor(p.nombre), width: 40, height: 40, fontSize: 12 }}>
                      {initials(p.nombre)}
                    </div>
                    <span>
                      <strong>{p.nombre}</strong>
                      <small>Cliente</small>
                    </span>
                  </button>
                  <div className="client-mobile-actions">
                    <button className="btn-icon-plain" onClick={() => setEditando(p)} aria-label="Editar cliente" title="Editar cliente">
                      <Pencil size={16} />
                    </button>
                    {confirmDeleteId === p.id ? (
                      <span className="confirm-delete">
                        <button className="btn-icon-plain danger-solid" onClick={() => { onDeletePaciente?.(p.id); setConfirmDeleteId(null) }} aria-label="Confirmar eliminar cliente">
                          <Check size={15} strokeWidth={2.75} />
                        </button>
                        <button className="btn-icon-plain" onClick={() => setConfirmDeleteId(null)} aria-label="Cancelar">
                          <X size={15} strokeWidth={2.75} />
                        </button>
                      </span>
                    ) : (
                      <button className="btn-icon-plain" onClick={() => setConfirmDeleteId(p.id)} aria-label="Eliminar cliente" title="Eliminar cliente">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
                <a className="client-mobile-phone" href={p.telefono ? `tel:${soloDigitos(p.telefono)}` : undefined} onClick={(event) => { if (!p.telefono) event.preventDefault() }}>
                  {formatTelefonoDisplay(p.telefono) || 'Sin teléfono'}
                </a>
                <dl className="client-mobile-details">
                  <div><dt>Última visita</dt><dd>{formatFechaVisible(p.ultima_visita)}</dd></div>
                  <div><dt>Próximo turno</dt><dd>{formatFechaVisible(p.proximo_turno)}</dd></div>
                </dl>
                <div className="client-mobile-notes">
                  <span><StickyNote size={14} /> Notas</span>
                  <button className="btn" onClick={() => onViewNotes(p.nombre)}>
                    {cantidad > 0 ? `${cantidad} registrada${cantidad === 1 ? '' : 's'}` : 'Ver notas'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <PatientDetailModal
        paciente={detalle}
        turnos={turnos || []}
        notas={notas || []}
        onClose={() => setDetalle(null)}
      />

      <NewPatientModal
        open={agregando}
        onClose={() => setAgregando(false)}
        onSubmit={onAddPaciente}
      />

      <EditPatientModal
        paciente={editando}
        onClose={() => setEditando(null)}
        onSubmit={onUpdatePaciente}
      />
    </div>
  )
}
