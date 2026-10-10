export const QA_BOOKING_MUTATION_TENANT_ID = 1
export const QA_BOOKING_MUTATION_INSTANCE = 'austral-qa-tenant-1'
export const QA_BOOKING_MUTATION_ENVIRONMENT = 'qa'
export const QA_BOOKING_MUTATION_FLAG = 'WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED'
export const QA_BOOKING_MUTATION_PROMPT_VERSION = 'natural-v2'
export const PROTECTED_WHATSAPP_INSTANCE = 'miwsp'
// Lista explícita de tenants QA que pueden agendar por chat. Sin valor, sólo
// el tenant QA 1 (comportamiento anterior). Cada tenant usa su instancia
// gestionada austral-qa-tenant-<id>; miwsp nunca.
export const QA_BOOKING_MUTATION_TENANTS_ENV = 'WHATSAPP_BOOKING_MUTATION_ALLOWED_TENANT_IDS'

const textFrom = (value) => String(value ?? '').trim()

export function parseQaBookingTenantAllowlist(value) {
  const raw = textFrom(value)
  if (!raw) return Object.freeze([QA_BOOKING_MUTATION_TENANT_ID])
  const ids = raw.split(',').map((item) => item.trim()).filter((item) => /^\d{1,12}$/.test(item)).map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)
  return Object.freeze([...new Set(ids)])
}

export function isQaBookingTenantAllowed(tenantId, allowlistValue) {
  const id = Number(tenantId)
  return Number.isSafeInteger(id) && parseQaBookingTenantAllowlist(allowlistValue).includes(id)
}

export function qaBookingInstanceForTenant(tenantId) {
  const id = Number(tenantId)
  return Number.isSafeInteger(id) && id > 0 ? `austral-qa-tenant-${id}` : null
}

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

