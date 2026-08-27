export const QA_AGENT_OUTBOUND_TENANT_ID = 1
export const QA_AGENT_OUTBOUND_INSTANCE = 'austral-qa-tenant-1'
export const QA_AGENT_OUTBOUND_ALLOWED_INTENTS = Object.freeze(['services_query', 'availability_query', 'general_query'])
export const PROTECTED_WHATSAPP_INSTANCE = 'miwsp'

const textFrom = (value) => String(value ?? '').trim()
const allowedIntents = new Set(QA_AGENT_OUTBOUND_ALLOWED_INTENTS)

export function buildAgentOutboundOperationId(eventId) {
  const clean = textFrom(eventId).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160)
  return clean ? `agent-outbound:${clean}` : null
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

export function isRealPersistedSourceMetadata(metadata = {}) {
  return metadata.source === 'evolution'
    && metadata.event === 'MESSAGES_UPSERT'
    && metadata.environment === 'qa'
    && metadata.from_me === false
    && metadata.mutation_allowed === false
    && metadata.outbound_allowed === false
    && metadata.mutation_blocked === true
    && metadata.outbound_send === false
}

export function isSafePersistedReply({ intent, reply, metadata = {} }) {
  const value = textFrom(reply)
  if (!isAllowedAgentIntent(intent) || !value || value.length > 1000) return false
  if (metadata.mutation_allowed !== false || metadata.outbound_allowed !== false || metadata.mutation_blocked !== true || metadata.outbound_send !== false) return false
  if (/service_role|access_token|webhook_secret|authorization|api[_ -]?key|card[_ -]?token|password|secret/i.test(value)) return false
  if (/\b(insert|update|delete|drop|alter|truncate|create table|grant|revoke)\b/i.test(value)) return false
  if (/\b(reserv(ar|a)|cre(ar|ó)|modific|cancel|cobr|pag(ar|o)|invoice|preapproval|suscripci[oó]n)\b/i.test(value)) return false
  return true
}

export function agentOutboundGuard({
  enabled,
  runtimeValid,
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
  sourceFromMe,
  sourceEnvironment,
  senderHashMatches,
  intent,
  proposedReply,
  sourceMetadata,
  operationAcquired,
}) {
  if (runtimeValid !== true) return { allowed: false, reason: 'qa_shadow_runtime_required' }
  if (enabled !== true) return { allowed: false, reason: 'agent_outbound_pilot_disabled' }
  if (tenantId !== QA_AGENT_OUTBOUND_TENANT_ID || sourceTenantId !== QA_AGENT_OUTBOUND_TENANT_ID) return { allowed: false, reason: 'qa_tenant_required' }
  if (environment !== 'qa' || sourceEnvironment !== 'qa') return { allowed: false, reason: 'qa_environment_required' }
  if (connectionState !== 'CONNECTED') return { allowed: false, reason: 'qa_connection_not_connected' }
  if (integrationProvider !== 'evolution' || integrationType !== 'whatsapp' || integrationState !== 'conectado') return { allowed: false, reason: 'qa_integration_not_connected' }
  if (instance !== QA_AGENT_OUTBOUND_INSTANCE || instance === PROTECTED_WHATSAPP_INSTANCE) return { allowed: false, reason: 'qa_instance_required' }
  if (sourceIntegrationId !== undefined && sourceIntegrationId !== null && sourceIntegrationId !== 1) return { allowed: false, reason: 'qa_integration_required' }
  if (sourceEventPresent !== true || sourceEventReal !== true) return { allowed: false, reason: 'real_persisted_source_required' }
  if (!isRealPersistedSourceMetadata(sourceMetadata)) return { allowed: false, reason: 'real_persisted_source_required' }
  if (sourceFromMe === true) return { allowed: false, reason: 'from_me_ignored' }
  if (senderHashMatches !== true) return { allowed: false, reason: 'sender_not_allowlisted' }
  if (!isSafePersistedReply({ intent, reply: proposedReply, metadata: sourceMetadata })) return { allowed: false, reason: 'unsafe_or_missing_proposed_reply' }
  if (operationAcquired !== true) return { allowed: false, reason: 'operation_already_claimed' }
  return { allowed: true, reason: null }
}
