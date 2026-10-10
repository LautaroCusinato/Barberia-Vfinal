import { useMemo, useState } from 'react'
import { Users, Search, X, StickyNote, UserPlus, Pencil, Trash2, Check, MessageCircle } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { normalizar, soloDigitos, formatTelefonoDisplay, formatFechaVisible } from '../lib/text'
import ClientDetailModal from './ClientDetailModal'
import EditClientModal from './EditClientModal'
import NewClientModal from './NewClientModal'
import { EmptyState } from './ui'
import { notaDelCliente } from '../lib/clientNotes'
import { resumenVisitasCliente } from '../lib/clienteVisitas'

export default function Clientes({ pacientes, notas, turnos, todayKey, onViewNotes, onAddPaciente, onUpdatePaciente, onDeletePaciente, onStartChat, clientesConMensajes }) {
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

  const notasPorPaciente = (cliente) => (notas || []).filter((n) => notaDelCliente(n, cliente)).length

  const visitas = useMemo(() => new Map(pacientes.map((p) => [p.id, resumenVisitasCliente(p, turnos, todayKey)])), [pacientes, turnos, todayKey])

  // Tocar el teléfono abre el chat de esa persona en Mensajes.
  const telefono = (p, className) => {
    const texto = formatTelefonoDisplay(p.telefono) || 'Sin teléfono'
    if (!onStartChat || !p.telefono) return <span className={className}>{texto}</span>
    return (
      <button type="button" className={`${className} client-phone-chat`} onClick={() => onStartChat(p.id)} title="Abrir chat en Mensajes" aria-label={`Abrir chat con ${p.nombre} (${texto})`}>
        <MessageCircle size={13} aria-hidden="true" />
        {texto}
      </button>
    )
  }

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
            <button className="btn-icon-plain" onClick={() => setQuery('')} aria-label="Limpiar búsqueda">
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
        <EmptyState
          className="empty-state"
          icon={<Users size={26} aria-hidden="true" style={{ color: 'var(--border-strong)' }} />}
          title="Todavía no hay clientes registrados"
          action={<button type="button" className="btn btn-primary" onClick={() => setAgregando(true)}><UserPlus size={14} /> Agregar cliente</button>}
        />
      ) : filtrados.length === 0 ? (
        <EmptyState className="empty-state" icon={<Search size={26} style={{ color: 'var(--border-strong)' }} />} description={`Ningún cliente coincide con "${query}"`} />
      ) : (
        <div className="table-scroll clients-desktop-table">
        <table className="table management-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Teléfono</th>
              <th>Última visita</th>
              <th>Próximo turno</th>
              <th>Notas</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => {
              const cantidad = notasPorPaciente(p)
              return (
                <tr key={p.id}>
                  <td>
                    <button
                      type="button"
                      className="table-name-cell client-name-button"
                      onClick={() => setDetalle(p)}
                      title="Ver ficha completa"
                    >
                      <div className="avatar" style={{ background: colorFor(p.nombre), width: 28, height: 28, fontSize: 11 }}>
                        {initials(p.nombre)}
                      </div>
                      {p.nombre}
                    </button>
                  </td>
                  <td data-label="Teléfono" className="management-phone">{telefono(p, 'client-phone')}</td>
                  <td>{formatFechaVisible(visitas.get(p.id)?.ultimaVisita)}</td>
                  <td>{formatFechaVisible(visitas.get(p.id)?.proximoTurno)}</td>
                  <td data-label="Notas">
                    <button
                      className="btn"
                      style={{ padding: '5px 10px', fontSize: 11.5 }}
                      onClick={() => onViewNotes(p.id)}
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
            const cantidad = notasPorPaciente(p)
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
                {telefono(p, 'client-mobile-phone')}
                <dl className="client-mobile-details">
                  <div><dt>Última visita</dt><dd>{formatFechaVisible(visitas.get(p.id)?.ultimaVisita)}</dd></div>
                  <div><dt>Próximo turno</dt><dd>{formatFechaVisible(visitas.get(p.id)?.proximoTurno)}</dd></div>
                </dl>
                <div className="client-mobile-notes">
                  <span><StickyNote size={14} /> Notas</span>
                  <button className="btn" onClick={() => onViewNotes(p.id)}>
                    {cantidad > 0 ? `${cantidad} registrada${cantidad === 1 ? '' : 's'}` : 'Ver notas'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      <ClientDetailModal
        paciente={detalle}
        turnos={turnos || []}
        notas={notas || []}
        onClose={() => setDetalle(null)}
        tieneMensajes={detalle ? Boolean(clientesConMensajes?.has(detalle.id)) : false}
        onStartChat={onStartChat ? (clienteId) => { setDetalle(null); onStartChat(clienteId) } : undefined}
      />

      <NewClientModal
        open={agregando}
        onClose={() => setAgregando(false)}
        onSubmit={onAddPaciente}
      />

      <EditClientModal
        paciente={editando}
        onClose={() => setEditando(null)}
        onSubmit={onUpdatePaciente}
      />
    </div>
  )
}
