/**
 * Deterministic, tenant-scoped conversation state for the future WhatsApp
 * booking flow. This module is deliberately pure: it performs no Supabase,
 * Evolution, LLM or booking calls. The QA webhook persists its returned state
 * in the existing shadow-run metadata after server-side scope validation.
 */

export const CONVERSATION_TTL_MS = 30 * 60 * 1000
export const CONVERSATION_STATES = Object.freeze([
  'collecting',
  'awaiting_confirmation',
  'confirmed',
  'expired',
])
export const CONVERSATION_REQUIRED_FIELDS = Object.freeze([
  'service_id',
  'requested_date',
  'requested_time',
])
export const QA_CONVERSATION_ENVIRONMENT = 'qa'
export const SUPPORTED_CONVERSATION_MESSAGE_TYPES = Object.freeze(['text'])
export const CONVERSATION_INTENTS = Object.freeze([
  'services_query',
  'availability_query',
  'general_query',
  'price_query',
  'booking_intent',
  'booking_change_request',
  'empty_query',
])

const DAYPARTS = new Set(['morning', 'afternoon', 'evening'])
const intents = new Set(CONVERSATION_INTENTS)
const CONFIRMATIONS = new Set([
  'si',
  'confirmo',
  'confirmar',
  'confirmar turno',
  'confirmo el turno',
  'si confirmo',
])
const EMPTY_STATE_FIELDS = Object.freeze({
  pending_intent: null,
  service_id: null,
  requested_date: null,
  requested_time: null,
  daypart: null,
  barber_id: null,
  confirmation_required: false,
  confirmation_state: 'collecting',
  last_event_id: null,
  expires_at: null,
  availability_snapshot_id: null,
  availability_checked_at: null,
  requested_slot_available: null,
  confirmation_version: null,
  proposal_id: null,
  ready_for_booking_mutation: false,
  mutation_allowed: false,
})

const textFrom = (value) => String(value ?? '').trim()

export function classifyConversationInput({ messageType, text, fromMe = false, isGroup = false, isBroadcast = false } = {}) {
  if (fromMe === true) return { accepted: false, reason: 'from_me_ignored' }
  if (isGroup === true) return { accepted: false, reason: 'group_event_rejected' }
  if (isBroadcast === true) return { accepted: false, reason: 'broadcast_event_rejected' }
  const type = textFrom(messageType).toLowerCase()
  if (!type || typeof text !== 'string') return { accepted: false, reason: 'malformed_event' }
  if (!SUPPORTED_CONVERSATION_MESSAGE_TYPES.includes(type)) return { accepted: false, reason: 'unsupported_message_type' }
  if (!textFrom(text)) return { accepted: false, reason: 'empty_message' }
  return { accepted: true, kind: 'text', reason: null }
}

function asDate(value, label) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new TypeError(`${label} must be a valid date`)
  return date
}

function iso(value, label) {
  return asDate(value, label).toISOString()
}

function positiveInteger(value, label) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) throw new TypeError(`${label} must be a positive integer`)
  return number
}

function normalizeSenderHash(value) {
  const hash = textFrom(value).toLowerCase()
  if (!/^sha256:[0-9a-f]{12}$/.test(hash)) throw new TypeError('sender_hash must be a truncated SHA-256 hash')
  return hash
}

function normalizeScope({ tenantId, integrationId, instance, senderHash, environment = QA_CONVERSATION_ENVIRONMENT }) {
  const scope = {
    tenant_id: positiveInteger(tenantId, 'tenant_id'),
    integration_id: positiveInteger(integrationId, 'integration_id'),
    instance: textFrom(instance),
    sender_hash: normalizeSenderHash(senderHash),
    environment: textFrom(environment).toLowerCase(),
  }
  if (!scope.instance || scope.instance === 'miwsp') throw new TypeError('instance must be a non-protected value')
  if (scope.environment !== QA_CONVERSATION_ENVIRONMENT) throw new TypeError('environment must be qa')
  return Object.freeze(scope)
}

function conversationId(scope, requestedId) {
  const supplied = textFrom(requestedId)
  if (supplied) return supplied.slice(0, 160)
  return `wa-conversation:${scope.tenant_id}:${scope.integration_id}:${scope.instance}:${scope.sender_hash}`
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') return null
  const date = textFrom(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('requested_date must use YYYY-MM-DD')
  return date
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === '') return null
  const time = textFrom(value)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new TypeError('requested_time must use HH:MM')
  return time
}

