import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, MessageCircleOff, ChevronLeft, Search, Send, X, Bot, User } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { isNearBottom, shouldFollowNewMessages } from '../lib/chatScroll'
import { normalizar } from '../lib/text'
import SafeMarkdown, { stripMarkdown } from './SafeMarkdown'
import { EmptyState } from './ui'

export default function Messages({ conversaciones, full, selectedId, onSelectConversation, onSendMessage }) {
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [query, setQuery] = useState('')
  const threadRef = useRef(null)
  const messagesEndRef = useRef(null)
  const nearBottomRef = useRef(true)
  const previousMessageCountRef = useRef({ id: null, count: 0 })
  const pendingOwnMessageRef = useRef(false)
  const [showNewMessages, setShowNewMessages] = useState(false)

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
  const selectedConversationId = selected?.id || null
  const selectedMessageCount = selected?.mensajes?.length || 0

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const thread = threadRef.current
    if (!thread) return
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' })
    thread.scrollTop = thread.scrollHeight
  }, [])

  const updateBottomState = useCallback(() => {
    const thread = threadRef.current
    if (!thread) return
    const nearBottom = isNearBottom(thread)
    nearBottomRef.current = nearBottom
    if (nearBottom) setShowNewMessages(false)
  }, [])

  const enviar = async () => {
    if (!draft.trim() || sending || !selected) return
    setSending(true)
    pendingOwnMessageRef.current = true
    try {
      await onSendMessage?.(selected.paciente, draft.trim(), selected.clienteId)
      setDraft('')
      // El callback puede actualizar el hilo de forma asincrónica. El frame
      // siguiente es el primer momento en que el nuevo mensaje está medido.
      window.requestAnimationFrame(() => {
        scrollToBottom()
        nearBottomRef.current = true
        pendingOwnMessageRef.current = false
        setShowNewMessages(false)
      })
    } catch (error) {
      pendingOwnMessageRef.current = false
      throw error
    } finally {
      setSending(false)
    }
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  useLayoutEffect(() => {
    if (!full || !selectedConversationId) return undefined

    previousMessageCountRef.current = {
      id: selectedConversationId,
      count: selectedMessageCount,
    }
    nearBottomRef.current = true
    setShowNewMessages(false)

    const frame = window.requestAnimationFrame(() => scrollToBottom())
    return () => window.cancelAnimationFrame(frame)
  // Este efecto debe ejecutarse sólo al cambiar de conversación. El contador
  // se captura en ese render; los cambios posteriores los procesa el efecto
  // de mensajes nuevos para no perder la posición del lector.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, selectedConversationId, scrollToBottom])

  useLayoutEffect(() => {
    if (!full || !selectedConversationId) return undefined

    const count = selectedMessageCount
    const previous = previousMessageCountRef.current
    if (previous.id !== selectedConversationId) {
      previousMessageCountRef.current = { id: selectedConversationId, count }
      return undefined
    }

    if (count <= previous.count) {
      previousMessageCountRef.current = { id: selectedConversationId, count }
      return undefined
    }

    previousMessageCountRef.current = { id: selectedConversationId, count }
    const follow = shouldFollowNewMessages({
      wasAtBottom: nearBottomRef.current,
      ownMessage: pendingOwnMessageRef.current,
    })

    if (!follow) {
      pendingOwnMessageRef.current = false
      setShowNewMessages(true)
      return undefined
    }

    const frame = window.requestAnimationFrame(() => {
      scrollToBottom()
      nearBottomRef.current = true
      pendingOwnMessageRef.current = false
      setShowNewMessages(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [full, selectedConversationId, selectedMessageCount, scrollToBottom])

  useEffect(() => {
    if (!full) return undefined
    const thread = threadRef.current
    if (!thread) return undefined

    thread.addEventListener('scroll', updateBottomState, { passive: true })
    updateBottomState()

    const viewport = window.visualViewport
    const handleViewportResize = () => {
      if (!nearBottomRef.current) return
      window.requestAnimationFrame(() => scrollToBottom())
    }
    viewport?.addEventListener('resize', handleViewportResize)

    return () => {
      thread.removeEventListener('scroll', updateBottomState)
      viewport?.removeEventListener('resize', handleViewportResize)
    }
  }, [full, selectedConversationId, scrollToBottom, updateBottomState])

  const selectConversation = (id) => {
    onSelectConversation(id)
    setMobileThreadOpen(true)
  }

  const handleConversationKeyDown = (event, id, openThread = false) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelectConversation(id)
    if (openThread) setMobileThreadOpen(true)
  }

  if (!full) {
    // Modo compacto (resumen)
    if (conversaciones.length === 0) {
      return (
        <EmptyState icon={<MessageCircleOff size={26} style={{ color: 'var(--border-strong)' }} />} description="Sin conversaciones recientes" />
      )
    }
    return (
      <div className="conv-list">
        {conversaciones.slice(0, 4).map((c) => (
          <div
            key={c.id}
            className="conv-item"
            role="button"
            tabIndex={0}
            onClick={() => onSelectConversation(c.id)}
            onKeyDown={(event) => handleConversationKeyDown(event, c.id)}
          >
            <div className="avatar" style={{ background: colorFor(c.paciente), width: 28, height: 28, fontSize: 10 }}>
              {initials(c.paciente)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="conv-top">
                <p className="conv-name">{c.paciente}</p>
                <span className="conv-time">{c.ultimaHora}</span>
              </div>
              <p className="conv-preview">{stripMarkdown(c.mensajes[c.mensajes.length - 1]?.texto || 'Sin mensajes todavía')}</p>
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
      <div style={{ marginTop: 60 }}>
        <EmptyState icon={<MessageCircleOff size={32} style={{ color: 'var(--border-strong)' }} />} description="No hay conversaciones registradas" />
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
            <button className="btn-icon-plain" type="button" aria-label="Limpiar búsqueda" onClick={() => setQuery('')}>
              <X size={15} />
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={<Search size={22} style={{ color: 'var(--border-strong)' }} />} description="Sin resultados" />
        ) : (
          <div className="conv-list-scroll">
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`conv-item ${c.id === selected?.id ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => selectConversation(c.id)}
                onKeyDown={(event) => handleConversationKeyDown(event, c.id, true)}
              >
                <div className="avatar" style={{ background: colorFor(c.paciente) }}>{initials(c.paciente)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="conv-top">
                    <p className="conv-name">{c.paciente}</p>
                    <span className="conv-time">{c.ultimaHora}</span>
                  </div>
                  <p className="conv-preview">{stripMarkdown(c.mensajes[c.mensajes.length - 1]?.texto || 'Sin mensajes todavía')}</p>
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
              <div style={{ padding: '1rem' }}>
                <EmptyState icon={<MessageCircleOff size={22} style={{ color: 'var(--border-strong)' }} />} description="Sin mensajes en esta conversación" />
              </div>
            ) : (
              selected.mensajes.map((m, i) => (
                <div key={i} className={`bubble ${m.de === 'paciente' ? 'in' : m.de === 'clinica' ? 'out' : 'bot'}`}>
                  <div className="bubble-header">
                    {m.de === 'bot' && <Bot size={10} />}
                    {m.de === 'clinica' && <User size={10} />}
                  </div>
                  <SafeMarkdown value={m.texto} className="bubble-text" />
                  <div className="bubble-meta">
                    {m.de === 'bot' ? 'Bot · ' : m.de === 'clinica' ? 'Vos · ' : ''}
                    {m.hora}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} className="thread-end-sentinel" aria-hidden="true" />
          </div>

          {showNewMessages && (
            <button
              type="button"
              className="new-messages-button"
              onClick={() => {
                scrollToBottom('smooth')
                nearBottomRef.current = true
                setShowNewMessages(false)
              }}
            >
              Nuevos mensajes <ArrowDown size={14} aria-hidden="true" />
            </button>
          )}

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
