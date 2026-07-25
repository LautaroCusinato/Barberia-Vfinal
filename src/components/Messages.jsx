import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircleOff, ChevronLeft, Search, Send, X, Phone, Bot, User } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { normalizar } from '../lib/text'

export default function Messages({ conversaciones, full, selectedId, onSelectConversation, onSendMessage }) {
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [query, setQuery] = useState('')
  const threadRef = useRef(null)

  const filtered = useMemo(() => {
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
    await onSendMessage?.(selected.paciente, draft.trim(), selected.clienteId)
    setDraft('')
    setSending(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [selected?.id, selected?.mensajes?.length])

  const selectConversation = (id) => {
    onSelectConversation(id)
    setMobileThreadOpen(true)
  }

  if (!full) {
    // Modo compacto (resumen)
    if (conversaciones.length === 0) {
      return (
        <div className="empty-state">
          <MessageCircleOff size={26} style={{ color: 'var(--border-strong)' }} />
          <p>Sin conversaciones recientes</p>
        </div>
      )
    }
    return (
      <div className="conv-list">
        {conversaciones.slice(0, 4).map((c) => (
          <div key={c.id} className="conv-item" onClick={() => onSelectConversation(c.id)}>
            <div className="avatar" style={{ background: colorFor(c.paciente), width: 28, height: 28, fontSize: 10 }}>
              {initials(c.paciente)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="conv-top">
                <p className="conv-name">{c.paciente}</p>
                <span className="conv-time">{c.ultimaHora}</span>
              </div>
              <p className="conv-preview">{c.mensajes[c.mensajes.length - 1]?.texto || 'Sin mensajes todavía'}</p>
            </div>
            {c.noLeido && <div className="unread-dot" />}
          </div>
        ))}
      </div>
    )
  }

  // Vista completa
  if (conversaciones.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 60 }}>
        <MessageCircleOff size={32} style={{ color: 'var(--border-strong)' }} />
        <p>No hay conversaciones registradas</p>
      </div>
    )
  }

  return (
    <div className="messages-grid-full">
      {/* Lista de conversaciones */}
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
            <button className="btn-icon-plain" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <Search size={22} style={{ color: 'var(--border-strong)' }} />
            <p>Sin resultados</p>
          </div>
        ) : (
          <div className="conv-list-scroll">
            {filtered.map((c) => (
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
                  <p className="conv-preview">{c.mensajes[c.mensajes.length - 1]?.texto || 'Sin mensajes todavía'}</p>
                </div>
                {c.noLeido && <div className="unread-dot" />}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Hilo de conversación */}
      {selected && (
        <div className={`panel thread-panel ${!mobileThreadOpen ? 'mobile-hide' : ''}`}>
          <button className="mobile-back-btn" onClick={() => setMobileThreadOpen(false)}>
            <ChevronLeft size={15} />
            Conversaciones
          </button>

          <div className="thread-header">
            <div className="thread-header-info">
              <div className="avatar" style={{ background: colorFor(selected.paciente) }}>
                {initials(selected.paciente)}
              </div>
              <div>
                <p className="thread-header-name">{selected.paciente}</p>
                <p className="thread-header-phone">WhatsApp</p>
              </div>
            </div>
            <span className="badge badge-muted">WhatsApp</span>
          </div>

          <div className="thread" ref={threadRef}>
            {selected.mensajes.length === 0 ? (
              <div className="empty-state" style={{ padding: '1rem' }}>
                <MessageCircleOff size={22} style={{ color: 'var(--border-strong)' }} />
                <p>Sin mensajes en esta conversación</p>
              </div>
            ) : (
              selected.mensajes.map((m, i) => (
                <div key={i} className={`bubble ${m.de === 'paciente' ? 'in' : m.de === 'clinica' ? 'out' : 'bot'}`}>
                  <div className="bubble-header">
                    {m.de === 'bot' && <Bot size={10} />}
                    {m.de === 'clinica' && <User size={10} />}
                  </div>
                  <p className="bubble-text">{m.texto}</p>
                  <div className="bubble-meta">
                    {m.de === 'bot' ? 'Bot · ' : m.de === 'clinica' ? 'Vos · ' : ''}
                    {m.hora}
                  </div>
                </div>
              ))
            )}
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
                aria-label="Enviar"
                title="Enviar (desactiva el bot)"
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
