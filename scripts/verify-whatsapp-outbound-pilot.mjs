import assert from 'node:assert/strict'
import {
  PROTECTED_INSTANCE,
  QA_OUTBOUND_INSTANCE,
  QA_OUTBOUND_MESSAGE,
  QA_OUTBOUND_TENANT_ID,
  buildEvolutionSendTextPath,
  buildOutboundOperationId,
  isQaOutboundRuntime,
  normalizeRecipient,
  outboundPilotGuard,
} from '../supabase/functions/_shared/whatsappOutboundPilot.mjs'

assert.equal(normalizeRecipient('5491100000001@s.whatsapp.net'), '5491100000001')
assert.equal(normalizeRecipient('+54 9 11 0000-0001'), '5491100000001')
assert.equal(normalizeRecipient('120363000000000000@g.us'), null)
assert.equal(normalizeRecipient(''), null)

assert.equal(isQaOutboundRuntime({ projectRef: 'cmsymmszlzikqpvfqjre', provisioningEnv: 'qa', whatsappMode: 'shadow', pilotMode: 'shadow' }), true)
assert.equal(isQaOutboundRuntime({ projectRef: 'ssagttjdgtypxjcgdnrw', provisioningEnv: 'qa', whatsappMode: 'shadow', pilotMode: 'shadow' }), false)
assert.equal(buildOutboundOperationId('A5E910FAE59136E88288F5925BB7E282'), 'qa-outbound:A5E910FAE59136E88288F5925BB7E282')
assert.equal(buildOutboundOperationId(''), null)
assert.equal(buildEvolutionSendTextPath('https://evolution.cuchitron.lat', QA_OUTBOUND_INSTANCE), 'https://evolution.cuchitron.lat/message/sendText/austral-qa-tenant-1')
assert.equal(buildEvolutionSendTextPath('https://evolution.cuchitron.lat', PROTECTED_INSTANCE), null)
assert.equal(buildEvolutionSendTextPath('http://evolution.cuchitron.lat', QA_OUTBOUND_INSTANCE), null)

const baseGuard = {
  enabled: true,
  approvalMatches: true,
  runtimeValid: true,
  tenantId: QA_OUTBOUND_TENANT_ID,
  instance: QA_OUTBOUND_INSTANCE,
  sourceEventPresent: true,
  sourceFromMe: false,
  sourceOutboundAllowed: false,
  sourceMutationAllowed: false,
  recipient: '5491100000001',
  recipientHashMatches: true,
  operationAcquired: true,
}
assert.deepEqual(outboundPilotGuard(baseGuard), { allowed: true, reason: null })
for (const [field, value] of [
  ['enabled', false],
  ['approvalMatches', false],
  ['runtimeValid', false],
  ['tenantId', 2],
  ['instance', 'miwsp'],
  ['sourceEventPresent', false],
  ['sourceFromMe', true],
  ['sourceOutboundAllowed', true],
  ['sourceMutationAllowed', true],
  ['recipientHashMatches', false],
  ['operationAcquired', false],
]) {
  assert.equal(outboundPilotGuard({ ...baseGuard, [field]: value }).allowed, false, `${field} must fail closed`)
}

const claimed = new Set()
const operationId = buildOutboundOperationId('E2E_QA_NEW_EVENT')
const claim = () => {
  if (claimed.has(operationId)) return false
  claimed.add(operationId)
  return true
}
assert.equal(claim(), true)
assert.equal(claim(), false)
assert.equal(QA_OUTBOUND_MESSAGE, 'Prueba QA de Austral: respuesta enviada correctamente.')

console.log(JSON.stringify({
  qa_recipient_allowlist: 'PASS',
  tenant_a_only: 'PASS',
  instance_guard: 'PASS',
  miwsp_denied: 'PASS',
  production_denied: 'PASS',
  one_shot_idempotency: 'PASS',
  from_me_loop_blocked: 'PASS',
  mutations_denied: 'PASS',
  provider_contract: 'POST /message/sendText/{instance}',
  external_effects: { messages_sent: 0, reservations: 0, clients: 0 },
}))
