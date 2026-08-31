import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  advanceConversationTurn,
} from '../supabase/functions/_shared/whatsappConversationRuntime.mjs'
import {
  classifyConversationInput,
  conversationScope,
  isConversationStateFresh,
  isConversationStateForScope,
  recordAvailabilityResult,
} from '../supabase/functions/_shared/whatsappConversationState.mjs'
import {
  buildBookingClaimEventId,
  bookingMutationGuard,
  isConfirmedBookingState,
  selectAuthoritativeSlot,
} from '../supabase/functions/_shared/whatsappBookingMutation.mjs'
import {
  buildDeterministicShadowProposal,
  generateShadowProposal,
  resolveRequestedServices,
} from '../supabase/functions/_shared/whatsappAgentShadow.mjs'
import { agentOutboundGuard } from '../supabase/functions/_shared/whatsappAgentOutboundPilot.mjs'

const bookingFunctionSource = fs.readFileSync(new URL('../supabase/functions/whatsapp-booking-mutation/index.ts', import.meta.url), 'utf8')
const bookingMigrationSource = fs.readFileSync(new URL('../supabase/migrations/20260806150000_multitenant_whatsapp_contract.sql', import.meta.url), 'utf8')
const bookingMutationMigrationSource = fs.readFileSync(new URL('../supabase/migrations/20260806161000_whatsapp_booking_mutations.sql', import.meta.url), 'utf8')
const webhookSource = fs.readFileSync(new URL('../supabase/functions/whatsapp-evolution-webhook/index.ts', import.meta.url), 'utf8')

const now = new Date('2030-01-07T12:00:00.000Z')
const scope = {
  tenantId: 1,
  integrationId: 1,
  instance: 'austral-qa-tenant-1',
  senderHash: 'sha256:0123456789ab',
  environment: 'qa',
}
const services = [{ id: 36, nombre: 'Corte clásico', precio: 30000, duracion_min: 30, activo: true }]

const firstTurn = advanceConversationTurn({
  scope,
  eventId: 'robust-inbound-1',
  text: 'Quiero reservar Corte clásico mañana a las 16',
  services,
  timezone: 'America/Argentina/Buenos_Aires',
  now,
})
assert.equal(firstTurn.accepted, true)
const available = recordAvailabilityResult({
  state: firstTurn.state,
  expectedScope: scope,
  source: 'authoritative_rpc',
  available: true,
  snapshotId: 'rpc:robust-inbound-1',
  now,
})
assert.equal(available.accepted, true)
const confirmedTurn = advanceConversationTurn({
  state: available.state,
  scope,
  eventId: 'robust-confirmation-1',
  text: 'Sí',
  services,
  timezone: 'America/Argentina/Buenos_Aires',
  now,
})
assert.equal(confirmedTurn.confirmed, true)
assert.equal(confirmedTurn.state.ready_for_booking_mutation, true)
assert.equal(confirmedTurn.state.mutation_allowed, false)
assert.equal(isConfirmedBookingState(confirmedTurn.state, 'robust-confirmation-1'), true)

// Duplicate inbound and duplicate confirmation never advance a booking claim.
const duplicateInbound = advanceConversationTurn({
  state: firstTurn.state,
  scope,
  eventId: 'robust-inbound-1',
  text: 'Quiero reservar Corte clásico mañana a las 16',
  services,
  timezone: 'America/Argentina/Buenos_Aires',
  now,
})
assert.equal(duplicateInbound.duplicate, true)
assert.equal(duplicateInbound.state.version, firstTurn.state.version)
const duplicateConfirmation = advanceConversationTurn({
  state: confirmedTurn.state,
  scope,
  eventId: 'robust-confirmation-1',
  text: 'Sí',
  services,
  timezone: 'America/Argentina/Buenos_Aires',
  now,
})
assert.equal(duplicateConfirmation.duplicate, true)
const consecutiveConfirmation = advanceConversationTurn({
  state: confirmedTurn.state,
  scope,
  eventId: 'robust-confirmation-2',
  text: 'Sí confirmo',
  services,
  timezone: 'America/Argentina/Buenos_Aires',
  now,
})
assert.equal(consecutiveConfirmation.accepted, true)
assert.equal(consecutiveConfirmation.state.version > consecutiveConfirmation.state.confirmation_version, true)
assert.equal(isConfirmedBookingState(consecutiveConfirmation.state, 'robust-confirmation-2'), false)
assert.equal(buildBookingClaimEventId(confirmedTurn.state), buildBookingClaimEventId(consecutiveConfirmation.state))

// Expired proposals fail closed before confirmation can become mutation-ready.
const expiredAt = new Date(now.getTime() + 31 * 60 * 1000)
assert.equal(isConversationStateFresh(confirmedTurn.state, expiredAt), false)
const staleConfirmation = advanceConversationTurn({
  state: available.state,
  scope,
  eventId: 'robust-stale-confirmation',
  text: 'Sí',
  services,
  timezone: 'America/Argentina/Buenos_Aires',
  now: expiredAt,
})
assert.equal(staleConfirmation.accepted, false)
assert.equal(staleConfirmation.reason, 'conversation_expired')
assert.equal(staleConfirmation.state.mutation_allowed, false)

// Authoritative slot recheck and service/resource changes deny stale state.
assert.equal(selectAuthoritativeSlot([], confirmedTurn.state).reason, 'slot_unavailable_after_recheck')
assert.equal(resolveRequestedServices('precio corte', [{ id: 36, nombre: 'Corte clásico', activo: false }]).status, 'none')
assert.match(bookingFunctionSource, /\.eq\('activo', true\)/)
assert.match(bookingMigrationSource, /La cuenta no puede aceptar reservas/)
assert.match(bookingMutationMigrationSource, /La función de simulación nunca inserta clientes/)
assert.match(bookingMigrationSource, /El profesional ya no realiza este servicio/)

