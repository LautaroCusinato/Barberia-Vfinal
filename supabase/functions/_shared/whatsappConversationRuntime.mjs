import {
  applyConfirmation,
  classifyConversationInput,
  CONVERSATION_REQUIRED_FIELDS,
  createConversationState,
  deriveMissingFields,
  isConversationStateForScope,
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
  resolveRequestedBarbers,
  resolveRequestedServices,
} from './whatsappAgentShadow.mjs'
import { extractCustomerName } from './whatsappCustomer.mjs'

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
export function extractConversationTurn({ text, pendingIntent = null, services = [], barbers = [], timezone, now = new Date() } = {}) {
  const intent = classifyShadowIntent(text)
  const parsedTime = parseRequestedTime(text)
  const normalized = textFrom(text).toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\bqiero\b/g, 'quiero').replace(/\bcortarme\b/g, 'corte')
  const colloquialHour = normalized.match(/\btipo\s+([1-6])\b/)
  const safeColloquialAfternoon = colloquialHour
    && (intent === 'booking_intent' || pendingIntent === 'booking_intent')
    && /\b(corte|barba|servicio|turno|reserv)/.test(normalized)
    && String(timezone || 'America/Argentina/Buenos_Aires').toLowerCase() === 'america/argentina/buenos_aires'
  const effectiveTime = safeColloquialAfternoon
    ? { requested_time: `${String(Number(colloquialHour[1]) + 12).padStart(2, '0')}:00`, requested_daypart: 'afternoon', time_ambiguous: false, time_candidate: null }
    : parsedTime
  const parsedDate = interpretRequestedDate(text, timezone, now)
  const request = safeColloquialAfternoon
    ? { ...parsedDate, requested_time: effectiveTime.requested_time, requested_daypart: effectiveTime.requested_daypart, time_period: effectiveTime.requested_daypart, time_ambiguous: false, time_candidate: null }
    : parsedDate
  const serviceResolution = resolveRequestedServices(text, services)
  const barberResolution = resolveRequestedBarbers(text, barbers)
  const fields = {}
  fields.last_intent = intent
  if (intent === 'booking_intent' || pendingIntent === 'booking_intent') fields.pending_intent = 'booking_intent'
  if (serviceResolution.status === 'matched') fields.service_id = serviceResolution.matches[0].id
  if (barberResolution.status === 'matched') {
    fields.barber_id = barberResolution.matches[0].id
    fields.barber_selection_pending = false
  } else if (/\b(con|barbero|barbera)\b/.test(normalized) && /\b(otro|alguien|cualquiera)\b/.test(normalized)) {
    fields.barber_id = null
    fields.barber_selection_pending = true
  }
  if (request.requested_date) fields.requested_date = request.requested_date
  if (effectiveTime.requested_time) fields.requested_time = effectiveTime.requested_time
  if (effectiveTime.requested_daypart) fields.daypart = effectiveTime.requested_daypart
  return { intent, fields, request, serviceResolution, barberResolution }
}

// Campos que sobreviven al vencimiento de la conversación: recuerdan si ya se
// ofreció el enlace y qué camino eligió el cliente, para no repetir el saludo.
const CHANNEL_FIELDS = Object.freeze(['channel_offer_at', 'channel_offer_event_id', 'channel_choice'])
const BOOKING_DETAIL_FIELDS = Object.freeze(['service_id', 'requested_date', 'requested_time', 'daypart', 'barber_id'])

function channelFieldsFrom(state) {
  const output = {}
  for (const field of CHANNEL_FIELDS) if (state && state[field] !== undefined) output[field] = state[field]
  return output
}

function hasBookingDetail(fields = {}) {
  return BOOKING_DETAIL_FIELDS.some((field) => fields[field] !== null && fields[field] !== undefined && fields[field] !== '')
}

/**
 * Applies one inbound turn to the persisted deterministic state. No network,
 * LLM, Evolution or booking calls occur here.
 *
 * `customerNameRequired` lo decide el servidor (el teléfono verificado no
 * tiene ficha en el negocio): antes de consultar disponibilidad se pide el
 * nombre. `forceBookingIntent` se usa cuando el cliente eligió reservar por
 * este chat después del saludo con las dos opciones.
 */
