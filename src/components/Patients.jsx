import { useMemo, useState } from 'react'
import { Users, Search, X, StickyNote, Download, Pencil, Trash2, Check } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { normalizar, soloDigitos } from '../lib/text'
import { exportarCSV } from '../lib/csv'
import PatientDetailModal from './PatientDetailModal'
import EditPatientModal from './EditPatientModal'

export default function Patients({ pacientes, notas, turnos, onViewNotes, onUpdatePaciente, onDeletePaciente }) {
  const [query, setQuery] = useState('')
  const [detalle, setDetalle] = useState(null)
  const [editando, setEditando] = useState(null)
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

  const exportar = () => {
    exportarCSV(
      'clientes.csv',
      filtrados,
      [
        { key: 'nombre', label: 'Cliente' },
        { key: 'telefono', label: 'Telefono' },
        { key: 'ultima_visita', label: 'Ultima visita' },
        { key: 'proximo_turno', label: 'Proximo turno' },
      ]
    )
  }

  return (
    <div>
      <div className="toolbar-row">
        <div className="search-bar toolbar-search">
          <Search size={16} style={{ color: 'var(--ink-faint)' }} />
          <input
            className="search-input"
            placeholder="Buscar por nombre o telefono..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="btn-icon-plain" onClick={() => setQuery('')} aria-label="Limpiar busqueda">
              <X size={15} />
            </button>
          )}
        </div>
        <button className="btn" onClick={exportar} title="Exportar a CSV">
          <Download size={14} />
          Exportar
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
        <div className="table-scroll">
        <table className="table">
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
                  <td>{p.telefono}</td>
                  <td>{p.ultima_visita || '—'}</td>
                  <td>{p.proximo_turno || '—'}</td>
                  <td>
                    <button
                      className="btn"
                      style={{ padding: '5px 10px', fontSize: 11.5 }}
                      onClick={() => onViewNotes(p.nombre)}
                    >
                      <StickyNote size={13} style={{ color: cantidad > 0 ? 'var(--accent)' : 'var(--ink-faint)' }} />
                      {cantidad > 0 ? cantidad : 'Ver'}
                    </button>
                  </td>
                  <td>
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

      <PatientDetailModal
        paciente={detalle}
        turnos={turnos || []}
        notas={notas || []}
        onClose={() => setDetalle(null)}
      />

      <EditPatientModal
        paciente={editando}
        onClose={() => setEditando(null)}
        onSubmit={onUpdatePaciente}
      />
    </div>
  )
}
