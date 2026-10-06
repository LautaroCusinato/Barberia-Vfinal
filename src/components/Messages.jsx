import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, MessageCircleOff, ChevronLeft, Search, Send, X, Bot, User } from 'lucide-react'
import { initials, colorFor } from '../lib/avatar'
import { isNearBottom, shouldFollowNewMessages } from '../lib/chatScroll'
import { formatTelefonoDisplay, normalizar } from '../lib/text'
import SafeMarkdown, { stripMarkdown } from './SafeMarkdown'
import { EmptyState } from './ui'

const ESTADOS_CON_AVISO = new Set(['verificando', 'bloqueado', 'demo'])
// Estado de envío de los mensajes del equipo (lo registra whatsapp-panel-send).
const ETIQUETA_ENVIO = { pendiente: 'Enviando…', incierto: 'Sin confirmar', fallido: 'No enviado' }

export default function Messages({ conversaciones, full, selectedId, onSelectConversation, onSendMessage, pacientes = [], focusRequest = null, onFocusRequestHandled, estadoChatPorCliente = {} }) {
  const [mobileThreadOpen, setMobileThreadOpen] = useState(false)
  // Borrador y resultado del último envío por conversación: cambiar de hilo (o
  // abrir uno desde Clientes) nunca lleva el texto escrito para otro cliente.
  const [drafts, setDrafts] = useState({})
  const [sendErrors, setSendErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [query, setQuery] = useState('')
  const composerRef = useRef(null)
  const handledFocusRef = useRef(null)
  const threadRef = useRef(null)
  const threadPanelRef = useRef(null)
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
  // El encabezado muestra el número real (antes repetía "WhatsApp" junto al badge).
  const telefonoSeleccionado = selected?.clienteId != null ? pacientes.find((p) => p.id === selected.clienteId)?.telefono : null
  const selectedMessageCount = selected?.mensajes?.length || 0
  const draft = drafts[selectedConversationId] ?? ''
  const sendError = sendErrors[selectedConversationId] ?? null
  const setDraft = (value) => setDrafts((prev) => ({ ...prev, [selectedConversationId]: value }))
  const estadoChat = selected?.clienteId != null ? estadoChatPorCliente[selected.clienteId] : null

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

  // `confirmarReenvio` sólo se usa cuando el servidor avisó que el mismo texto
  // se envió o quedó sin confirmar hace instantes y el operador decide reenviar.
  const enviar = async ({ confirmarReenvio = false } = {}) => {
    if (!draft.trim() || sending || !selected) return
    // El destinatario se fija al tocar Enviar: si el operador cambia de hilo
    // mientras se envía, el resultado se aplica a esta conversación.
    const convId = selected.id
    const setErrorDe = (texto, extra = {}) => setSendErrors((prev) => ({ ...prev, [convId]: texto ? { tipo: 'error', texto, ...extra } : null }))
    setSending(true)
    setErrorDe('')
    pendingOwnMessageRef.current = true
    try {
      const args = [selected.paciente, draft.trim(), selected.clienteId]
      if (confirmarReenvio) args.push({ confirmarReenvio: true })
      const sent = await onSendMessage?.(...args)
      if (sent === false || sent?.ok === false) {
        pendingOwnMessageRef.current = false
        setErrorDe(sent?.message || 'No se pudo guardar el mensaje. El borrador quedó preservado.', { confirmable: sent?.confirmable === true })
        return
      }
      setDrafts((prev) => ({ ...prev, [convId]: '' }))
      // Enviado sin confirmación de WhatsApp: el mensaje queda en el hilo
      // marcado "Sin confirmar" y se explica qué hacer antes de reenviar.
      if (sent?.aviso) setSendErrors((prev) => ({ ...prev, [convId]: { tipo: 'aviso', texto: sent.aviso } }))
      // El callback puede actualizar el hilo de forma asincrónica. El frame
      // siguiente es el primer momento en que el nuevo mensaje está medido.
      window.requestAnimationFrame(() => {
        scrollToBottom()
        nearBottomRef.current = true
        pendingOwnMessageRef.current = false
        setShowNewMessages(false)
      })
    } catch {
      pendingOwnMessageRef.current = false
      setErrorDe('No se pudo guardar el mensaje. Revisá tu conexión e intentá de nuevo.')
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

  // "Iniciar chat" desde Clientes: abre el hilo pedido y pone el foco en el
  // compositor una sola vez por pedido (no al volver a seleccionarlo).
  useEffect(() => {
    if (!full || !focusRequest || handledFocusRef.current === focusRequest.n) return undefined
    if (focusRequest.id !== selectedConversationId) return undefined
    setMobileThreadOpen(true)
    // Se marca atendido recién al enfocar: si un re-render cancela el frame,
    // el efecto lo vuelve a intentar.
    const frame = window.requestAnimationFrame(() => {
      handledFocusRef.current = focusRequest.n
      composerRef.current?.focus({ preventScroll: true })
      onFocusRequestHandled?.()
      if (window.matchMedia?.('(max-width: 900px)').matches) threadPanelRef.current?.scrollIntoView({ block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [full, focusRequest, selectedConversationId, onFocusRequestHandled])

  // En el celular el hilo reemplaza a la lista: lo llevamos al tope de la
  // pantalla para que el campo de respuesta quede visible sobre la barra inferior.
  const abrirHiloMobile = () => {
    setMobileThreadOpen(true)
    if (window.matchMedia?.('(max-width: 900px)').matches) {
      window.requestAnimationFrame(() => threadPanelRef.current?.scrollIntoView({ block: 'start' }))
    }
  }

  const selectConversation = (id) => {
    onSelectConversation(id)
    abrirHiloMobile()
  }

  const handleConversationKeyDown = (event, id, openThread = false) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelectConversation(id)
    if (openThread) abrirHiloMobile()
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
        <EmptyState icon={<MessageCircleOff size={32} aria-hidden="true" style={{ color: 'var(--border-strong)' }} />} title="Todavía no hay conversaciones" description="Cuando tus clientes escriban por WhatsApp, sus conversaciones van a aparecer acá." />
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
            aria-label="Buscar conversaciones"
            placeholder="Buscar cliente o mensaje…"
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
        <div ref={threadPanelRef} className={`panel thread-panel ${!mobileThreadOpen ? 'mobile-hide' : ''}`}>
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
                <p className="thread-header-phone">{telefonoSeleccionado ? formatTelefonoDisplay(telefonoSeleccionado) : 'Sin teléfono en la ficha'}</p>
              </div>
            </div>
            <span className="badge badge-muted">WhatsApp</span>
          </div>

          <div className="thread" ref={threadRef}>
            {selected.mensajes.length === 0 ? (
              <div style={{ padding: '1rem' }}>
                <EmptyState icon={<MessageCircleOff size={22} style={{ color: 'var(--border-strong)' }} />} description="Todavía no hay mensajes con este cliente. Nada se envía hasta que toques Enviar." />
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
                    {m.de === 'clinica' && ETIQUETA_ENVIO[m.estado_envio] ? ` · ${ETIQUETA_ENVIO[m.estado_envio]}` : ''}
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

          {onSendMessage && ESTADOS_CON_AVISO.has(estadoChat?.estado) && (
            <p className={estadoChat.estado === 'bloqueado' ? 'login-error thread-composer-notice' : 'thread-composer-notice'} role="status">
              {estadoChat.estado === 'verificando' ? 'Verificando si se puede escribir a este cliente por WhatsApp…' : estadoChat.mensaje}
            </p>
          )}
          {onSendMessage && (
            <div className="thread-composer" aria-busy={sending}>
              <textarea
                ref={composerRef}
                className="note-input"
                aria-label={`Mensaje para ${selected.paciente}`}
                style={{ marginBottom: 0, minHeight: 40, maxHeight: 90 }}
                placeholder={`Escribir a ${selected.paciente}...`}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                disabled={sending}
              />
              <button
                className="btn btn-primary"
                onClick={() => enviar()}
                disabled={!draft.trim() || sending}
                aria-label="Enviar"
                title="Enviar (desactiva el bot)"
              >
                <Send size={14} strokeWidth={2.5} />
              </button>
            </div>
          )}
          {sendError?.tipo === 'error' && (
            <div className="login-error" role="alert">
              <span>{sendError.texto}</span>
              {sendError.confirmable && (
                <button type="button" className="btn" onClick={() => enviar({ confirmarReenvio: true })} disabled={sending || !draft.trim()}>
                  Enviar de todos modos
                </button>
              )}
            </div>
          )}
          {sendError?.tipo === 'aviso' && <p className="thread-composer-notice" role="status">{sendError.texto}</p>}
        </div>
      )}
    </div>
  )
}
