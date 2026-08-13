import { createHash } from 'node:crypto'

export const REPLY_ONLY_MODES = Object.freeze({
  SHADOW: 'shadow',
  REPLY_ONLY: 'reply_only',
  BOOKING_ENABLED: 'booking_enabled',
})

export const ALLOWED_REPLY_INTENTS = Object.freeze([
  'greeting',
  'services',
  'price',
  'hours',
  'professionals',
  'availability',
  'business_info',
  'faq',
  'booking_request',
  'handoff',
  'unsupported_media',
])

export const BLOCKED_MUTATIONS = Object.freeze([
  'create_booking',
  'update_booking',
  'cancel_booking',
  'delete_booking',
  'create_customer',
  'update_customer',
  'delete_customer',
  'billing',
  'mutable_rpc',
])

export const REPLY_ONLY_LIMITS = Object.freeze({
  maxReplyLength: 1000,
  rateLimitCount: 10,
  rateLimitWindowSeconds: 60,
})

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '') || null
const instanceValue = (value) => String(value ?? '').trim().toLowerCase() || null

export const normalizeReplyIdentity = ({ integrationId, instance, receiver }) => ({
  integrationId: String(integrationId ?? '').trim() || null,
  instance: instanceValue(instance),
  receiver: digitsOnly(receiver),
})

const isWildcard = (value) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  return !normalized || normalized === '*' || normalized === 'all' || normalized === 'any'
}

export const validatePilotAllowlist = (entries) => {
  if (!Array.isArray(entries) || entries.length !== 1) {
    throw new Error('Reply-only requiere exactamente una integración piloto allowlisted.')
  }
  const [entry] = entries
  const normalized = normalizeReplyIdentity(entry)
  if (isWildcard(normalized.integrationId) || isWildcard(normalized.instance) || isWildcard(normalized.receiver)) {
    throw new Error('La allowlist reply-only no admite wildcard ni identidades vacías.')
  }
  if (!entry.tenantId || String(entry.tenantId).trim() === '') {
    throw new Error('La allowlist reply-only requiere tenantId server-side.')
  }
  if (entry.mode !== REPLY_ONLY_MODES.REPLY_ONLY || entry.active !== true) {
    throw new Error('La integración piloto debe estar activa sólo en modo reply_only.')
  }
  return Object.freeze({ ...normalized, tenantId: String(entry.tenantId).trim(), mode: entry.mode, active: true })
}

export const resolveAllowlistedTenant = ({ payload = {}, allowlist }) => {
  const identity = normalizeReplyIdentity(payload)
  const match = allowlist && identity.integrationId && identity.instance && identity.receiver
    ? allowlist.integrationId === identity.integrationId
      && allowlist.instance === identity.instance
      && allowlist.receiver === identity.receiver
    : false
  if (!match) return null
  return { tenantId: allowlist.tenantId, integrationId: allowlist.integrationId, instance: allowlist.instance, receiver: allowlist.receiver }
}

export const resolveMode = ({ mode, pilotMode, killSwitch = 'disabled' }) => {
  const normalizedMode = String(mode ?? '').trim().toLowerCase()
  const normalizedPilotMode = String(pilotMode ?? '').trim().toLowerCase()
  const enabled = String(killSwitch ?? '').trim().toLowerCase() === 'enabled'
  return {
    mode: normalizedMode,
    pilotMode: normalizedPilotMode,
    enabled,
    allowed: enabled && normalizedMode === REPLY_ONLY_MODES.REPLY_ONLY && normalizedPilotMode === REPLY_ONLY_MODES.REPLY_ONLY,
    reason: !enabled ? 'kill_switch_disabled' : normalizedMode !== REPLY_ONLY_MODES.REPLY_ONLY || normalizedPilotMode !== REPLY_ONLY_MODES.REPLY_ONLY ? 'reply_only_mode_required' : null,
  }
}

export const isFromMe = (payload = {}) => Boolean(
  payload.fromMe
  || payload.from_me
  || payload.key?.fromMe
  || payload.data?.key?.fromMe
  || payload.data?.fromMe,
)

export const classifyIncomingMessage = (payload = {}) => {
  const type = String(payload.messageType ?? payload.message_type ?? payload.data?.messageType ?? '').trim().toLowerCase()
  const text = String(payload.text ?? payload.message ?? payload.data?.message?.conversation ?? payload.data?.message?.extendedTextMessage?.text ?? '').trim()
  if (type && type !== 'text' && type !== 'conversation' && type !== 'extendedtextmessage') {
    return { supported: false, kind: 'media', text: '', reply: 'Por ahora puedo ayudarte mejor si me escribís tu consulta.' }
  }
  if (!text) return { supported: false, kind: 'empty', text: '', reply: 'Por ahora puedo ayudarte mejor si me escribís tu consulta.' }
  return { supported: true, kind: 'text', text }
}