export function advanceConversationTurn({ state = null, scope, eventId, text, messageType = 'text', fromMe = false, isGroup = false, isBroadcast = false, services = [], barbers = [], timezone, customerNameRequired = false, forceBookingIntent = false, personalizedBooking = false, interpretedFields = {}, suppressNameCapture = false, now = new Date() } = {}) {
  const acceptedInput = classifyConversationInput({ messageType, text, fromMe, isGroup, isBroadcast })
  if (!acceptedInput.accepted) return { accepted: false, reason: acceptedInput.reason, state }

  // Una conversación cerrada (propuesta ya confirmada) o vencida no hereda su
  // intención de reservar al mensaje nuevo.
  // Sólo se reinicia una conversación del mismo alcance; una ajena se rechaza.
  const sameScope = Boolean(state && isConversationStateForScope(state, scope))
  const closedState = Boolean(state && sameScope && state.last_event_id !== textFrom(eventId)
    && (state.confirmation_state === 'confirmed' || !isConversationStateFresh(state, now)))
  const pendingIntent = forceBookingIntent === true ? 'booking_intent' : closedState ? null : state?.pending_intent || null
  const extracted = extractConversationTurn({ text, pendingIntent, services, barbers, timezone, now })
  if (personalizedBooking) Object.assign(extracted.fields, interpretedFields)
  // "Cualquiera" es una preferencia explícita, sólo después de preguntar
  // por profesionales concretos obtenidos de la disponibilidad del negocio.
  if (state?.barber_selection_pending === true && /^(?:con )?(?:cualquiera|el que tenga libre|me da igual)[.!]*$/i.test(textFrom(text))) {
    const candidate = (state.available_barber_ids || []).find((id) => barbers.some((barber) => Number(barber.id) === Number(id) && barber.activo !== false))
    if (candidate) { extracted.fields.barber_id = candidate; extracted.fields.barber_selection_pending = false }
  }
  const incomingConfirmation = state?.confirmation_state === 'awaiting_confirmation' && parseExplicitConfirmation(text)
  if (incomingConfirmation) {
    const confirmation = applyConfirmation({ state, expectedScope: scope, text, eventId, now, proposalId: state.proposal_id, proposalVersion: state.confirmation_version })
    if (!confirmation.accepted) return { accepted: false, reason: confirmation.reason, duplicate: confirmation.duplicate, state: confirmation.state, intent: 'booking_intent', extracted }
    const action = nextConversationAction(confirmation.state, { expectedScope: scope, now })
    return { accepted: true, duplicate: false, reason: null, state: confirmation.state, action, intent: 'booking_intent', extracted, confirmed: true }
  }

  let current = state
  const stateFresh = Boolean(current && isConversationStateFresh(current, now))
  if (stateFresh && current.awaiting_customer_name === true && !hasBookingDetail(extracted.fields) && !suppressNameCapture) {
    const name = personalizedBooking && interpretedFields.customer_name ? interpretedFields.customer_name : extractCustomerName(text)
    if (name) {
      extracted.fields.customer_name = name
      if (personalizedBooking) extracted.fields.customer_name_confirmed = true
      extracted.fields.pending_intent = 'booking_intent'
    }
  }
  // Una conversación vencida no bloquea un mensaje nuevo: se empieza otra con
  // el mismo alcance y se conserva sólo la memoria del saludo con enlace. Un
  // reintento del mismo evento sigue llegando a la deduplicación.
  // Una propuesta ya confirmada no se reabre: el mensaje siguiente empieza otra
  // conversación (la reserva sólo puede salir del evento que confirmó).
  if (closedState) current = null
  if (!current) current = { ...createConversationState({ ...scope, now }), timezone: timezone || null, ...channelFieldsFrom(state) }
  const merged = mergeConversationTurn({ state: current, expectedScope: scope, eventId, extracted: extracted.fields, now })
  if (!merged.accepted) return { accepted: false, reason: merged.reason, duplicate: merged.duplicate, state: merged.state, intent: extracted.intent, extracted }
  const action = personalizedBooking && merged.state.pending_intent === 'booking_intent' && merged.state.customer_name_confirmed !== true
    ? { action: 'ask_name', missing_fields: ['customer_name'], mutation_allowed: false }
    : nextConversationAction(merged.state, { expectedScope: scope, customerNameRequired, now })
  const nextState = { ...merged.state, awaiting_customer_name: action.action === 'ask_name' }
  return { accepted: true, duplicate: false, reason: null, state: nextState, action, intent: nextState.pending_intent || extracted.intent, extracted, confirmed: false }
}

/**
 * Turno en el que el cliente pidió el enlace o eligió reservar por la web.
 * No agenda nada y deja sin efecto cualquier reserva que se estuviera armando
 * por chat, para no confirmar después un turno paralelo.
 */
