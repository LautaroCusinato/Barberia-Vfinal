import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  QA_AGENT_OUTBOUND_ALLOWED_INTENTS,
  QA_AGENT_OUTBOUND_INSTANCE,
  agentOutboundGuard,
  buildAgentOutboundOperationId,
  isAllowedAgentIntent,
  isPersistedConversationScope,
  isRealPersistedSourceMetadata,
  isQaAgentOutboundRuntime,
  isSafePersistedReply,
} from '../supabase/functions/_shared/whatsappAgentOutboundPilot.mjs'

const metadata = { source: 'evolution', event: 'MESSAGES_UPSERT', environment: 'qa', from_me: false, mutation_allowed: false, outbound_allowed: false, mutation_blocked: true, outbound_send: false }
const base = {
  enabled: true,
  runtimeValid: true,
  tenantId: 1,
  environment: 'qa',
  connectionState: 'CONNECTED',
  integrationProvider: 'evolution',
  integrationType: 'whatsapp',
  integrationState: 'conectado',
  instance: QA_AGENT_OUTBOUND_INSTANCE,
  sourceEventPresent: true,
  sourceEventReal: true,
  sourceTenantId: 1,
  sourceIntegrationId: 1,
  sourceFromMe: false,
  sourceEnvironment: 'qa',
  senderHashMatches: true,
  intent: 'general_query',
  proposedReply: 'Hola. Puedo ayudarte con información de servicios.',
  sourceMetadata: metadata,
  operationAcquired: true,
}

assert.deepEqual(QA_AGENT_OUTBOUND_ALLOWED_INTENTS, ['services_query', 'availability_query', 'general_query', 'booking_intent'])
assert.equal(buildAgentOutboundOperationId('evt-1'), 'agent-outbound:evt-1')
assert.equal(isQaAgentOutboundRuntime({ projectRef: 'cmsymmszlzikqpvfqjre', provisioningEnv: 'qa', whatsappMode: 'shadow', pilotMode: 'shadow' }), true)
assert.equal(isQaAgentOutboundRuntime({ projectRef: 'ssagttjdgtypxjcgdnrw', provisioningEnv: 'qa', whatsappMode: 'shadow', pilotMode: 'shadow' }), false)
assert.equal(isRealPersistedSourceMetadata(metadata), true)
assert.equal(isRealPersistedSourceMetadata({ ...metadata, from_me: true }), false)

for (const intent of QA_AGENT_OUTBOUND_ALLOWED_INTENTS) assert.equal(isAllowedAgentIntent(intent), true)
for (const intent of ['booking_change_request', 'price_query', '']) assert.equal(isAllowedAgentIntent(intent), false)
assert.equal(isSafePersistedReply({ intent: 'services_query', reply: 'Tenemos corte y barba.', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'availability_query', reply: 'Sí, el jueves hay horarios disponibles.', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'general_query', reply: 'Hola. ¿En qué te ayudo?', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'booking_intent', reply: 'La reserva fue creada.', metadata }), false)
assert.equal(isSafePersistedReply({ intent: 'services_query', reply: 'Usá el service_role token.', metadata }), false)
assert.equal(isSafePersistedReply({ intent: 'services_query', reply: 'INSERT INTO clientes...', metadata }), false)
assert.equal(isSafePersistedReply({ intent: 'booking_intent', reply: '¿Qué servicio querés reservar?', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'booking_intent', reply: 'Perfecto, tengo los datos confirmados.', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'booking_intent', reply: 'Tu turno fue confirmado.', metadata }), false)
const conversationMetadata = {
  ...metadata,
  instance: QA_AGENT_OUTBOUND_INSTANCE,
  conversation_scope: { tenant_id: 1, integration_id: 1, instance: QA_AGENT_OUTBOUND_INSTANCE, sender_hash: 'sha256:0123456789ab', environment: 'qa' },
  conversation_state: { tenant_id: 1, integration_id: 1, instance: QA_AGENT_OUTBOUND_INSTANCE, sender_hash: 'sha256:0123456789ab', environment: 'qa' },
}
assert.equal(isPersistedConversationScope(conversationMetadata, { tenantId: 1, integrationId: 1, instance: QA_AGENT_OUTBOUND_INSTANCE, senderHash: 'sha256:0123456789ab' }), true)
assert.equal(isPersistedConversationScope(conversationMetadata, { tenantId: 2, integrationId: 1, instance: QA_AGENT_OUTBOUND_INSTANCE, senderHash: 'sha256:0123456789ab' }), false)
assert.equal(agentOutboundGuard(base).allowed, true)
assert.equal(agentOutboundGuard({ ...base, sourceMetadata: { ...metadata, mutation_allowed: true } }).reason, 'real_persisted_source_required')
assert.equal(agentOutboundGuard({ ...base, sourceMetadata: { ...metadata, outbound_send: true } }).reason, 'real_persisted_source_required')
assert.equal(agentOutboundGuard({ ...base, sourceMetadata: { ...metadata, environment: 'production' } }).reason, 'real_persisted_source_required')

