import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  QA_BOOKING_MUTATION_INSTANCE,
  QA_BOOKING_MUTATION_TENANT_ID,
  QA_BOOKING_MUTATION_PROMPT_VERSION,
  bookingMutationGuard,
  buildBookingClaimEventId,
  buildBookingMutationContract,
  isConfirmedBookingState,
  isQaBookingMutationRuntime,
  normalizePhone,
  selectAuthoritativeSlot,
} from '../supabase/functions/_shared/whatsappBookingMutation.mjs'
import { isConversationStateFresh } from '../supabase/functions/_shared/whatsappConversationState.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const functionSource = fs.readFileSync(path.join(root, 'supabase/functions/whatsapp-booking-mutation/index.ts'), 'utf8')
const publicBookingMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260731210000_public_booking.sql'), 'utf8')
const whatsappBookingMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260806150000_multitenant_whatsapp_contract.sql'), 'utf8')

const state = {
  tenant_id: 1,
  integration_id: 1,
  instance: QA_BOOKING_MUTATION_INSTANCE,
  environment: 'qa',
  sender_hash: 'sha256:0123456789ab',
  conversation_id: 'wa-conversation:1:1:austral-qa-tenant-1:sha256:0123456789ab',
  version: 4,
  confirmation_version: 4,
  confirmation_state: 'confirmed',
  confirmation_required: false,
  ready_for_booking_mutation: true,
  mutation_allowed: false,
  last_event_id: 'event-confirmed',
  service_id: 1,
  requested_date: '2099-01-03',
  requested_time: '16:00',
  barber_id: 1,
  expires_at: '2099-01-04T00:00:00.000Z',
}

assert.equal(isQaBookingMutationRuntime({ projectRef: 'cmsymmszlzikqpvfqjre', provisioningEnv: 'qa', whatsappMode: 'shadow', pilotMode: 'shadow' }), true)
assert.equal(isQaBookingMutationRuntime({ projectRef: 'ssagttjdgtypxjcgdnrw', provisioningEnv: 'qa', whatsappMode: 'shadow', pilotMode: 'shadow' }), false)
assert.equal(normalizePhone('+54 9 11 1234-5678@s.whatsapp.net'), '5491112345678')
assert.equal(normalizePhone('not-a-number'), null)
assert.equal(buildBookingClaimEventId(state), 'booking:wa-conversation:1:1:austral-qa-tenant-1:sha256:0123456789ab:4')
assert.equal(isConfirmedBookingState(state, 'event-confirmed'), true)
assert.equal(isConversationStateFresh(state), true)
assert.equal(isConversationStateFresh({ ...state, expires_at: '2000-01-01T00:00:00.000Z' }), false)
assert.equal(isConfirmedBookingState({ ...state, confirmation_state: 'awaiting_confirmation' }, 'event-confirmed'), false)
assert.equal(isConfirmedBookingState({ ...state, last_event_id: 'other-event' }, 'event-confirmed'), false)
assert.equal(QA_BOOKING_MUTATION_PROMPT_VERSION, 'natural-v2')

const slots = [
  { service_id: 1, barbero_id: 1, hora: '16:00:00' },
  { service_id: 1, barbero_id: 1, hora: '16:15:00' },
]
assert.equal(selectAuthoritativeSlot(slots, state).allowed, true)
assert.equal(selectAuthoritativeSlot(slots, { ...state, requested_time: '17:00' }).reason, 'slot_unavailable_after_recheck')
assert.equal(selectAuthoritativeSlot([{ service_id: 1, barbero_id: 1, hora: '16:00:00' }, { service_id: 1, barbero_id: 2, hora: '16:00:00' }], { ...state, barber_id: null }).reason, 'barber_selection_required')
assert.equal(selectAuthoritativeSlot([{ service_id: 2, barbero_id: 1, hora: '16:00:00' }], state).reason, 'slot_unavailable_after_recheck')