export const validateAiDecision = (decision) => {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) throw new Error('La respuesta de IA no es un objeto válido.')
  const intent = String(decision.intent ?? '').trim().toLowerCase()
  const confidence = Number(decision.confidence)
  if (!ALLOWED_REPLY_INTENTS.includes(intent)) throw new Error('La intención de IA no está permitida para reply-only.')
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('La confianza de IA es inválida.')
  if (!decision.arguments || typeof decision.arguments !== 'object' || Array.isArray(decision.arguments)) throw new Error('Los argumentos de IA son inválidos.')
  return Object.freeze({
    intent,
    confidence,
    arguments: decision.arguments,
    needsClarification: Boolean(decision.needs_clarification ?? decision.needsClarification),
  })
}

const secretLike = /(service_role|access_token|api[_-]?key|webhook[_-]?secret|bearer\s+[a-z0-9._-]+)/i
const stackLike = /(at\s+\S+\s+\(|stack trace|postgres|supabase error|internal server error)/i

export const sanitizeReply = (value, maxLength = REPLY_ONLY_LIMITS.maxReplyLength) => {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (!text || text.startsWith('{') || text.startsWith('[') || secretLike.test(text) || stackLike.test(text)) return null
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

export const buildBookingUrl = ({ baseUrl, slug }) => {
  const url = new URL(`/reservar/${encodeURIComponent(String(slug ?? '').trim())}`, baseUrl)
  if (url.protocol !== 'https:' || url.hostname !== 'barberia.cuchitron.lat' || !url.pathname.startsWith('/reservar/')) {
    throw new Error('La URL pública de reserva no pertenece al dominio permitido.')
  }
  return url.toString()
}

export const bookingRequestReply = ({ bookingUrl }) => `Puedo ayudarte a consultar horarios disponibles. Para confirmar el turno, completá la reserva desde ${bookingUrl}`

export const mutationFirewall = ({ mode, operation }) => {
  const normalizedMode = String(mode ?? '').trim().toLowerCase()
  const normalizedOperation = String(operation ?? '').trim().toLowerCase()
  const blocked = normalizedMode === REPLY_ONLY_MODES.REPLY_ONLY && BLOCKED_MUTATIONS.includes(normalizedOperation)
  return { allowed: false, mutationBlocked: blocked || normalizedMode !== REPLY_ONLY_MODES.REPLY_ONLY, reason: 'reply_only_mutations_disabled', operation: normalizedOperation }
}

export const sendTextGuard = ({ mode, allowlisted, authenticated, eventAcquired, fromMe, rateAllowed, reply }) => {
  const safeReply = sanitizeReply(reply)
  const allowed = mode === REPLY_ONLY_MODES.REPLY_ONLY
    && allowlisted === true
    && authenticated === true
    && eventAcquired === true
    && fromMe === false
    && rateAllowed === true
    && Boolean(safeReply)
  return { allowed, reply: safeReply, reason: allowed ? null : 'send_preconditions_failed' }
}

export const maskSender = (sender) => {
  const normalized = digitsOnly(sender)
  if (!normalized) return null
  const digest = createHash('sha256').update(normalized).digest('hex').slice(0, 12)
  return `sha256:${digest}`
}

export const observabilityEvent = ({ event, tenantId = null, integrationId = null, sender = null, correlationId = null, metadata = {} }) => ({
  event,
  tenant_id: tenantId,
  integration_id: integrationId,
  sender_hash: maskSender(sender),
  correlation_id: correlationId,
  metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => !/secret|token|password|payload|message|phone/i.test(key))),
  occurred_at: new Date().toISOString(),
})

export const rateLimitDecision = ({ count, nowMs, windowStartedAt, limit = REPLY_ONLY_LIMITS.rateLimitCount, windowSeconds = REPLY_ONLY_LIMITS.rateLimitWindowSeconds }) => {
  const windowMs = windowSeconds * 1000
  const freshWindow = !Number.isFinite(windowStartedAt) || nowMs - windowStartedAt >= windowMs
  const nextCount = freshWindow ? 1 : Number(count || 0) + 1
  return { allowed: nextCount <= limit, count: nextCount, windowStartedAt: freshWindow ? nowMs : windowStartedAt, retryAfterSeconds: nextCount <= limit ? 0 : Math.max(1, Math.ceil((windowMs - (nowMs - windowStartedAt)) / 1000)) }
}

export const replyOnlyFallback = ({ reason = 'temporary_failure', bookingUrl = null }) => {
  if (reason === 'handoff') return 'Voy a derivar tu consulta a una persona del equipo para que pueda ayudarte.'
  if (reason === 'unsupported_media') return 'Por ahora puedo ayudarte mejor si me escribís tu consulta.'
  if (reason === 'booking_request' && bookingUrl) return bookingRequestReply({ bookingUrl })
  return 'No pude consultar la información en este momento. Podés intentar nuevamente en unos minutos.'
}
