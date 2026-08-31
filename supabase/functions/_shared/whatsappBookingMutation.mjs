export const QA_BOOKING_MUTATION_TENANT_ID = 1
export const QA_BOOKING_MUTATION_INSTANCE = 'austral-qa-tenant-1'
export const QA_BOOKING_MUTATION_ENVIRONMENT = 'qa'
export const QA_BOOKING_MUTATION_FLAG = 'WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED'
export const QA_BOOKING_MUTATION_PROMPT_VERSION = 'natural-v2'
export const PROTECTED_WHATSAPP_INSTANCE = 'miwsp'

const textFrom = (value) => String(value ?? '').trim()

export function normalizePhone(value) {
  const digits = textFrom(value).toLowerCase().replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '')
  return /^\d{8,20}$/.test(digits) ? digits : null
}

export function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(textFrom(left))
  const b = new TextEncoder().encode(textFrom(right))
  if (a.length === 0 || a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index]
  return mismatch === 0
}

export function isQaBookingMutationRuntime({ projectRef, provisioningEnv, whatsappMode, pilotMode } = {}) {
  return textFrom(projectRef) === 'cmsymmszlzikqpvfqjre'
    && textFrom(provisioningEnv) === QA_BOOKING_MUTATION_ENVIRONMENT
    && textFrom(whatsappMode) === 'shadow'
    && textFrom(pilotMode) === 'shadow'
}

export function buildBookingClaimEventId(state = {}) {
  const conversationId = textFrom(state.conversation_id).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 140)
  const version = Number(state.confirmation_version ?? state.version)
  if (!conversationId || !Number.isSafeInteger(version) || version < 1) return null
  return `booking:${conversationId}:${version}`.slice(0, 200)
}

export function isConfirmedBookingState(state = {}, eventId = '') {
  const version = Number(state.confirmation_version)
  return textFrom(state.environment).toLowerCase() === QA_BOOKING_MUTATION_ENVIRONMENT
    && textFrom(state.instance) === QA_BOOKING_MUTATION_INSTANCE
    && Number(state.tenant_id) === QA_BOOKING_MUTATION_TENANT_ID
    && Number(state.integration_id) > 0
    && textFrom(state.confirmation_state) === 'confirmed'
    && state.confirmation_required === false
    && state.ready_for_booking_mutation === true
    && state.mutation_allowed === false
    && Number.isSafeInteger(version)
    && version > 0
    && version === Number(state.version)
    && textFrom(state.last_event_id) === textFrom(eventId)
    && Boolean(textFrom(state.conversation_id))
    && Boolean(textFrom(state.service_id))
    && /^\d{4}-\d{2}-\d{2}$/.test(textFrom(state.requested_date))
    && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(textFrom(state.requested_time))
}

export function selectAuthoritativeSlot(slots = [], state = {}) {
  const requestedTime = textFrom(state.requested_time).slice(0, 5)
  const requestedBarber = state.barber_id === null || state.barber_id === undefined || state.barber_id === ''
    ? null
    : Number(state.barber_id)
  const matches = slots.filter((slot) => {
    if (textFrom(slot?.hora).slice(0, 5) !== requestedTime) return false
    if (requestedBarber !== null && Number(slot?.barbero_id) !== requestedBarber) return false
    return Number(slot?.service_id || state.service_id) === Number(state.service_id)
  })
  if (matches.length === 0) return { allowed: false, reason: 'slot_unavailable_after_recheck', slot: null }
  if (matches.length > 1 && requestedBarber === null) return { allowed: false, reason: 'barber_selection_required', slot: null }
  return { allowed: true, reason: null, slot: matches[0] }
}

export function bookingMutationGuard({
  enabled,
  runtimeValid,
  tenantId,
  environment,
  instance,
  connectionState,
  sourceEventPresent,
  sourceEventFresh,
  sourceEventReal,
  sourceTenantId,
  sourceIntegrationId,
  sourceFromMe,
  sourceEnvironment,
  senderHashMatches,
  sourceIntent,
  stateValid,
  availabilityRechecked,
  requestedSlotAvailable,
  operationClaimAvailable,
} = {}) {
  if (!runtimeValid) return { allowed: false, reason: 'qa_shadow_runtime_required' }
  if (enabled !== true) return { allowed: false, reason: 'booking_mutation_pilot_disabled' }
  if (tenantId !== QA_BOOKING_MUTATION_TENANT_ID || sourceTenantId !== QA_BOOKING_MUTATION_TENANT_ID) return { allowed: false, reason: 'qa_tenant_required' }
  if (environment !== QA_BOOKING_MUTATION_ENVIRONMENT || sourceEnvironment !== QA_BOOKING_MUTATION_ENVIRONMENT) return { allowed: false, reason: 'qa_environment_required' }
  if (instance !== QA_BOOKING_MUTATION_INSTANCE || instance === PROTECTED_WHATSAPP_INSTANCE) return { allowed: false, reason: 'qa_instance_required' }
  if (connectionState !== 'CONNECTED') return { allowed: false, reason: 'qa_connection_not_connected' }
  if (sourceEventPresent !== true || sourceEventFresh !== true || sourceEventReal !== true) return { allowed: false, reason: 'fresh_real_source_event_required' }
  if (sourceIntegrationId !== operationClaimAvailable?.integrationId) return { allowed: false, reason: 'source_integration_mismatch' }
  if (sourceFromMe !== false) return { allowed: false, reason: 'from_me_ignored' }
  if (senderHashMatches !== true) return { allowed: false, reason: 'sender_not_allowlisted' }
  if (sourceIntent !== 'booking_intent') return { allowed: false, reason: 'booking_intent_required' }
  if (stateValid !== true) return { allowed: false, reason: 'confirmed_booking_state_required' }
  if (availabilityRechecked !== true) return { allowed: false, reason: 'authoritative_availability_required' }
  if (requestedSlotAvailable !== true) return { allowed: false, reason: 'slot_changed' }
  if (operationClaimAvailable?.available !== true) return { allowed: false, reason: 'booking_claim_unavailable' }
  return { allowed: true, reason: null }
}

export function buildBookingMutationContract({ state = {}, recheck = {}, pilotEnabled = false } = {}) {
  return {
    claim_key: buildBookingClaimEventId(state),
    sequence: Object.freeze([
      'source_event_validation',
      'confirmed_state_validation',
      'authoritative_availability_recheck',
      'mutation_pilot_guard',
      'idempotent_booking_rpc',
      'post_mutation_reply',
    ]),
    ready_for_booking_mutation: isConfirmedBookingState(state, state.last_event_id),
    availability_rechecked: recheck.source === 'authoritative_rpc' && recheck.requested_slot_available === true,
    mutation_allowed: pilotEnabled === true && recheck.source === 'authoritative_rpc' && recheck.requested_slot_available === true,
    booking_mutation_executed: false,
  }
}
