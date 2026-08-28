import assert from 'node:assert/strict'
import {
  advanceConversationTurn,
  buildConversationProposal,
  extractConversationTurn,
} from '../supabase/functions/_shared/whatsappConversationRuntime.mjs'
import { recordAvailabilityResult } from '../supabase/functions/_shared/whatsappConversationState.mjs'

const now = new Date('2026-08-28T12:00:00.000Z')
const scope = { tenantId: 1, integrationId: 1, instance: 'austral-qa-tenant-1', senderHash: 'sha256:0123456789ab', environment: 'qa' }
const services = [{ id: 1, nombre: 'E2E_QA_A_SERVICIO', activo: true }]
const timezone = 'America/Argentina/Buenos_Aires'

const first = advanceConversationTurn({ scope, eventId: 'evt-1', text: 'Quiero reservar', services, timezone, now })
assert.equal(first.accepted, true)
assert.equal(first.intent, 'booking_intent')
assert.equal(first.action.action, 'ask_service')
assert.equal(first.state.pending_intent, 'booking_intent')
assert.equal(first.state.mutation_allowed, false)

const second = advanceConversationTurn({ state: first.state, scope, eventId: 'evt-2', text: 'E2E_QA_A_SERVICIO', services, timezone, now })
assert.equal(second.action.action, 'ask_date')
assert.equal(second.state.service_id, 1)

const third = advanceConversationTurn({ state: second.state, scope, eventId: 'evt-3', text: 'mañana', services, timezone, now })
assert.equal(third.action.action, 'ask_time')
assert.equal(third.state.requested_date, '2026-08-29')

const fourth = advanceConversationTurn({ state: third.state, scope, eventId: 'evt-4', text: '16', services, timezone, now })
assert.equal(fourth.action.action, 'check_availability')
assert.equal(fourth.state.requested_time, '16:00')
assert.equal(fourth.state.daypart, 'afternoon')

const available = recordAvailabilityResult({ state: fourth.state, expectedScope: scope, source: 'authoritative_rpc', available: true, snapshotId: 'rpc:evt-4', proposalId: `proposal:${fourth.state.conversation_id}:${fourth.state.version}`, now })
assert.equal(available.accepted, true)
assert.equal(available.state.confirmation_state, 'awaiting_confirmation')
const confirmationProposal = buildConversationProposal({ state: available.state, action: { action: 'request_confirmation' }, services, businessName: 'E2E QA' })
assert.match(confirmationProposal.proposed_reply, /16:00/)
assert.match(confirmationProposal.proposed_reply, /confirm/i)
assert.equal(confirmationProposal.mutation_allowed, false)

const fifth = advanceConversationTurn({ state: available.state, scope, eventId: 'evt-5', text: 'Sí', services, timezone, now })
assert.equal(fifth.accepted, true)
assert.equal(fifth.confirmed, true)
assert.equal(fifth.action.action, 'ready_for_booking_mutation')
assert.equal(fifth.state.ready_for_booking_mutation, true)
assert.equal(fifth.state.mutation_allowed, false)
const confirmedProposal = buildConversationProposal({ state: fifth.state, action: fifth.action, services, businessName: 'E2E QA' })
assert.doesNotMatch(confirmedProposal.proposed_reply, /reservad[oa]|cread[oa]/i)

const duplicate = advanceConversationTurn({ state: fifth.state, scope, eventId: 'evt-5', text: 'Sí', services, timezone, now })
assert.equal(duplicate.accepted, false)
assert.equal(duplicate.duplicate, true)

const expiredConfirmation = advanceConversationTurn({ state: available.state, scope, eventId: 'evt-expired', text: 'Sí', services, timezone, now: new Date(now.getTime() + 31 * 60 * 1000) })
assert.equal(expiredConfirmation.accepted, false)
assert.equal(expiredConfirmation.reason, 'conversation_expired')

const wrongScope = advanceConversationTurn({ state: first.state, scope: { ...scope, tenantId: 2 }, eventId: 'evt-wrong-tenant', text: 'E2E_QA_A_SERVICIO', services, timezone, now })
assert.equal(wrongScope.accepted, false)
assert.equal(wrongScope.reason, 'conversation_scope_invalid')

const extracted = extractConversationTurn({ text: 'mañana a las 4 de la tarde', pendingIntent: 'booking_intent', services, timezone, now })
assert.equal(extracted.fields.requested_date, '2026-08-29')
assert.equal(extracted.fields.requested_time, '16:00')
assert.equal(extracted.fields.daypart, 'afternoon')

console.log(JSON.stringify({
  state_machine: ['collecting', 'awaiting_confirmation', 'confirmed'],
  transitions: ['booking_intent', 'service', 'date', 'time', 'authoritative_availability', 'explicit_confirmation'],
  ttl_minutes: 30,
  mutation_allowed: false,
  booking_created: false,
  result: 'PASS',
}))
