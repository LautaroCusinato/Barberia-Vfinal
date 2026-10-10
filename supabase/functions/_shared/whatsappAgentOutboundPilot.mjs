import { isSafeBookingFailedReply, isSafeSlotRejectedReply } from './whatsappBookingMutation.mjs'
export const QA_AGENT_OUTBOUND_ALLOWED_INTENTS = Object.freeze(['services_query', 'price_query', 'availability_query', 'general_query', 'booking_intent'])
export const PROTECTED_WHATSAPP_INSTANCE = 'miwsp'

const textFrom = (value) => String(value ?? '').trim()
const allowedIntents = new Set(QA_AGENT_OUTBOUND_ALLOWED_INTENTS)

export function parseQaAgentOutboundTenantAllowlist(value) {
  const ids = String(value ?? '')
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  return Object.freeze([...new Set(ids)])
}

export function isQaAgentOutboundTenantAllowed(tenantId, allowlist) {
  const id = Number(tenantId)
  return Number.isSafeInteger(id) && id > 0 && Array.isArray(allowlist) && allowlist.includes(id)
}

// Prefijo de la instancia administrada según el entorno de la conversación.
export const MANAGED_INSTANCE_PREFIXES = Object.freeze({ qa: 'austral-qa-tenant-', production: 'austral-prod-tenant-' })

export function qaAgentOutboundInstanceForTenant(tenantId, environment = 'qa') {
  const id = Number(tenantId)
  const prefix = MANAGED_INSTANCE_PREFIXES[environment]
  return prefix && Number.isSafeInteger(id) && id > 0 ? `${prefix}${id}` : null
}

export function buildAgentOutboundOperationId(eventId) {
  const clean = textFrom(eventId).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160)
  return clean ? `agent-outbound:${clean}` : null
}

// Modo one-shot del recorrido QA 927 de otro chat (desplegado en QA el 24/09).
// Sólo se usa con WHATSAPP_QA_927_AUTOMATION_ENABLED=1; preservado tal cual.
export function qa927OneShotOperationId(runId) {
  const value = textFrom(runId)
  return /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? `agent-outbound:qa-927:${value}` : null
}

// Resultado de un envío a Evolution. Sólo un rechazo explícito del proveedor
// prueba que el mensaje no salió; un error de red, timeout, 408/429 o 5xx
// puede haber entregado igual, así que queda incierto y no se reintenta.
const CONFIRMED_REJECTION_STATUSES = new Set([400, 401, 403, 404, 422])
export function classifyEvolutionSendOutcome({ threw = false, status = null } = {}) {
  if (threw === true) return 'uncertain'
  const code = Number(status)
  if (code >= 200 && code < 300) return 'sent'
  if (CONFIRMED_REJECTION_STATUSES.has(code)) return 'rejected'
  return 'uncertain'
}

export function buildBookingConfirmationOperationId(turnoId) {
  const id = Number(turnoId)
  return Number.isSafeInteger(id) && id > 0 ? `booking-confirmation:${id}` : null
}

/**
 * La confirmación posterior a guardar el turno sí afirma la reserva: sólo es
 * válida si el turno ya está persistido (lo decide el llamador con datos de
 * la base). Igual se rechazan secretos, SQL, pagos y textos fuera de tamaño.
 */
export function isSafeBookingConfirmationReply({ reply, bookingPersisted }) {
  const value = textFrom(reply)
  if (bookingPersisted !== true || !value || value.length > 1000) return false
  if (/service_role|access_token|webhook_secret|authorization|api[_ -]?key|card[_ -]?token|password|secret/i.test(value)) return false
  if (/\b(insert|update|delete|drop|alter|truncate|create table|grant|revoke)\b/i.test(value)) return false
  if (/\b(cobr|pag(ar|o)|invoice|preapproval|suscripci[oó]n)\b/i.test(value)) return false
  return /^¡Listo! Tu turno/.test(value)
}

