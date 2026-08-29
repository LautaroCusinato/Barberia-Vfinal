import {
  applyConfirmation,
  classifyConversationInput,
  CONVERSATION_REQUIRED_FIELDS,
  createConversationState,
  deriveMissingFields,
  isConversationStateFresh,
  mergeConversationTurn,
  nextConversationAction,
  parseExplicitConfirmation,
} from './whatsappConversationState.mjs'
import {
  classifyShadowIntent,
  CUSTOMER_FACING_PROMPT_VERSION,
  interpretRequestedDate,
  normalizeCustomerReply,
  parseRequestedTime,
  resolveRequestedServices,
} from './whatsappAgentShadow.mjs'

const textFrom = (value) => String(value ?? '').trim()

function dateLabel(value) {
  if (!value) return ''
  const date = new Date(`${value}T12:00:00Z`)
  if (!Number.isFinite(date.getTime())) return value
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })
}

function serviceName(services, serviceId) {
  const service = services.find((candidate) => Number(candidate?.id) === Number(serviceId))
  return textFrom(service?.nombre) || null
}

/**
 * Extracts only deterministic, tenant-scoped booking fields from one message.
 * The caller supplies the already tenant-scoped services and timezone.
 */
export function extractConversationTurn({ text, pendingIntent = null, services = [], timezone, now = new Date() } = {}) {
  const intent = classifyShadowIntent(text)
  const request = interpretRequestedDate(text, timezone, now)
  const parsedTime = parseRequestedTime(text)
  const serviceResolution = resolveRequestedServices(text, services)
  const fields = {}
  if (intent === 'booking_intent' || pendingIntent === 'booking_intent') fields.pending_intent = 'booking_intent'
  if (serviceResolution.status === 'matched') fields.service_id = serviceResolution.matches[0].id
  if (request.requested_date) fields.requested_date = request.requested_date
  if (parsedTime.requested_time) fields.requested_time = parsedTime.requested_time
  if (parsedTime.requested_daypart) fields.daypart = parsedTime.requested_daypart
  return { intent, fields, request: { ...request, requested_time: parsedTime.requested_time, requested_daypart: parsedTime.requested_daypart }, serviceResolution }
}

/**
 * Applies one inbound turn to the persisted deterministic state. No network,
 * LLM, Evolution or booking calls occur here.
 */
export function advanceConversationTurn({ state = null, scope, eventId, text, messageType = 'text', fromMe = false, isGroup = false, isBroadcast = false, services = [], timezone, now = new Date() } = {}) {
  const acceptedInput = classifyConversationInput({ messageType, text, fromMe, isGroup, isBroadcast })
  if (!acceptedInput.accepted) return { accepted: false, reason: acceptedInput.reason, state }

  const pendingIntent = state?.pending_intent || null
  const extracted = extractConversationTurn({ text, pendingIntent, services, timezone, now })
  const incomingConfirmation = state?.confirmation_state === 'awaiting_confirmation' && parseExplicitConfirmation(text)
  if (incomingConfirmation) {
    const confirmation = applyConfirmation({ state, expectedScope: scope, text, eventId, now, proposalId: state.proposal_id, proposalVersion: state.confirmation_version })
    if (!confirmation.accepted) return { accepted: false, reason: confirmation.reason, duplicate: confirmation.duplicate, state: confirmation.state, intent: 'booking_intent', extracted }
    const action = nextConversationAction(confirmation.state, { expectedScope: scope, now })
    return { accepted: true, duplicate: false, reason: null, state: confirmation.state, action, intent: 'booking_intent', extracted, confirmed: true }
  }

  let current = state
  if (current && !isConversationStateFresh(current, now) && extracted.intent === 'booking_intent') current = null
  if (!current) current = { ...createConversationState({ ...scope, now }), timezone: timezone || null }
  const merged = mergeConversationTurn({ state: current, expectedScope: scope, eventId, extracted: extracted.fields, now })
  if (!merged.accepted) return { accepted: false, reason: merged.reason, duplicate: merged.duplicate, state: merged.state, intent: extracted.intent, extracted }
  const action = nextConversationAction(merged.state, { expectedScope: scope, now })
  return { accepted: true, duplicate: false, reason: null, state: merged.state, action, intent: merged.state.pending_intent || extracted.intent, extracted, confirmed: false }
}

