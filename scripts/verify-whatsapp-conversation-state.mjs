import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  CONVERSATION_REQUIRED_FIELDS,
  CONVERSATION_TTL_MS,
  applyConfirmation,
  availabilityRecheck,
  buildBookingMutationContract,
  classifyConversationInput,
  conversationScope,
  createConversationState,
  deriveMissingFields,
  isConversationStateFresh,
  isConversationStateForScope,
  mergeConversationTurn,
  nextConversationAction,
  parseExplicitConfirmation,
  recordAvailabilityResult,
} from '../supabase/functions/_shared/whatsappConversationState.mjs'

const now = new Date('2026-08-27T15:00:00.000Z')
const scope = { tenantId: 1, integrationId: 1, instance: 'austral-qa-tenant-1', senderHash: 'sha256:0123456789ab', environment: 'qa' }
const base = createConversationState({ ...scope, now })

assert.deepEqual(conversationScope(scope), {
  tenant_id: 1,
  integration_id: 1,
  instance: 'austral-qa-tenant-1',
  sender_hash: 'sha256:0123456789ab',
  environment: 'qa',
})
assert.equal(base.conversation_id, 'wa-conversation:1:1:austral-qa-tenant-1:sha256:0123456789ab')
assert.deepEqual(deriveMissingFields(base), [...CONVERSATION_REQUIRED_FIELDS])
assert.equal(isConversationStateFresh(base, now), true)
assert.equal(new Date(base.expires_at).getTime() - now.getTime(), CONVERSATION_TTL_MS)
assert.equal(base.mutation_allowed, false)
assert.equal(base.ready_for_booking_mutation, false)

assert.equal(classifyConversationInput({ messageType: 'text', text: 'Hola' }).accepted, true)
for (const input of [
  { messageType: 'audio', text: '' },
  { messageType: 'image', text: '' },
  { messageType: 'document', text: '' },
  { messageType: 'sticker', text: '' },
  { messageType: 'text', text: '' },
  { messageType: 'text', text: 'Hola', isGroup: true },
  { messageType: 'text', text: 'Hola', isBroadcast: true },
  { messageType: 'text', text: 'Hola', fromMe: true },
  { text: 'Hola' },
]) assert.equal(classifyConversationInput(input).accepted, false)
assert.equal(classifyConversationInput({ messageType: 'weird', text: 'Hola' }).reason, 'unsupported_message_type')

const serviceTurn = mergeConversationTurn({ state: base, expectedScope: scope, eventId: 'evt-service', extracted: { pending_intent: 'booking_intent', service_id: 7 }, now })
assert.equal(serviceTurn.accepted, true)
assert.deepEqual(deriveMissingFields(serviceTurn.state), ['requested_date', 'requested_time'])
assert.equal(nextConversationAction(serviceTurn.state, { expectedScope: scope, now }).action, 'ask_date')
assert.equal(mergeConversationTurn({ state: base, expectedScope: scope, eventId: 'evt-unknown-intent', extracted: { pending_intent: 'unknown_intent' }, now }).reason, 'invalid_extracted_fields')

const dateTurn = mergeConversationTurn({ state: serviceTurn.state, expectedScope: scope, eventId: 'evt-date', extracted: { requested_date: '2026-08-28' }, now })
assert.equal(nextConversationAction(dateTurn.state, { expectedScope: scope, now }).action, 'ask_time')
const timeTurn = mergeConversationTurn({ state: dateTurn.state, expectedScope: scope, eventId: 'evt-time', extracted: { requested_time: '16:00', daypart: 'afternoon' }, now })
assert.deepEqual(deriveMissingFields(timeTurn.state), [])
assert.equal(nextConversationAction(timeTurn.state, { expectedScope: scope, now }).action, 'check_availability')

const availability = recordAvailabilityResult({ state: timeTurn.state, expectedScope: scope, source: 'authoritative_rpc', available: true, snapshotId: 'rpc-snapshot-1', now })
assert.equal(availability.accepted, true)
assert.equal(availability.state.confirmation_state, 'awaiting_confirmation')
assert.equal(nextConversationAction(availability.state, { expectedScope: scope, availabilityStatus: 'available', requestedSlotAvailable: true, now }).action, 'request_confirmation')
assert.equal(recordAvailabilityResult({ state: timeTurn.state, expectedScope: scope, source: 'client_claim', available: true, now }).reason, 'authoritative_availability_required')
assert.equal(recordAvailabilityResult({ state: timeTurn.state, expectedScope: scope, source: 'authoritative_rpc', available: true, now }).reason, 'availability_snapshot_required')

for (const [text, expected] of [['Sí', true], ['sí, confirmo', true], ['confirmar turno', true], ['dale', true], ['sí dale', true], ['bueno', true], ['perfecto', true], ['dale de una', true], ['ok', false], ['puede ser', false], ['creo que sí', false]]) {
  assert.equal(parseExplicitConfirmation(text), expected, `confirmation: ${text}`)
}
const confirmed = applyConfirmation({ state: availability.state, expectedScope: scope, text: 'Sí', eventId: 'evt-confirm', now, proposalVersion: availability.state.confirmation_version })
assert.equal(confirmed.accepted, true)
assert.equal(confirmed.state.confirmation_state, 'confirmed')
assert.equal(confirmed.state.ready_for_booking_mutation, true)
assert.equal(confirmed.state.mutation_allowed, false)
assert.equal(nextConversationAction(confirmed.state, { expectedScope: scope, now }).action, 'ready_for_booking_mutation')
assert.equal(applyConfirmation({ state: confirmed.state, expectedScope: scope, text: 'Sí', eventId: 'evt-confirm-2', now }).reason, 'confirmation_not_requested')
assert.equal(applyConfirmation({ state: availability.state, expectedScope: scope, text: 'Sí', eventId: 'evt-stale', now, proposalVersion: 1 }).reason, 'stale_proposal')

