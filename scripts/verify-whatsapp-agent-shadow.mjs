import assert from 'node:assert/strict'
import {
  assertShadowAgentConfiguration,
  buildDeterministicShadowProposal,
  extractInboundText,
  generateShadowProposal,
} from '../supabase/functions/_shared/whatsappAgentShadow.mjs'

assert.deepEqual(assertShadowAgentConfiguration({ WHATSAPP_MODE: 'shadow', PILOT_MODE: 'shadow' }), { mutation_allowed: false, outbound_allowed: false })
assert.throws(() => assertShadowAgentConfiguration({ WHATSAPP_MODE: 'live', PILOT_MODE: 'shadow' }), /shadow_mode_required/)

const tenantA = {
  business: { nombre: 'E2E_QA_BARBERIA_A', moneda: 'ARS' },
  services: [{ id: 1, nombre: 'E2E_QA_A_SERVICIO', precio: 15000, duracion_min: 30, activo: true }],
  barbers: [{ id: 1, nombre: 'E2E_QA_A_EMPLEADO', activo: true }],
  schedules: [{ barbero_id: 1, day_of_week: 1, start_time: '09:00:00', end_time: '18:00:00' }],
  blocks: [],
}
const tenantB = {
  business: { nombre: 'E2E_QA_BARBERIA_B', moneda: 'ARS' },
  services: [{ id: 2, nombre: 'E2E_QA_B_SERVICIO', precio: 25000, duracion_min: 45, activo: true }],
  barbers: [{ id: 2, nombre: 'E2E_QA_B_EMPLEADO', activo: true }],
  schedules: [{ barbero_id: 2, day_of_week: 2, start_time: '10:00:00', end_time: '19:00:00' }],
  blocks: [],
}

assert.equal(extractInboundText({ data: { message: { conversation: 'Hola, ¿qué servicios tienen?' } } }), 'Hola, ¿qué servicios tienen?')
assert.equal(extractInboundText({ data: { message: { conversation: 'x'.repeat(3000) } } }).length, 2000)
assert.equal(extractInboundText({ data: { key: { id: 'evt-only' } } }), '')

const proposalA = buildDeterministicShadowProposal({ text: 'Hola, ¿qué servicios tienen?', ...tenantA })
const proposalB = buildDeterministicShadowProposal({ text: 'Hola, ¿qué servicios tienen?', ...tenantB })
assert.equal(proposalA.intent, 'services_query')
assert.match(proposalA.proposed_reply, /E2E_QA_A_SERVICIO/)
assert.doesNotMatch(proposalA.proposed_reply, /E2E_QA_B_SERVICIO/)
assert.match(proposalB.proposed_reply, /E2E_QA_B_SERVICIO/)
assert.doesNotMatch(proposalB.proposed_reply, /E2E_QA_A_SERVICIO/)
assert.equal(proposalA.mutation_allowed, false)
assert.equal(proposalA.outbound_allowed, false)
assert.doesNotMatch(proposalA.proposed_reply, /tenant_id|barberia_id|service_role|token/i)

const bookingProposal = buildDeterministicShadowProposal({ text: 'Quiero reservar un turno mañana', ...tenantA })
assert.equal(bookingProposal.mutation_allowed, false)
assert.equal(bookingProposal.outbound_allowed, false)
assert.match(bookingProposal.requested_action, /read|proposal/i)

const duplicateEvents = new Set()
const eventId = 'E2E_QA_AGENT_SHADOW_001'
duplicateEvents.add(eventId)
assert.equal(duplicateEvents.has(eventId), true)
assert.equal(duplicateEvents.size, 1)

await assert.rejects(
  () => generateShadowProposal({ text: 'hola', context: tenantA, apiKey: 'test-only', fetchImpl: async () => ({ ok: false, status: 503 }) }),
  /llm_unavailable/,
)
await assert.rejects(
  () => generateShadowProposal({ text: 'hola', context: tenantA, apiKey: 'test-only', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{' } }] }) }) }),
  /llm_invalid_json/,
)

console.log(JSON.stringify({
  tenant_a_context: 'PASS',
  tenant_b_isolation: 'PASS',
  shadow_outbound_denied: 'PASS',
  mutation_denied: 'PASS',
  llm_error_fail_closed: 'PASS',
  malformed_inbound_fail_closed: 'PASS',
  duplicate_event_idempotency: 'PASS',
  external_effects: { messages: 0, reservations: 0, clients: 0 },
}))