export function applyWebChannelTurn({ state = null, scope, eventId, text, messageType = 'text', fromMe = false, isGroup = false, isBroadcast = false, timezone, linkResent = false, now = new Date() } = {}) {
  const acceptedInput = classifyConversationInput({ messageType, text, fromMe, isGroup, isBroadcast })
  if (!acceptedInput.accepted) return { accepted: false, reason: acceptedInput.reason, state }
  let current = state
  if (current && !isConversationStateFresh(current, now) && current.last_event_id !== textFrom(eventId)) current = null
  if (!current) current = { ...createConversationState({ ...scope, now }), timezone: timezone || null, ...channelFieldsFrom(state) }
  const merged = mergeConversationTurn({
    state: current,
    expectedScope: scope,
    eventId,
    extracted: {
      pending_intent: null,
      last_intent: 'general_query',
      service_id: null,
      requested_date: null,
      requested_time: null,
      daypart: null,
      barber_id: null,
      barber_selection_pending: false,
      awaiting_customer_name: false,
    },
    now,
  })
  if (!merged.accepted) return { accepted: false, reason: merged.reason, duplicate: merged.duplicate, state: merged.state }
  const nextState = {
    ...merged.state,
    channel_choice: 'web',
    channel_offer_at: linkResent === true ? new Date(now).toISOString() : merged.state.channel_offer_at || null,
    channel_offer_event_id: linkResent === true ? textFrom(eventId) : merged.state.channel_offer_event_id || null,
  }
  return { accepted: true, duplicate: false, reason: null, state: nextState, intent: 'general_query' }
}

/** Propuesta con la misma forma que las demás, para el saludo y la elección de canal. */
export function buildChannelProposal({ reply, intent = 'general_query', requestedAction, state = null } = {}) {
  return {
    intent,
    proposed_reply: normalizeCustomerReply(reply, '¿En qué te puedo ayudar?'),
    confidence: 0.95,
    requested_action: requestedAction,
    tools_considered: ['tenant_context_read'],
    context_counts: {
      conversation_required_fields: CONVERSATION_REQUIRED_FIELDS,
      missing_fields: deriveMissingFields(state),
      channel_choice: state?.channel_choice || null,
    },
    provider: 'qa_deterministic_conversation',
    model: 'conversation-state-v1',
    agent_prompt_version: CUSTOMER_FACING_PROMPT_VERSION,
    mutation_allowed: false,
    outbound_allowed: false,
  }
}

export function buildConversationProposal({ state, action, availability = null, serviceResolution = null, services = [], barbers = [], businessName = 'la barbería', replyPrefix = '' } = {}) {
  const safeBusinessName = textFrom(businessName) || 'la barbería'
  const service = serviceName(services, state?.service_id)
  const date = dateLabel(state?.requested_date)
  const time = textFrom(state?.requested_time)
  let proposedReply
  let requestedAction

  switch (action?.action) {
    case 'ask_service': {
      // Una coincidencia ambigua no debe convertirse en una pregunta vacía
      // repetida: ofrecemos los nombres del catálogo de este negocio.
      const choices = serviceResolution?.status === 'ambiguous' ? serviceResolution.matches : services
      const names = (choices || []).filter((item) => item?.activo !== false).map((item) => textFrom(item?.nombre)).filter(Boolean).slice(0, 5)
      proposedReply = names.length ? `¿Qué servicio querés reservar? Tenemos: ${names.join(', ')}.` : '¿Qué servicio querés reservar?'
      requestedAction = 'booking_collect_service'
      break
    }
    case 'ask_barber': {
      const allowed = state?.available_barber_ids || []
      const names = [...new Set(barbers.filter((barber) => barber?.activo !== false && (!allowed.length || allowed.includes(Number(barber.id)))).map((barber) => textFrom(barber?.nombre)).filter(Boolean))].slice(0, 3)
      proposedReply = names.length ? `¿Con qué barbero preferís? ${names.join(', ')}.` : '¿Con qué barbero preferís?'
      requestedAction = 'booking_collect_barber'
      break
    }
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
    case 'ask_name':
      proposedReply = '¿A nombre de quién dejo el turno?'
      requestedAction = 'booking_collect_customer_name'
      break
    case 'request_confirmation': {
      const customer = textFrom(state?.customer_name)
      proposedReply = `Tengo disponible ${service || 'el servicio'} el ${date || 'día solicitado'} a las ${time || 'la hora solicitada'}${customer ? ` a nombre de ${customer}` : ''}. ¿Confirmás?`
      requestedAction = 'booking_request_confirmation'
      break
    }
    case 'ready_for_booking_mutation':
      proposedReply = 'Perfecto, ya tengo todos los datos.'
      requestedAction = 'booking_confirmed_ready'
      break
    case 'restart_conversation':
      proposedReply = `Retomemos desde el principio. ¿Qué servicio te gustaría reservar en ${safeBusinessName}?`
      requestedAction = 'booking_restart'
      break
    case 'check_availability':
      proposedReply = time
        ? `Dale, reviso las ${time}${date ? ` para el ${date}` : ''}.`
        : date
          ? `Dale, reviso los horarios del ${date}.`
          : 'Dale, reviso los horarios.'
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
    proposed_reply: normalizeCustomerReply(textFrom(replyPrefix) ? `${textFrom(replyPrefix)} ${proposedReply}` : proposedReply, '¿En qué te puedo ayudar?'),
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
