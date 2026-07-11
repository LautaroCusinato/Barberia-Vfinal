import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircleOff, ChevronLeft, Search, Send, X } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { normalizar } from '../lib/text'

export default function Messages({ conversaciones, full, selectedId, onSelectConversation, onSendMessage }) {
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [query, setQuery] = useState('')
  const threadRef = useRef(null)

  // Busca tanto en el nombre del cliente como en el texto de los
  // mensajes, asi el dueño puede encontrar una conversacion aunque no
  // se acuerde bien el nombre pero si algo puntual que se dijo.
  const conversacionesFiltradas = useMemo(() => {
    const q = normalizar(query.trim())
    if (!q) return conversaciones
    return conversaciones.filter((c) => {
      const coincideNombre = normalizar(c.paciente || '').includes(q)
      const coincideMensaje = (c.mensajes || []).some((m) => normalizar(m.texto || '').includes(q))
      return coincideNombre || coincideMensaje
    })
  }, [conversaciones, query])

  const selected = conversaciones.find((c) => c.id === selectedId) || conversaciones[0]

  const enviar = async () => {
    if (!draft.trim() || sending || !selected) return
    setSending(true)
    await onSendMessage?.(selected.paciente, draft.trim())
    setDraft('')
    setSending(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  // Siempre arranca mostrando el último mensaje (como cualquier chat),
  // no el primero de la conversación.
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [selected?.id, selected?.mensajes?.length])

  if (conversaciones.length === 0) {
    return (
      <div className="empty-state">
        <MessageCircleOff size={26} style={{ color: 'var(--border-strong)' }} />
        <p>Todavia no hay conversaciones registradas</p>
      </div>
    )
  }

  const selectConversation = (id) => {
    onSelectConversation(id)
    setMobileThreadOpen(true)
  }

  if (!full) {
    return (
      <div className="conv-list">
        {conversaciones.map((c) => (
          <div key={c.id} className="conv-item" onClick={() => onSelectConversation(c.id)}>
            <div className="avatar" style={{ background: colorFor(c.paciente) }}>{initials(c.paciente)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="conv-top">
                <p className="conv-name">{c.paciente}</p>
                <span className="conv-time">{c.ultimaHora}</span>
              </div>
              <p className="conv-preview">{c.mensajes[c.mensajes.length - 1]?.texto}</p>
            </div>
            {c.noLeido && <div className="unread-dot" />}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="messages-grid-full">
      <div className={`panel conv-panel ${mobileThreadOpen ? 'mobile-hide' : ''}`} style={{ padding: '0.6rem' }}>
        <div className="search-bar conv-search">
          <Search size={16} style={{ color: 'var(--ink-faint)' }} />
          <input
            className="search-input"
            placeholder="Buscar cliente o mensaje..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="btn-icon-plain" onClick={() => setQuery('')} aria-label="Limpiar busqueda">
              <X size={15} />
            </button>
          )}
        </div>

        {conversacionesFiltradas.length === 0 ? (
          <div className="empty-state">
            <Search size={22} style={{ color: 'var(--border-strong)' }} />
            <p>Sin resultados para "{query}"</p>
          </div>
        ) : (
          <div className="conv-list">
            {conversacionesFiltradas.map((c) => (
              <div
                key={c.id}
                className={`conv-item ${c.id === selected?.id ? 'selected' : ''}`}
                onClick={() => selectConversation(c.id)}
              >
                <div className="avatar" style={{ background: colorFor(c.paciente) }}>{initials(c.paciente)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="conv-top">
                    <p className="conv-name">{c.paciente}</p>
                    <span className="conv-time">{c.ultimaHora}</span>
                  </div>
                  <p className="conv-preview">{c.mensajes[c.mensajes.length - 1]?.texto}</p>
                </div>
                {c.noLeido && <div className="unread-dot" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <div className={`panel thread-panel ${!mobileThreadOpen ? 'mobile-hide' : ''}`}>
          <button className="mobile-back-btn" onClick={() => setMobileThreadOpen(false)}>
            <ChevronLeft size={15} />
            Conversaciones
          </button>
          <div className="thread-header">
            <div className="thread-header-info">
              <div className="avatar" style={{ background: colorFor(selected.paciente) }}>{initials(selected.paciente)}</div>
              <div>
                <p className="thread-header-name">{selected.paciente}</p>
                <p className="thread-header-phone">Conversación de WhatsApp</p>
              </div>
            </div>
            <span className="badge badge-muted">WhatsApp</span>
          </div>
          <div className="thread" ref={threadRef}>
            {selected.mensajes.map((m, i) => (
              <div key={i} className={`bubble ${m.de === 'paciente' ? 'in' : m.de === 'clinica' ? 'out' : 'bot'}`}>
                {m.texto}
                <div className="bubble-meta">{m.de === 'bot' ? 'Bot · ' : m.de === 'clinica' ? 'Vos · ' : ''}{m.hora}</div>
              </div>
            ))}
          </div>

          {onSendMessage && (
            <div className="thread-composer">
              <textarea
                className="note-input"
                style={{ marginBottom: 0, minHeight: 40, maxHeight: 90 }}
                placeholder={`Escribir a ${selected.paciente}...`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
              />
              <button
                className="btn btn-primary"
                onClick={enviar}
                disabled={!draft.trim() || sending}
                aria-label="Enviar mensaje"
                title="Enviar (apaga el bot automáticamente)"
              >
                <Send size={14} strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