for (const [key, value, reason] of [
  ['enabled', false, 'agent_outbound_pilot_disabled'],
  ['tenantId', 2, 'qa_tenant_required'],
  ['sourceTenantId', 2, 'qa_tenant_required'],
  ['environment', 'production', 'qa_environment_required'],
  ['connectionState', 'DISCONNECTED', 'qa_connection_not_connected'],
  ['integrationProvider', 'other', 'qa_integration_not_connected'],
  ['integrationType', 'api', 'qa_integration_not_connected'],
  ['integrationState', 'desactivado', 'qa_integration_not_connected'],
  ['instance', 'miwsp', 'qa_instance_required'],
  ['sourceFromMe', true, 'from_me_ignored'],
  ['sourceEventPresent', false, 'real_persisted_source_required'],
  ['sourceEventReal', false, 'real_persisted_source_required'],
  ['sourceMetadata', { ...metadata, event: 'OTHER' }, 'real_persisted_source_required'],
  ['sourceEnvironment', 'production', 'qa_environment_required'],
  ['senderHashMatches', false, 'sender_not_allowlisted'],
  ['intent', 'booking_change_request', 'unsafe_or_missing_proposed_reply'],
  ['proposedReply', '', 'unsafe_or_missing_proposed_reply'],
  ['operationAcquired', false, 'operation_already_claimed'],
]) {
  assert.equal(agentOutboundGuard({ ...base, [key]: value }).reason, reason, `${key} guard`)
}

const oneShotSource = fs.readFileSync(new URL('../supabase/functions/whatsapp-agent-outbound-pilot/index.ts', import.meta.url), 'utf8')
assert.match(oneShotSource, /event_id_only/)
assert.match(oneShotSource, /saas_automation_shadow_runs/)
assert.match(oneShotSource, /\.eq\('tenant_id', QA_AGENT_OUTBOUND_TENANT_ID\)/)
assert.match(oneShotSource, /\.eq\('integration_id', connection\.integration_id\)/)
assert.match(oneShotSource, /\.eq\('event_id', eventId\)/)
assert.match(oneShotSource, /claim_whatsapp_event/)
assert.match(oneShotSource, /finish_whatsapp_event/)
assert.match(oneShotSource, /buildEvolutionSendTextPath/)
assert.match(oneShotSource, /JSON\.stringify\(\{ number: recipient, text: proposedReply \}\)/)
assert.doesNotMatch(oneShotSource, /textMessage\s*:/)
assert.doesNotMatch(oneShotSource, /setTimeout|retryFetch|fetchWithRetry/i)
assert.doesNotMatch(oneShotSource, /number\s*:\s*body|remoteJid|tenant_id\s*:\s*body|instance\s*:\s*body/i)
assert.match(oneShotSource, /qa_recipient_not_configured/)
assert.match(oneShotSource, /WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED/)
assert.match(oneShotSource, /PROTECTED_WHATSAPP_INSTANCE/)

console.log(JSON.stringify({
  architecture: 'isolated_event_reference_agent_outbound',
  allowed_intents: QA_AGENT_OUTBOUND_ALLOWED_INTENTS,
  mutation_allowed: false,
  public_payload: ['event_id'],
  provider_contract: 'POST /message/sendText/{instance} with {number,text}',
  retries: false,
  result: 'PASS',
}))