// Model/tool failures produce a safe result and never an implicit booking.
const toolFailure = buildDeterministicShadowProposal({
  text: '¿Hay lugar mañana?',
  business: { nombre: 'E2E QA', moneda: 'ARS' },
  services,
  availability: { status: 'error', request: { requested_date: '2030-01-08' }, slots: [], rpc_executed: false },
})
assert.match(toolFailure.proposed_reply, /No pude revisar la disponibilidad/)
assert.equal(toolFailure.mutation_allowed, false)
assert.equal(toolFailure.outbound_allowed, false)
await assert.rejects(
  () => generateShadowProposal({ text: 'hola', context: { services }, apiKey: 'test-only', fetchImpl: async () => ({ ok: false, status: 503 }) }),
  /llm_unavailable/,
)
const unsafeModelMetadata = {
  source: 'evolution',
  event: 'MESSAGES_UPSERT',
  environment: 'qa',
  from_me: false,
  mutation_allowed: false,
  outbound_allowed: false,
  mutation_blocked: true,
  outbound_send: false,
}
assert.equal(agentOutboundGuard({
  enabled: true,
  runtimeValid: true,
  tenantId: 1,
  environment: 'qa',
  connectionState: 'CONNECTED',
  integrationProvider: 'evolution',
  integrationType: 'whatsapp',
  integrationState: 'conectado',
  instance: scope.instance,
  sourceEventPresent: true,
  sourceEventReal: true,
  sourceTenantId: 1,
  sourceIntegrationId: 1,
  sourceFromMe: false,
  sourceEnvironment: 'qa',
  senderHashMatches: true,
  intent: 'booking_intent',
  proposedReply: 'Tu reserva fue creada.',
  sourceMetadata: unsafeModelMetadata,
  operationAcquired: true,
}).reason, 'unsafe_or_missing_proposed_reply')

// Unsupported media, groups, broadcasts, status events and bot output never enter booking.
for (const input of [
  { messageType: 'audio', text: 'audio' },
  { messageType: 'image', text: 'imagen' },
  { messageType: 'sticker', text: '' },
  { messageType: 'document', text: '' },
  { messageType: 'location', text: '' },
  { messageType: 'contact', text: '' },
  { messageType: 'reaction', text: '' },
  { messageType: 'text', text: 'hola', isGroup: true },
  { messageType: 'text', text: 'hola', isBroadcast: true },
  { messageType: 'text', text: 'hola', fromMe: true },
]) assert.equal(classifyConversationInput(input).accepted, false)
assert.match(webhookSource, /const ALLOWED_EVENTS = new Set\(\['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'\]\)/)
assert.match(webhookSource, /event_not_enabled/)

// Tenant, environment, instance, sender, availability and claim guards remain fail-closed.
assert.equal(conversationScope({ ...scope, tenantId: 2 }).tenant_id, 2)
assert.throws(() => conversationScope({ ...scope, instance: 'miwsp' }), TypeError)
assert.equal(isConversationStateForScope({ ...confirmedTurn.state, tenant_id: 2 }, scope), false)
const validGuard = {
  enabled: true,
  runtimeValid: true,
  tenantId: 1,
  environment: 'qa',
  instance: scope.instance,
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
for (const [field, value, reason] of [
  ['enabled', false, 'booking_mutation_pilot_disabled'],
  ['tenantId', 2, 'qa_tenant_required'],
  ['environment', 'production', 'qa_environment_required'],
  ['instance', 'miwsp', 'qa_instance_required'],
  ['sourceFromMe', true, 'from_me_ignored'],
  ['senderHashMatches', false, 'sender_not_allowlisted'],
  ['sourceIntent', 'services_query', 'booking_intent_required'],
  ['stateValid', false, 'confirmed_booking_state_required'],
  ['availabilityRechecked', false, 'authoritative_availability_required'],
  ['requestedSlotAvailable', false, 'slot_changed'],
  ['operationClaimAvailable', { available: false, integrationId: 1 }, 'booking_claim_unavailable'],
]) assert.equal(bookingMutationGuard({ ...validGuard, [field]: value }).reason, reason, `${field} guard`)

// Access policy, atomic claim, and post-booking retries are server-side only.
assert.match(bookingMigrationSource, /barberia_access_state/)
assert.match(bookingMigrationSource, /on conflict \(integration_id, event_id\) do nothing/)
assert.match(bookingMigrationSource, /select e\.\* into v_event[\s\S]*for update/)
assert.match(bookingMigrationSource, /set status = 'completed', processed_at = now\(\), result_reference = turno_id::text/)
assert.doesNotMatch(bookingFunctionSource, /sendText|message\/sendText|EVOLUTION_API_KEY/)
assert.doesNotMatch(bookingFunctionSource, /retry|setTimeout/i)

console.log(JSON.stringify({
  duplicate_inbound: 'PASS',
  duplicate_confirmation: 'PASS',
  stale_confirmation: 'PASS',
  slot_race: 'PASS',
  service_resource_revalidation: 'PASS',
  model_failure_fail_closed: 'PASS',
  tool_failure_fail_closed: 'PASS',
  unsupported_media_group_broadcast: 'PASS',
  from_me_loop_guard: 'PASS',
  tenant_instance_isolation: 'PASS',
  inactive_access_guard: 'PASS',
  outbound_failure_no_booking_retry: 'PASS',
  crash_retry_at_most_one: 'PASS',
  mutation_allowed: false,
  result: 'PASS',
}))