const validGuard = {
  enabled: true,
  runtimeValid: true,
  tenantId: 1,
  environment: 'qa',
  instance: QA_BOOKING_MUTATION_INSTANCE,
  connectionState: 'CONNECTED',
  sourceEventPresent: true,
  sourceEventFresh: true,
  sourceEventReal: true,
  sourceTenantId: 1,
  sourceIntegrationId: 1,
  sourceFromMe: false,
  sourceEnvironment: 'qa',
  senderHashMatches: true,
  sourceIntent: 'booking_intent',
  stateValid: true,
  availabilityRechecked: true,
  requestedSlotAvailable: true,
  operationClaimAvailable: { available: true, integrationId: 1 },
}
assert.deepEqual(bookingMutationGuard(validGuard), { allowed: true, reason: null })
for (const [field, expected] of [
  ['enabled', 'booking_mutation_pilot_disabled'],
  ['tenantId', 'qa_tenant_required'],
  ['environment', 'qa_environment_required'],
  ['instance', 'qa_instance_required'],
  ['connectionState', 'qa_connection_not_connected'],
  ['sourceEventFresh', 'fresh_real_source_event_required'],
  ['sourceFromMe', 'from_me_ignored'],
  ['senderHashMatches', 'sender_not_allowlisted'],
  ['sourceIntent', 'booking_intent_required'],
  ['stateValid', 'confirmed_booking_state_required'],
  ['availabilityRechecked', 'authoritative_availability_required'],
  ['requestedSlotAvailable', 'slot_changed'],
]) {
  const copy = { ...validGuard, [field]: field === 'sourceFromMe' ? true : field === 'enabled' || field === 'senderHashMatches' || field === 'sourceEventFresh' || field === 'availabilityRechecked' || field === 'requestedSlotAvailable' || field === 'stateValid' ? false : field === 'tenantId' ? 2 : field === 'environment' ? 'production' : field === 'instance' ? 'other' : field === 'connectionState' ? 'DISCONNECTED' : field === 'sourceIntent' ? 'services_query' : validGuard[field] }
  assert.equal(bookingMutationGuard(copy).reason, expected)
}

const contract = buildBookingMutationContract({ state, recheck: { source: 'authoritative_rpc', requested_slot_available: true }, pilotEnabled: false })
assert.equal(contract.claim_key, buildBookingClaimEventId(state))
assert.equal(contract.ready_for_booking_mutation, true)
assert.equal(contract.availability_rechecked, true)
assert.equal(contract.mutation_allowed, false)
assert.equal(contract.booking_mutation_executed, false)

assert.match(publicBookingMigration, /create or replace function public\.crear_reserva_publica/i)
assert.match(whatsappBookingMigration, /create or replace function public\.crear_reserva_whatsapp/i)
assert.match(whatsappBookingMigration, /on conflict \(integration_id, event_id\) do nothing/i)
assert.match(functionSource, /Object\.keys\(body.*event_id/i)
assert.match(functionSource, /horarios_disponibles_reserva_publica/i)
assert.match(functionSource, /crear_reserva_whatsapp/i)
assert.match(functionSource, /QA_BOOKING_MUTATION_FLAG/i)
assert.match(functionSource, /QA_BOOKING_MUTATION_PROMPT_VERSION/i)
assert.match(functionSource, /isConversationStateFresh/i)
assert.match(functionSource, /saas_integraciones/i)
assert.doesNotMatch(functionSource, /ssagttjdgtypxjcgdnrw/i)
assert.doesNotMatch(functionSource, /sendText|message\/sendText|EVOLUTION_API_KEY/i)
assert.doesNotMatch(functionSource, /p_tenant_id|p_barbero_id.*body|p_servicio_id.*body/i)

console.log('WHATSAPP BOOKING MUTATION TESTS PASS')
console.log(`QA tenant=${QA_BOOKING_MUTATION_TENANT_ID}; mutation default requires ${'WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED'}=1`)