export function isQaAgentOutboundRuntime({ projectRef, provisioningEnv, whatsappMode, pilotMode }) {
  return projectRef === 'cmsymmszlzikqpvfqjre'
    && provisioningEnv === 'qa'
    && whatsappMode === 'shadow'
    && pilotMode === 'shadow'
}

export function isAllowedAgentIntent(intent) {
  return allowedIntents.has(textFrom(intent))
}

export function hasAuthoritativePriceSource(metadata = {}) {
  const agent = metadata && typeof metadata.agent === 'object' ? metadata.agent : {}
  const tools = Array.isArray(agent.tools_considered) ? agent.tools_considered : []
  const counts = agent.context_counts && typeof agent.context_counts === 'object' ? agent.context_counts : {}
  return agent.provider === 'qa_deterministic_shadow'
    && tools.includes('services_read')
    && Number.isFinite(Number(counts.services))
    && Number(counts.services) >= 0
}

export function isRealPersistedSourceMetadata(metadata = {}, environment = 'qa') {
  return metadata.source === 'evolution'
    && metadata.event === 'MESSAGES_UPSERT'
    && metadata.environment === environment
    && metadata.from_me === false
    && metadata.mutation_allowed === false
    && metadata.outbound_allowed === false
    && metadata.mutation_blocked === true
    && metadata.outbound_send === false
}

export function isPersistedConversationScope(metadata = {}, { tenantId, integrationId, instance, senderHash, environment = 'qa' } = {}) {
  const scope = metadata.conversation_scope
  const state = metadata.conversation_state
  if (!scope || typeof scope !== 'object' || !state || typeof state !== 'object') return false
  return Number(scope.tenant_id) === Number(tenantId)
    && Number(scope.integration_id) === Number(integrationId)
    && textFrom(scope.instance) === textFrom(instance)
    && textFrom(scope.sender_hash) === textFrom(senderHash)
    && textFrom(scope.environment).toLowerCase() === environment
    && Number(state.tenant_id) === Number(tenantId)
    && Number(state.integration_id) === Number(integrationId)
    && textFrom(state.instance) === textFrom(instance)
    && textFrom(state.sender_hash) === textFrom(senderHash)
    && textFrom(state.environment).toLowerCase() === environment
}

export function isSafePersistedReply({ intent, reply, metadata = {} }) {
  const value = textFrom(reply)
  if (!isAllowedAgentIntent(intent) || !value || value.length > 1000) return false
  if (metadata.mutation_allowed !== false || metadata.outbound_allowed !== false || metadata.mutation_blocked !== true || metadata.outbound_send !== false) return false
  if (/service_role|access_token|webhook_secret|authorization|api[_ -]?key|card[_ -]?token|password|secret/i.test(value)) return false
  if (/\b(insert|update|delete|drop|alter|truncate|create table|grant|revoke)\b/i.test(value)) return false
  // Reservation language is allowed for questions, availability and the
  // explicit-confirmation acknowledgement. Reject only a claim that a
  // booking mutation already happened (including equivalent verb forms).
  const mutationVerb = 'cread[oa]|creó|agendad[oa]|reservad[oa]|confirmad[oa]|modificad[oa]|cancelad[oa]|realizad[oa]'
  const bookingClaim = new RegExp(`\\b(reserva|turno)\\b.{0,48}\\b(${mutationVerb})\\b`, 'i').test(value)
    || new RegExp(`\\b(${mutationVerb})\\b.{0,48}\\b(reserva|turno)\\b`, 'i').test(value)
  const explicitNoMutation = new RegExp(`\\b(no|nunca|todavia no|aun no)\\b.{0,24}\\b(${mutationVerb})\\b`, 'i').test(value)
  if ((bookingClaim && !explicitNoMutation) || /\b(cobr|pag(ar|o)|invoice|preapproval|suscripci[oó]n)\b/i.test(value)) return false
  return true
}

