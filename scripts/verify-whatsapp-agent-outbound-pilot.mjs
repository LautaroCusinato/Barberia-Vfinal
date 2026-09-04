import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  QA_AGENT_OUTBOUND_ALLOWED_INTENTS,
  agentOutboundGuard,
  buildAgentOutboundOperationId,
  isQaAgentOutboundTenantAllowed,
  isAllowedAgentIntent,
  isPersistedConversationScope,
  isRealPersistedSourceMetadata,
  isQaAgentOutboundRuntime,
  hasAuthoritativePriceSource,
  isSafePersistedReply,
  parseQaAgentOutboundTenantAllowlist,
  qaAgentOutboundInstanceForTenant,
} from '../supabase/functions/_shared/whatsappAgentOutboundPilot.mjs'
import { buildQaEvolutionSendTextPath } from '../supabase/functions/_shared/whatsappOutboundPilot.mjs'

const tenantId = 819
const integrationId = 36
const instance = qaAgentOutboundInstanceForTenant(tenantId)
const metadata = { source: 'evolution', event: 'MESSAGES_UPSERT', environment: 'qa', from_me: false, instance, mutation_allowed: false, outbound_allowed: false, mutation_blocked: true, outbound_send: false }
const base = {
  enabled: true,
  runtimeValid: true,
  tenantAllowlisted: true,
  tenantId,
  environment: 'qa',
  connectionState: 'CONNECTED',
  integrationProvider: 'evolution',
  integrationType: 'whatsapp',
  integrationState: 'conectado',
  instance,
  sourceEventPresent: true,
  sourceEventReal: true,
  sourceTenantId: tenantId,
  sourceIntegrationId: integrationId,
  connectionIntegrationId: integrationId,
  sourceInstance: instance,
  sourceFromMe: false,
  sourceEnvironment: 'qa',
  senderHashMatches: true,
  intent: 'general_query',
  proposedReply: 'Hola. Puedo ayudarte con información de servicios.',
  sourceMetadata: metadata,
  operationAcquired: true,
}

assert.deepEqual(QA_AGENT_OUTBOUND_ALLOWED_INTENTS, ['services_query', 'price_query', 'availability_query', 'general_query', 'booking_intent'])
assert.equal(buildAgentOutboundOperationId('evt-1'), 'agent-outbound:evt-1')
assert.deepEqual(parseQaAgentOutboundTenantAllowlist('819, 819, 0, nope, 1'), [819, 1])
assert.equal(isQaAgentOutboundTenantAllowed(819, [819]), true)
assert.equal(isQaAgentOutboundTenantAllowed(1, [819]), false)
assert.equal(qaAgentOutboundInstanceForTenant(819), 'austral-qa-tenant-819')
assert.equal(qaAgentOutboundInstanceForTenant('nope'), null)
assert.match(buildQaEvolutionSendTextPath('https://evolution.cuchitron.lat', instance), /austral-qa-tenant-819$/)
assert.match(buildQaEvolutionSendTextPath('https://evolution.cuchitron.lat', 'austral-qa-tenant-1'), /\/message\/sendText\/austral-qa-tenant-1$/)
assert.equal(buildQaEvolutionSendTextPath('https://evolution.cuchitron.lat', 'miwsp'), null)
assert.equal(buildQaEvolutionSendTextPath('https://evolution.cuchitron.lat', 'arbitrary'), null)
assert.equal(isQaAgentOutboundRuntime({ projectRef: 'cmsymmszlzikqpvfqjre', provisioningEnv: 'qa', whatsappMode: 'shadow', pilotMode: 'shadow' }), true)
assert.equal(isQaAgentOutboundRuntime({ projectRef: 'ssagttjdgtypxjcgdnrw', provisioningEnv: 'qa', whatsappMode: 'shadow', pilotMode: 'shadow' }), false)
assert.equal(isRealPersistedSourceMetadata(metadata), true)
assert.equal(isRealPersistedSourceMetadata({ ...metadata, from_me: true }), false)