export function buildConversationProposal({ state, action, availability = null, services = [], businessName = 'la barbería' } = {}) {
  const safeBusinessName = textFrom(businessName) || 'la barbería'
  const service = serviceName(services, state?.service_id)
  const date = dateLabel(state?.requested_date)
  const time = textFrom(state?.requested_time)
  let proposedReply
  let requestedAction

  switch (action?.action) {
    case 'ask_service':
      proposedReply = '¿Qué servicio querés reservar?'
      requestedAction = 'booking_collect_service'
      break
    case 'ask_date':
      proposedReply = `¿Qué día te gustaría reservar${service ? ` para ${service}` : ''}?`
      requestedAction = 'booking_collect_date'
      break
    case 'ask_time':
      proposedReply = `¿A qué hora te gustaría reservar${service ? ` para ${service}` : ''} el ${date || 'ese día'}?`
      requestedAction = 'booking_collect_time'
      break
    case 'offer_alternatives': {
      const slots = Array.isArray(availability?.slots) ? availability.slots.slice(0, 6) : []
      const alternatives = slots.map((slot) => textFrom(slot?.hora).slice(0, 5)).filter(Boolean).join(', ')
      proposedReply = alternatives
        ? `Ese horario no está disponible. Puedo ofrecerte: ${alternatives}. ¿Cuál te sirve?`
        : `No encontré disponibilidad para ${date || 'ese día'}. ¿Querés que busque otro día?`
      requestedAction = 'booking_offer_alternatives'
      break
    }
    case 'request_confirmation':
      proposedReply = `Tengo disponible ${service || 'el servicio'} el ${date || 'día solicitado'} a las ${time || 'la hora solicitada'}. ¿Confirmás?`
      requestedAction = 'booking_request_confirmation'
      break
    case 'ready_for_booking_mutation':
      proposedReply = 'Perfecto, tengo los datos confirmados.'
      requestedAction = 'booking_confirmed_ready'
      break
    case 'restart_conversation':
      proposedReply = `Retomemos desde el principio. ¿Qué servicio te gustaría reservar en ${safeBusinessName}?`
      requestedAction = 'booking_restart'
      break
    case 'check_availability':
      proposedReply = 'Estoy revisando horarios para vos.'
      requestedAction = 'booking_check_availability'
      break
    default:
      proposedReply = 'Puedo ayudarte a preparar una reserva. ¿Qué servicio te gustaría reservar?'
      requestedAction = 'booking_collect_service'
  }

  const tools = ['tenant_context_read', 'services_read']
  if (availability?.rpc_executed === true) tools.push('availability_rpc_read')
  return {
    intent: 'booking_intent',
    proposed_reply: normalizeCustomerReply(proposedReply, '¿En qué te puedo ayudar?'),
    confidence: 0.95,
    requested_action: requestedAction,
    tools_considered: tools,
    context_counts: {
      conversation_required_fields: CONVERSATION_REQUIRED_FIELDS,
      missing_fields: deriveMissingFields(state),
      requested_date: state?.requested_date || null,
      requested_time: state?.requested_time || null,
      requested_daypart: state?.daypart || null,
      requested_slot_available: state?.requested_slot_available ?? null,
      availability: Array.isArray(availability?.slots) ? availability.slots.length : 0,
    },
    provider: 'qa_deterministic_conversation',
    model: 'conversation-state-v1',
    agent_prompt_version: CUSTOMER_FACING_PROMPT_VERSION,
    mutation_allowed: false,
    outbound_allowed: false,
  }
}

export function isConversationStateUsable(state, now = new Date()) {
  return Boolean(state && isConversationStateFresh(state, now))
}