const duplicate = mergeConversationTurn({ state: serviceTurn.state, expectedScope: scope, eventId: 'evt-service', extracted: { service_id: 99 }, now })
assert.equal(duplicate.duplicate, true)
assert.equal(duplicate.state.service_id, 7)

const changedProposal = mergeConversationTurn({ state: availability.state, expectedScope: scope, eventId: 'evt-change', extracted: { requested_time: '17:00' }, now })
assert.equal(changedProposal.state.confirmation_state, 'collecting')
assert.equal(changedProposal.state.availability_snapshot_id, null)
assert.equal(applyConfirmation({ state: changedProposal.state, expectedScope: scope, text: 'Sí', eventId: 'evt-old-confirm', now }).reason, 'confirmation_not_requested')
const repeatedProposal = mergeConversationTurn({ state: availability.state, expectedScope: scope, eventId: 'evt-repeat', extracted: { requested_time: '16:00' }, now })
assert.equal(repeatedProposal.state.confirmation_state, 'collecting')
assert.equal(applyConfirmation({ state: repeatedProposal.state, expectedScope: scope, text: 'Sí', eventId: 'evt-repeat-confirm', now }).reason, 'confirmation_not_requested')

const expiredAt = new Date(now.getTime() + CONVERSATION_TTL_MS + 1)
assert.equal(isConversationStateFresh(confirmed.state, expiredAt), false)
assert.equal(nextConversationAction(confirmed.state, { expectedScope: scope, now: expiredAt }).action, 'restart_conversation')
const expiredTurn = mergeConversationTurn({ state: confirmed.state, expectedScope: scope, eventId: 'evt-expired', extracted: { requested_time: '18:00' }, now: expiredAt })
assert.equal(expiredTurn.reason, 'conversation_expired')
assert.equal(expiredTurn.state.confirmation_state, 'expired')
assert.equal(expiredTurn.state.service_id, null)
assert.equal(applyConfirmation({ state: confirmed.state, expectedScope: scope, text: 'Sí', eventId: 'evt-too-late', now: expiredAt }).reason, 'conversation_expired')

const recheck = availabilityRecheck({ state: confirmed.state, expectedScope: scope, source: 'authoritative_rpc', requestedSlotAvailable: true, now })
assert.equal(recheck.ready_for_booking_mutation, true)
assert.equal(recheck.mutation_allowed, false)
assert.equal(recheck.booking_mutation_allowed, false)
assert.equal(availabilityRecheck({ state: confirmed.state, expectedScope: scope, source: 'authoritative_rpc', requestedSlotAvailable: false, now }).reason, 'slot_changed')
assert.equal(availabilityRecheck({ state: confirmed.state, expectedScope: scope, source: 'frontend', requestedSlotAvailable: true, now }).reason, 'authoritative_availability_required')
assert.equal(availabilityRecheck({ state: confirmed.state, expectedScope: scope, source: 'authoritative_rpc', requestedSlotAvailable: true, now: expiredAt }).reason, 'conversation_expired')

const contract = buildBookingMutationContract({ state: confirmed.state, recheck })
assert.equal(contract.ready_for_booking_mutation, true)
assert.equal(contract.mutation_allowed, false)
assert.equal(contract.booking_mutation_executed, false)
assert.deepEqual(contract.sequence, ['mutation_claim', 'authoritative_availability_recheck', 'authoritative_booking_rpc', 'idempotent_result', 'reply'])

for (const invalid of [
  { ...scope, instance: 'miwsp' },
  { ...scope, senderHash: 'raw-number' },
  { ...scope, tenantId: 0 },
  { ...scope, environment: 'production' },
]) assert.throws(() => conversationScope(invalid), TypeError)

const tenantB = createConversationState({ tenantId: 2, integrationId: 2, instance: 'austral-qa-tenant-2', senderHash: scope.senderHash, now })
assert.notEqual(tenantB.conversation_id, base.conversation_id)
assert.equal(tenantB.tenant_id, 2)
assert.equal(tenantB.sender_hash, base.sender_hash)
const tampered = { ...base, tenant_id: 2 }
assert.equal(isConversationStateForScope(tampered, scope), false)
assert.equal(mergeConversationTurn({ state: tampered, expectedScope: scope, eventId: 'evt-tampered', extracted: {}, now }).reason, 'conversation_scope_invalid')
assert.equal(availabilityRecheck({ state: tampered, expectedScope: scope, requestedSlotAvailable: true, now }).reason, 'conversation_scope_invalid')

const helperSource = fs.readFileSync(new URL('../supabase/functions/_shared/whatsappConversationState.mjs', import.meta.url), 'utf8')
assert.doesNotMatch(helperSource, /crear_reserva_whatsapp|insert\s+into|sendText|fetch\s*\(/i)
assert.match(helperSource, /mutation_allowed:\s*false/)
assert.match(helperSource, /authoritative_rpc/)

console.log(JSON.stringify({
  contract: 'deterministic_tenant_scoped_conversation_state',
  ttl_minutes: CONVERSATION_TTL_MS / 60000,
  required_fields: CONVERSATION_REQUIRED_FIELDS,
  confirmation: 'explicit_current_proposal_only',
  availability: 'authoritative_recheck_required',
  idempotency: 'duplicate_event_and_confirmation_safe',
  mutation_allowed: false,
  booking_mutation_executed: false,
  result: 'PASS',
}))