function normalizeExtracted(extracted = {}) {
  if (!extracted || typeof extracted !== 'object' || Array.isArray(extracted)) throw new TypeError('extracted fields must be an object')
  const output = {}
  if (Object.prototype.hasOwnProperty.call(extracted, 'pending_intent')) {
    const intent = textFrom(extracted.pending_intent) || null
    if (intent !== null && !intents.has(intent)) throw new TypeError('pending_intent is not supported')
    output.pending_intent = intent
  }
  if (Object.prototype.hasOwnProperty.call(extracted, 'service_id')) output.service_id = extracted.service_id === null || extracted.service_id === '' ? null : positiveInteger(extracted.service_id, 'service_id')
  if (Object.prototype.hasOwnProperty.call(extracted, 'requested_date')) output.requested_date = normalizeDate(extracted.requested_date)
  if (Object.prototype.hasOwnProperty.call(extracted, 'requested_time')) output.requested_time = normalizeTime(extracted.requested_time)
  if (Object.prototype.hasOwnProperty.call(extracted, 'daypart')) {
    const daypart = textFrom(extracted.daypart).toLowerCase() || null
    if (daypart !== null && !DAYPARTS.has(daypart)) throw new TypeError('daypart is not supported')
    output.daypart = daypart
  }
  if (Object.prototype.hasOwnProperty.call(extracted, 'barber_id')) output.barber_id = extracted.barber_id === null || extracted.barber_id === '' ? null : positiveInteger(extracted.barber_id, 'barber_id')
  return output
}

function hasRequiredFields(state) {
  return deriveMissingFields(state).length === 0
}

function cloneState(state) {
  return { ...state }
}

function hasValidStateScope(state) {
  if (!state || typeof state !== 'object') return false
  try {
    const scope = normalizeScope({
      tenantId: state.tenant_id,
      integrationId: state.integration_id,
      instance: state.instance,
      senderHash: state.sender_hash,
      environment: state.environment,
    })
    return scope.tenant_id === state.tenant_id
      && scope.integration_id === state.integration_id
      && scope.instance === state.instance
      && scope.sender_hash === state.sender_hash
      && scope.environment === state.environment
  } catch {
    return false
  }
}

function matchesExpectedScope(state, expectedScope) {
  if (!hasValidStateScope(state) || !expectedScope || typeof expectedScope !== 'object') return false
  try {
    const scope = normalizeScope({
      tenantId: expectedScope.tenantId ?? expectedScope.tenant_id,
      integrationId: expectedScope.integrationId ?? expectedScope.integration_id,
      instance: expectedScope.instance,
      senderHash: expectedScope.senderHash ?? expectedScope.sender_hash,
      environment: expectedScope.environment,
    })
    return scope.tenant_id === state.tenant_id
      && scope.integration_id === state.integration_id
      && scope.instance === state.instance
      && scope.sender_hash === state.sender_hash
      && scope.environment === state.environment
  } catch {
    return false
  }
}

function markExpired(state, eventId = state.last_event_id) {
  return {
    ...cloneState(state),
    ...EMPTY_STATE_FIELDS,
    tenant_id: state.tenant_id,
    integration_id: state.integration_id,
    conversation_id: state.conversation_id,
    instance: state.instance,
    sender_hash: state.sender_hash,
    version: Number(state.version || 1) + 1,
    last_event_id: eventId,
    expires_at: state.expires_at,
    confirmation_state: 'expired',
    mutation_allowed: false,
  }
}

export function conversationScope({ tenantId, integrationId, instance, senderHash, environment = QA_CONVERSATION_ENVIRONMENT }) {
  return normalizeScope({ tenantId, integrationId, instance, senderHash, environment })
}

export function createConversationState({ tenantId, integrationId, instance, senderHash, environment = QA_CONVERSATION_ENVIRONMENT, conversationId: requestedId, now = new Date() }) {
  const scope = normalizeScope({ tenantId, integrationId, instance, senderHash, environment })
  const createdAt = iso(now, 'now')
  return {
    ...scope,
    conversation_id: conversationId(scope, requestedId),
    ...EMPTY_STATE_FIELDS,
    created_at: createdAt,
    updated_at: createdAt,
    version: 1,
    expires_at: new Date(asDate(now, 'now').getTime() + CONVERSATION_TTL_MS).toISOString(),
  }
}

export function isConversationStateFresh(state, now = new Date()) {
  if (!hasValidStateScope(state) || state.confirmation_state === 'expired') return false
  const expiry = new Date(String(state.expires_at || '')).getTime()
  const current = asDate(now, 'now').getTime()
  return Number.isFinite(expiry) && expiry > current
}

export function isConversationStateForScope(state, expectedScope) {
  return matchesExpectedScope(state, expectedScope)
}

export function deriveMissingFields(state) {
  if (!state || typeof state !== 'object') return [...CONVERSATION_REQUIRED_FIELDS]
  return CONVERSATION_REQUIRED_FIELDS.filter((field) => state[field] === null || state[field] === undefined || state[field] === '')
}