for (const intent of QA_AGENT_OUTBOUND_ALLOWED_INTENTS) assert.equal(isAllowedAgentIntent(intent), true)
for (const intent of ['booking_change_request', '']) assert.equal(isAllowedAgentIntent(intent), false)
assert.equal(isAllowedAgentIntent('price_query'), true)
assert.equal(isSafePersistedReply({ intent: 'services_query', reply: 'Tenemos corte y barba.', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'availability_query', reply: 'Sí, el jueves hay horarios disponibles.', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'general_query', reply: 'Hola. ¿En qué te ayudo?', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'booking_intent', reply: 'La reserva fue creada.', metadata }), false)
assert.equal(isSafePersistedReply({ intent: 'services_query', reply: 'Usá el service_role token.', metadata }), false)
assert.equal(isSafePersistedReply({ intent: 'services_query', reply: 'INSERT INTO clientes...', metadata }), false)
assert.equal(isSafePersistedReply({ intent: 'booking_intent', reply: '¿Qué servicio querés reservar?', metadata }), true)
assert.equal(isSafePersistedReply({ intent: 'booking_intent', reply: 'Perfecto, tengo los datos confirmados.', metadata }), true)
const authoritativePriceMetadata = {
  ...metadata,
  agent: { provider: 'qa_deterministic_shadow', tools_considered: ['tenant_context_read', 'services_read'], context_counts: { services: 1 } },
}
assert.equal(hasAuthoritativePriceSource(authoritativePriceMetadata), true)
assert.equal(hasAuthoritativePriceSource(metadata), false)
assert.equal(isSafePersistedReply({ intent: 'booking_intent', reply: 'Tu turno fue confirmado.', metadata }), false)
const conversationMetadata = {
  ...metadata,
  conversation_scope: { tenant_id: tenantId, integration_id: integrationId, instance, sender_hash: 'sha256:0123456789ab', environment: 'qa' },
  conversation_state: { tenant_id: tenantId, integration_id: integrationId, instance, sender_hash: 'sha256:0123456789ab', environment: 'qa' },
}
assert.equal(isPersistedConversationScope(conversationMetadata, { tenantId, integrationId, instance, senderHash: 'sha256:0123456789ab' }), true)
assert.equal(isPersistedConversationScope(conversationMetadata, { tenantId: 2, integrationId, instance, senderHash: 'sha256:0123456789ab' }), false)
assert.equal(agentOutboundGuard(base).allowed, true)
const priceBase = {
  ...base,
  intent: 'price_query',
  proposedReply: 'El Corte clásico sale ARS 30.000.',
  sourceMetadata: authoritativePriceMetadata,
}
assert.equal(agentOutboundGuard(priceBase).allowed, true)
assert.equal(agentOutboundGuard({ ...priceBase, sourceMetadata: metadata }).reason, 'price_source_required')
assert.equal(agentOutboundGuard({ ...priceBase, sourceMetadata: { ...authoritativePriceMetadata, agent: { ...authoritativePriceMetadata.agent, provider: 'deepseek' } } }).reason, 'price_source_required')
assert.equal(agentOutboundGuard({ ...priceBase, proposedReply: '' }).reason, 'unsafe_or_missing_proposed_reply')
assert.equal(agentOutboundGuard({ ...base, sourceMetadata: { ...metadata, mutation_allowed: true } }).reason, 'real_persisted_source_required')
assert.equal(agentOutboundGuard({ ...base, sourceMetadata: { ...metadata, outbound_send: true } }).reason, 'real_persisted_source_required')
assert.equal(agentOutboundGuard({ ...base, sourceMetadata: { ...metadata, environment: 'production' } }).reason, 'real_persisted_source_required')

for (const [key, value, reason] of [
  ['enabled', false, 'agent_outbound_pilot_disabled'],
  ['tenantAllowlisted', false, 'qa_tenant_not_allowlisted'],
  ['tenantId', 2, 'qa_tenant_required'],
  ['sourceTenantId', 2, 'qa_tenant_required'],
  ['environment', 'production', 'qa_environment_required'],
  ['connectionState', 'DISCONNECTED', 'qa_connection_not_connected'],
  ['integrationProvider', 'other', 'qa_integration_not_connected'],
  ['integrationType', 'api', 'qa_integration_not_connected'],
  ['integrationState', 'desactivado', 'qa_integration_not_connected'],
  ['instance', 'miwsp', 'qa_instance_required'],
  ['sourceInstance', 'austral-qa-tenant-1', 'qa_instance_required'],
  ['sourceInstance', undefined, 'qa_instance_required'],
  ['sourceIntegrationId', 1, 'qa_integration_required'],
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
assert.match(oneShotSource, /WHATSAPP_AGENT_OUTBOUND_ALLOWED_TENANT_IDS/)
assert.match(oneShotSource, /parseQaAgentOutboundTenantAllowlist/)
assert.match(oneShotSource, /qaAgentOutboundInstanceForTenant/)
assert.match(oneShotSource, /\.eq\('integration_id', integrationId\)/)
assert.match(oneShotSource, /\.eq\('event_id', eventId\)/)
assert.match(oneShotSource, /claim_whatsapp_event/)
assert.match(oneShotSource, /finish_whatsapp_event/)
assert.match(oneShotSource, /buildQaEvolutionSendTextPath/)
assert.doesNotMatch(oneShotSource, /QA_AGENT_OUTBOUND_TENANT_ID|QA_AGENT_OUTBOUND_INSTANCE/)
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