export function isConfirmedBookingState(state = {}, eventId = '', allowlistValue = undefined) {
  const version = Number(state.confirmation_version)
  return textFrom(state.environment).toLowerCase() === QA_BOOKING_MUTATION_ENVIRONMENT
    && isQaBookingTenantAllowed(state.tenant_id, allowlistValue)
    && textFrom(state.instance) === qaBookingInstanceForTenant(state.tenant_id)
    && textFrom(state.instance) !== PROTECTED_WHATSAPP_INSTANCE
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
  allowedTenants = undefined,
} = {}) {
  if (!runtimeValid) return { allowed: false, reason: 'qa_shadow_runtime_required' }
  if (enabled !== true) return { allowed: false, reason: 'booking_mutation_pilot_disabled' }
  if (!isQaBookingTenantAllowed(tenantId, allowedTenants) || sourceTenantId !== tenantId) return { allowed: false, reason: 'qa_tenant_required' }
  if (environment !== QA_BOOKING_MUTATION_ENVIRONMENT || sourceEnvironment !== QA_BOOKING_MUTATION_ENVIRONMENT) return { allowed: false, reason: 'qa_environment_required' }
  if (instance !== qaBookingInstanceForTenant(tenantId) || instance === PROTECTED_WHATSAPP_INSTANCE) return { allowed: false, reason: 'qa_instance_required' }
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

/**
 * Aviso para el cliente que sólo se arma con la fila ya guardada por
 * crear_reserva_whatsapp (fecha/hora devueltas por la RPC, no las propuestas).
 */
export function buildBookingConfirmedReply({ businessName, serviceName, fecha, hora } = {}) {
  const date = textFrom(fecha)
  const time = textFrom(hora).slice(0, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null
  const dayLabel = new Date(`${date}T12:00:00Z`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  const service = textFrom(serviceName).replace(/[\r\n]+/g, ' ').slice(0, 120)
  const business = textFrom(businessName).replace(/[\r\n]+/g, ' ').slice(0, 120)
  return `¡Listo! Tu turno${service ? ` de ${service}` : ''} quedó reservado para el ${dayLabel} a las ${time}${business ? ` en ${business}` : ''}.`
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

// Tarea 41 (revisión): rechazos de horario al confirmar por WhatsApp. La
// base rechaza un horario bloqueado (22023, en crear_reserva_whatsapp o en el
// trigger de turnos) u ocupado (23P01). 22023 también se usa para otros
// errores de datos, así que el bloqueo se reconoce por el mensaje.
export const SLOT_REJECTION_REASONS = Object.freeze(['slot_blocked', 'slot_taken', 'slot_unavailable'])
const MAX_ALTERNATIVES = 6
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/

export function classifyBookingSlotRejection(error) {
  const code = textFrom(error?.code)
  const message = textFrom(error?.message).toLowerCase()
  if (code === '23P01') return 'slot_taken'
  if (code !== '22023') return null
  if (/bloquead/.test(message)) return 'slot_blocked'
  if (/ya pas[oó]|no trabaja/.test(message)) return 'slot_unavailable'
  return null
}

// Horarios para ofrecer después de un rechazo: misma disponibilidad
// autoritativa, mismo profesional si el cliente lo eligió, sin el horario
// rechazado ni repetidos.
export function alternativeSlotTimes(slots = [], state = {}) {
  const requested = textFrom(state.requested_time).slice(0, 5)
  const barber = state.barber_id === null || state.barber_id === undefined || state.barber_id === '' ? null : Number(state.barber_id)
  const times = new Set()
  for (const slot of Array.isArray(slots) ? slots : []) {
    const time = textFrom(slot?.hora).slice(0, 5)
    if (!TIME_RE.test(time) || time === requested) continue
    if (barber !== null && Number(slot?.barbero_id) !== barber) continue
    if (slot?.service_id !== undefined && Number(slot.service_id) !== Number(state.service_id)) continue
    times.add(time)
  }
  return [...times].sort().slice(0, MAX_ALTERNATIVES)
}

const REJECTION_CAUSE = Object.freeze({
  slot_blocked: 'porque el negocio lo bloqueó',
  slot_taken: 'porque se acaba de ocupar',
  slot_unavailable: 'porque ya no está disponible',
})

// Texto fijo armado en el servidor; nunca sale del modelo ni de n8n.
export function buildSlotRejectedReply({ reason, alternatives = [] } = {}) {
  const cause = REJECTION_CAUSE[reason]
  if (!cause) return null
  // null: no se pudo volver a consultar la disponibilidad; no se afirma que no quede nada.
  if (alternatives === null) return `No pude reservar ese horario ${cause}. No se agendó ningún turno. Decime otro horario o día y lo reviso.`
  if (!Array.isArray(alternatives) || alternatives.some((time) => !TIME_RE.test(textFrom(time)))) return null
  const offer = alternatives.length
    ? `Puedo ofrecerte: ${alternatives.slice(0, MAX_ALTERNATIVES).join(', ')}. ¿Cuál te sirve?`
    : 'Ese día no quedan otros horarios. ¿Querés que busque otro día?'
  return `No pude reservar ese horario ${cause}. No se agendó ningún turno. ${offer}`
}

export function isSafeSlotRejectedReply(reply) {
  const value = textFrom(reply)
  return value.length > 0 && value.length <= 400 && /^No pude reservar ese horario /.test(value) && /No se agendó ningún turno\./.test(value)
}

export function buildSlotRejectedOperationId(eventId) {
  const clean = textFrom(eventId).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160)
  return clean ? `slot-rejected:${clean}` : null
}

// La reserva confirmada no se guardó por un motivo que no es el horario
// (estado, nombre, reclamo en conflicto): el cliente recibe un aviso en vez
// de silencio. Texto fijo del servidor; no afirma ninguna reserva.
export const BOOKING_FAILED_REPLY = 'Perdón, no pude confirmar tu turno y todavía no quedó reservado. El equipo del negocio va a ver este chat y te responde por acá.'

export function isSafeBookingFailedReply(reply) {
  return textFrom(reply) === BOOKING_FAILED_REPLY
}

export function buildBookingFailedOperationId(eventId) {
  const clean = textFrom(eventId).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160)
  return clean ? `booking-failed:${clean}` : null
}