export function mergeConversationTurn({ state, expectedScope, eventId, extracted = {}, now = new Date() }) {
  if (!state || typeof state !== 'object') return { accepted: false, duplicate: false, reason: 'conversation_missing', state: null }
  if (!matchesExpectedScope(state, expectedScope)) return { accepted: false, duplicate: false, reason: 'conversation_scope_invalid', state }
  const cleanEventId = textFrom(eventId)
  if (!cleanEventId) return { accepted: false, duplicate: false, reason: 'event_id_required', state }
  if (state.last_event_id === cleanEventId) return { accepted: false, duplicate: true, reason: 'duplicate_event', state }
  if (!isConversationStateFresh(state, now)) return { accepted: false, duplicate: false, reason: 'conversation_expired', state: markExpired(state, cleanEventId) }

  let fields
  try {
    fields = normalizeExtracted(extracted)
  } catch {
    return { accepted: false, duplicate: false, reason: 'invalid_extracted_fields', state }
  }
  const next = { ...cloneState(state), ...fields }
  const changedBookingField = ['service_id', 'requested_date', 'requested_time', 'daypart', 'barber_id'].some((field) => Object.prototype.hasOwnProperty.call(fields, field) && fields[field] !== state[field])
  const proposalMustReset = changedBookingField || state.confirmation_state === 'awaiting_confirmation'
  const nextVersion = Number(state.version || 1) + 1
  const nowIso = iso(now, 'now')
  if (proposalMustReset) {
    next.confirmation_required = false
    next.confirmation_state = 'collecting'
    next.confirmation_version = null
    next.proposal_id = null
    next.availability_snapshot_id = null
    next.availability_checked_at = null
    next.requested_slot_available = null
    next.ready_for_booking_mutation = false
  }
  next.last_event_id = cleanEventId
  next.version = nextVersion
  next.updated_at = nowIso
  next.expires_at = new Date(asDate(now, 'now').getTime() + CONVERSATION_TTL_MS).toISOString()
  next.mutation_allowed = false
  return { accepted: true, duplicate: false, reason: null, state: next }
}

export function recordAvailabilityResult({ state, expectedScope, source = 'authoritative_rpc', available, snapshotId, now = new Date(), proposalId = null }) {
  if (!state || typeof state !== 'object') return { accepted: false, reason: 'conversation_missing', state: null }
  if (!matchesExpectedScope(state, expectedScope)) return { accepted: false, reason: 'conversation_scope_invalid', state }
  if (!isConversationStateFresh(state, now)) return { accepted: false, reason: 'conversation_expired', state: markExpired(state) }
  if (source !== 'authoritative_rpc') return { accepted: false, reason: 'authoritative_availability_required', state }
  if (!hasRequiredFields(state)) return { accepted: false, reason: 'required_fields_missing', state }
  if (typeof available !== 'boolean') return { accepted: false, reason: 'availability_result_required', state }
  if (!textFrom(snapshotId)) return { accepted: false, reason: 'availability_snapshot_required', state }
  const next = { ...cloneState(state), availability_snapshot_id: textFrom(snapshotId) || null, availability_checked_at: iso(now, 'now'), requested_slot_available: available, updated_at: iso(now, 'now'), mutation_allowed: false }
  if (available) {
    next.confirmation_required = true
    next.confirmation_state = 'awaiting_confirmation'
    next.confirmation_version = state.version
    next.proposal_id = textFrom(proposalId) || `proposal:${state.conversation_id}:${state.version}`
  } else {
    next.confirmation_required = false
    next.confirmation_state = 'collecting'
    next.confirmation_version = null
    next.proposal_id = null
    next.ready_for_booking_mutation = false
  }
  return { accepted: true, reason: null, state: next }
}