export function agentOutboundGuard({
  enabled,
  runtimeValid,
  tenantAllowlisted,
  tenantId,
  environment,
  connectionState,
  integrationProvider,
  integrationType,
  integrationState,
  instance,
  sourceEventPresent,
  sourceEventReal,
  sourceTenantId,
  sourceIntegrationId,
  connectionIntegrationId,
  sourceInstance,
  sourceFromMe,
  sourceEnvironment,
  senderHashMatches,
  intent,
  proposedReply,
  sourceMetadata,
  operationAcquired,
  replyKind = 'proposal',
  bookingPersisted = false,
  expectedEnvironment = 'qa',
}) {
  if (runtimeValid !== true) return { allowed: false, reason: 'qa_shadow_runtime_required' }
  if (enabled !== true) return { allowed: false, reason: 'agent_outbound_pilot_disabled' }
  if (tenantAllowlisted !== true) return { allowed: false, reason: 'qa_tenant_not_allowlisted' }
  if (!Number.isSafeInteger(Number(tenantId)) || Number(tenantId) <= 0 || Number(sourceTenantId) !== Number(tenantId)) return { allowed: false, reason: 'qa_tenant_required' }
  if (!MANAGED_INSTANCE_PREFIXES[expectedEnvironment] || environment !== expectedEnvironment || sourceEnvironment !== expectedEnvironment) return { allowed: false, reason: 'qa_environment_required' }
  if (connectionState !== 'CONNECTED') return { allowed: false, reason: 'qa_connection_not_connected' }
  if (integrationProvider !== 'evolution' || integrationType !== 'whatsapp' || integrationState !== 'conectado') return { allowed: false, reason: 'qa_integration_not_connected' }
  if (instance !== qaAgentOutboundInstanceForTenant(tenantId, expectedEnvironment) || instance === PROTECTED_WHATSAPP_INSTANCE) return { allowed: false, reason: 'qa_instance_required' }
  if (textFrom(sourceInstance) !== textFrom(instance)) return { allowed: false, reason: 'qa_instance_required' }
  if (!Number.isSafeInteger(Number(sourceIntegrationId)) || !Number.isSafeInteger(Number(connectionIntegrationId)) || Number(sourceIntegrationId) !== Number(connectionIntegrationId)) return { allowed: false, reason: 'qa_integration_required' }
  if (sourceEventPresent !== true || sourceEventReal !== true) return { allowed: false, reason: 'real_persisted_source_required' }
  if (!isRealPersistedSourceMetadata(sourceMetadata, expectedEnvironment)) return { allowed: false, reason: 'real_persisted_source_required' }
  if (sourceFromMe === true) return { allowed: false, reason: 'from_me_ignored' }
  if (senderHashMatches !== true) return { allowed: false, reason: 'sender_not_allowlisted' }
  if (intent === 'price_query' && !hasAuthoritativePriceSource(sourceMetadata)) return { allowed: false, reason: 'price_source_required' }
  if (replyKind === 'booking_confirmation') {
    if (!isAllowedAgentIntent(intent) || !isSafeBookingConfirmationReply({ reply: proposedReply, bookingPersisted })) return { allowed: false, reason: 'unsafe_or_unpersisted_booking_confirmation' }
  } else if (replyKind === 'booking_slot_rejected') {
    // Tarea 41: aviso de horario rechazado, armado en el servidor y sólo sin turno guardado.
    if (!isAllowedAgentIntent(intent) || bookingPersisted !== false || !isSafeSlotRejectedReply(proposedReply)) return { allowed: false, reason: 'unsafe_slot_rejected_reply' }
  } else if (replyKind === 'booking_failed') {
    // Aviso fijo de reserva no guardada: sólo sin turno persistido.
    if (!isAllowedAgentIntent(intent) || bookingPersisted !== false || !isSafeBookingFailedReply(proposedReply)) return { allowed: false, reason: 'unsafe_booking_failed_reply' }
  } else if (!isSafePersistedReply({ intent, reply: proposedReply, metadata: sourceMetadata })) return { allowed: false, reason: 'unsafe_or_missing_proposed_reply' }
  if (operationAcquired !== true) return { allowed: false, reason: 'operation_already_claimed' }
  return { allowed: true, reason: null }
}