export function parseExplicitConfirmation(text) {
  const normalized = textFrom(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[¡!¿?.,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return CONFIRMATIONS.has(normalized)
}

export function applyConfirmation({ state, expectedScope, text, eventId, now = new Date(), proposalId = null, proposalVersion = null }) {
  if (!state || typeof state !== 'object') return { accepted: false, duplicate: false, reason: 'conversation_missing', state: null }
  if (!matchesExpectedScope(state, expectedScope)) return { accepted: false, duplicate: false, reason: 'conversation_scope_invalid', state }
  if (!isConversationStateFresh(state, now)) return { accepted: false, duplicate: false, reason: 'conversation_expired', state: markExpired(state, textFrom(eventId) || state.last_event_id) }
  const cleanEventId = textFrom(eventId)
  if (!cleanEventId) return { accepted: false, duplicate: false, reason: 'event_id_required', state }
  if (state.last_event_id === cleanEventId) return { accepted: false, duplicate: true, reason: 'duplicate_event', state }
  if (state.confirmation_state !== 'awaiting_confirmation' || !state.confirmation_required) return { accepted: false, duplicate: false, reason: 'confirmation_not_requested', state }
  if (!hasRequiredFields(state)) return { accepted: false, duplicate: false, reason: 'required_fields_missing', state }
  if (!parseExplicitConfirmation(text)) return { accepted: false, duplicate: false, reason: 'explicit_confirmation_required', state }
  if (!state.proposal_id || state.confirmation_version === null || state.confirmation_version === undefined || Number(state.confirmation_version) !== Number(state.version)) return { accepted: false, duplicate: false, reason: 'stale_proposal', state }
  if (proposalId !== null && textFrom(proposalId) !== state.proposal_id) return { accepted: false, duplicate: false, reason: 'stale_proposal', state }
  if (proposalVersion !== null && Number(proposalVersion) !== Number(state.confirmation_version)) return { accepted: false, duplicate: false, reason: 'stale_proposal', state }
  const next = {
    ...cloneState(state),
    confirmation_state: 'confirmed',
    confirmation_required: false,
    ready_for_booking_mutation: true,
    mutation_allowed: false,
    last_event_id: cleanEventId,
    updated_at: iso(now, 'now'),
    expires_at: new Date(asDate(now, 'now').getTime() + CONVERSATION_TTL_MS).toISOString(),
  }
  return { accepted: true, duplicate: false, reason: null, state: next }
}

export function nextConversationAction(state, { expectedScope, availabilityStatus = null, requestedSlotAvailable = null, now = new Date() } = {}) {
  if (!matchesExpectedScope(state, expectedScope)) return { action: 'restart_conversation', reason: 'conversation_scope_invalid', mutation_allowed: false }
  if (!isConversationStateFresh(state, now)) return { action: 'restart_conversation', reason: 'conversation_expired', mutation_allowed: false }
  const missing = deriveMissingFields(state)
  if (missing.includes('service_id')) return { action: 'ask_service', missing_fields: missing, mutation_allowed: false }
  if (missing.includes('requested_date')) return { action: 'ask_date', missing_fields: missing, mutation_allowed: false }
  if (missing.includes('requested_time')) return { action: 'ask_time', missing_fields: missing, mutation_allowed: false }
  if (availabilityStatus === 'unavailable' || requestedSlotAvailable === false) return { action: 'offer_alternatives', missing_fields: [], mutation_allowed: false }
  if (availabilityStatus === 'available' && requestedSlotAvailable === true) return { action: 'request_confirmation', missing_fields: [], mutation_allowed: false }
  if (state.confirmation_state === 'confirmed') return { action: 'ready_for_booking_mutation', missing_fields: [], ready_for_booking_mutation: true, mutation_allowed: false }
  return { action: 'check_availability', missing_fields: [], mutation_allowed: false }
}

export function availabilityRecheck({ state, expectedScope, source = 'authoritative_rpc', requestedSlotAvailable, now = new Date() }) {
  if (!state || typeof state !== 'object') return { allowed: false, reason: 'conversation_missing', ready_for_booking_mutation: false, mutation_allowed: false }
  if (!matchesExpectedScope(state, expectedScope)) return { allowed: false, reason: 'conversation_scope_invalid', ready_for_booking_mutation: false, mutation_allowed: false }
  if (!isConversationStateFresh(state, now)) return { allowed: false, reason: 'conversation_expired', ready_for_booking_mutation: false, mutation_allowed: false }
  if (state.confirmation_state !== 'confirmed') return { allowed: false, reason: 'confirmation_required', ready_for_booking_mutation: false, mutation_allowed: false }
  if (!hasRequiredFields(state)) return { allowed: false, reason: 'required_fields_missing', ready_for_booking_mutation: false, mutation_allowed: false }
  if (source !== 'authoritative_rpc') return { allowed: false, reason: 'authoritative_availability_required', ready_for_booking_mutation: false, mutation_allowed: false }
  if (requestedSlotAvailable !== true) return { allowed: false, reason: 'slot_changed', ready_for_booking_mutation: false, mutation_allowed: false }
  return { allowed: false, reason: 'mutation_hard_disabled', ready_for_booking_mutation: true, mutation_allowed: false, booking_mutation_allowed: false }
}

export function buildBookingMutationContract({ state, recheck }) {
  const claimKey = state?.conversation_id && state?.version ? `booking:${state.conversation_id}:${state.version}` : null
  return {
    claim_key: claimKey,
    sequence: Object.freeze(['mutation_claim', 'authoritative_availability_recheck', 'authoritative_booking_rpc', 'idempotent_result', 'reply']),
    ready_for_booking_mutation: recheck?.ready_for_booking_mutation === true,
    mutation_allowed: false,
    booking_mutation_executed: false,
  }
}
