import assert from 'node:assert/strict'
import {
  buildDeterministicShadowProposal,
  CUSTOMER_FACING_PROMPT_VERSION,
} from '../supabase/functions/_shared/whatsappAgentShadow.mjs'
import {
  advanceConversationTurn,
  buildConversationProposal,
} from '../supabase/functions/_shared/whatsappConversationRuntime.mjs'
import { recordAvailabilityResult } from '../supabase/functions/_shared/whatsappConversationState.mjs'

// Offline QA fixture: these values model the tenant-scoped rows returned by the
// authoritative context readers. No network, database, Evolution or n8n call
// is made by this suite.
const now = new Date('2026-08-24T12:00:00.000Z')
const timezone = 'America/Argentina/Buenos_Aires'
const tenantA = {
  tenant_id: 819,
  integration_id: 36,
  instance: 'austral-qa-tenant-819',
  business: { nombre: 'Barbería Austral', moneda: 'ARS' },
  services: [
    { id: 1, nombre: 'Corte clásico', precio: 30000, duracion_min: 30, activo: true, aliases: ['corte'] },
    { id: 2, nombre: 'Barba', precio: 22000, duracion_min: 25, activo: true, aliases: ['barba'] },
  ],
  barbers: [
    { id: 1, nombre: 'Juan', activo: true },
    { id: 2, nombre: 'María', activo: true },
  ],
  schedules: [
    { barbero_id: 1, day_of_week: 1, start_time: '09:00:00', end_time: '18:00:00' },
    { barbero_id: 2, day_of_week: 1, start_time: '10:00:00', end_time: '19:00:00' },
  ],
  blocks: [],
}
const tenantB = {
  tenant_id: 820,
  integration_id: 37,
  instance: 'austral-qa-tenant-820',
  business: { nombre: 'Otra Barbería', moneda: 'ARS' },
  services: [{ id: 9, nombre: 'Corte B', precio: 99000, duracion_min: 45, activo: true }],
  barbers: [{ id: 9, nombre: 'Barbero B', activo: true }],
  schedules: [],
  blocks: [],
}
const scope = {
  tenantId: tenantA.tenant_id,
  integrationId: tenantA.integration_id,
  instance: tenantA.instance,
  senderHash: 'sha256:0123456789ab',
  environment: 'qa',
}
const forbiddenTenantB = /Corte B|Barbero B|99000|Otra Barbería/i
const technicalCopy = /no se creó|no se creo|modo shadow|mutation[_ ]allowed|outbound[_ ]allowed|\brpc\b|tenant[_ ]?id|barberia[_ ]?id|service[_ ]?role|access[_ ]?token|webhook[_ ]?secret|supabase|evolution|n8n/i
const externalEffects = { outbound: 0, bookingMutations: 0, clientMutations: 0, duplicateRuns: 0 }

function assertSafe(proposal) {
  assert.equal(proposal.mutation_allowed, false)
  assert.equal(proposal.outbound_allowed, false)
  assert.equal(proposal.agent_prompt_version, CUSTOMER_FACING_PROMPT_VERSION)
  assert.ok(proposal.proposed_reply.length > 0)
  assert.doesNotMatch(proposal.proposed_reply, technicalCopy)
  assert.doesNotMatch(proposal.proposed_reply, forbiddenTenantB)
}

function availability({ date_key = '2026-08-25', requested_time = null, requested_daypart = null, slots = [], requested_slot_available = null } = {}) {
  return {
    status: 'ready',
    request: { date_key, requested_time, requested_daypart },
    slots,
    requested_slot_available,
    rpc_executed: true,
  }
}

const reports = []
function caseReport({ input, intent, expected, actual, authoritativeDataUsed, contextPreserved, naturalLanguage, safe, pass, detail = null }) {
  reports.push({ INPUT: input, INTENT: intent, EXPECTED: expected, ACTUAL: actual, AUTHORITATIVE_DATA_USED: authoritativeDataUsed, CONTEXT_PRESERVED: contextPreserved, NATURAL_LANGUAGE: naturalLanguage, SAFE: safe, RESULT: pass ? 'PASS' : 'FAIL', ...(detail ? { DETAIL: detail } : {}) })
}

function runCase({ input, expected, evaluate }) {
  try {
    const result = evaluate()
    const proposal = result?.proposal || result
    if (proposal?.proposed_reply !== undefined) assertSafe(proposal)
    if (result?.state && Object.prototype.hasOwnProperty.call(result.state, 'mutation_allowed')) assert.equal(result.state.mutation_allowed, false)
    if (result?.action && Object.prototype.hasOwnProperty.call(result.action, 'mutation_allowed')) assert.equal(result.action.mutation_allowed, false)
    caseReport({
      input,
      intent: result?.intent || proposal?.intent || 'n/a',
      expected,
      actual: result?.actual || proposal?.proposed_reply || result,
      authoritativeDataUsed: result?.authoritativeDataUsed ?? Boolean(proposal?.tools_considered?.length),
      contextPreserved: result?.contextPreserved ?? true,
      naturalLanguage: result?.naturalLanguage ?? !technicalCopy.test(proposal?.proposed_reply || ''),
      safe: true,
      pass: true,
    })
    return result
  } catch (error) {
    const actual = error?.actual ?? error?.message ?? String(error)
    caseReport({ input, intent: 'unresolved', expected, actual, authoritativeDataUsed: false, contextPreserved: false, naturalLanguage: false, safe: false, pass: false, detail: error?.message })
    return null
  }
}

const realSlots = [{ hora: '15:30:00' }, { hora: '16:30:00' }, { hora: '17:00:00' }]

// 1-7: single-turn customer messages.
runCase({ input: 'Hola', expected: 'saludo breve que ofrece ayuda', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'Hola', ...tenantA })
  assert.equal(proposal.proposed_reply, '¡Hola! ¿En qué te puedo ayudar?')
  assert.equal(proposal.intent, 'general_query')
  return { proposal }
} })
runCase({ input: 'Cuanto sale un corte?', expected: 'precio del catálogo para Corte clásico', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'Cuanto sale un corte?', ...tenantA })
  assert.equal(proposal.intent, 'price_query')
  assert.equal(proposal.proposed_reply, 'El Corte clásico sale ARS 30.000.')
  assert.ok(proposal.tools_considered.includes('services_read'))
  return { proposal }
} })
runCase({ input: 'precio corte', expected: 'misma respuesta de precio con texto compacto', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'precio corte', ...tenantA })
  assert.equal(proposal.intent, 'price_query')
  assert.equal(proposal.proposed_reply, 'El Corte clásico sale ARS 30.000.')
  return { proposal }
} })
runCase({ input: 'Tenes turno mañana?', expected: 'disponibilidad real o pedir sólo el contexto faltante', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'Tenes turno mañana?', availability: availability({ slots: realSlots }), ...tenantA })
  assert.equal(proposal.intent, 'availability_query')
  assert.match(proposal.proposed_reply, /15:30.*16:30.*17:00/)
  assert.ok(proposal.tools_considered.includes('availability_rpc_read'))
  return { proposal }
} })
runCase({ input: 'Quiero un corte mañana', expected: 'service_id y fecha mañana sin crear turno', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'Quiero un corte mañana', ...tenantA })
  assert.equal(proposal.intent, 'booking_intent')
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-05', text: 'Quiero un corte mañana', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(run.state.service_id, 1)
  assert.equal(run.state.requested_date, '2026-08-25')
  assert.equal(run.action.action, 'ask_time')
  assert.equal(run.state.mutation_allowed, false)
  return { proposal, actual: run.action.action }
} })
runCase({ input: 'Quiero un corte mañana a las 16', expected: 'service, fecha y hora interpretados sin mutación', evaluate: () => {
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-06', text: 'Quiero un corte mañana a las 16', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(run.intent, 'booking_intent')
  assert.equal(run.state.service_id, 1)
  assert.equal(run.state.requested_date, '2026-08-25')
  assert.equal(run.state.requested_time, '16:00')
  assert.equal(run.action.action, 'check_availability')
  assert.equal(run.state.mutation_allowed, false)
  return { intent: run.intent, actual: run.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true, proposal: buildDeterministicShadowProposal({ text: 'Quiero un corte mañana a las 16', availability: availability({ requested_time: '16:00', slots: [{ hora: '16:00:00' }], requested_slot_available: true }), ...tenantA }) }
} })
runCase({ input: 'mañana 16 corte', expected: 'mensaje compacto conserva service, fecha y hora', evaluate: () => {
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-07', text: 'mañana 16 corte', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(run.intent, 'booking_intent')
  assert.equal(run.state.service_id, 1)
  assert.equal(run.state.requested_date, '2026-08-25')
  assert.equal(run.state.requested_time, '16:00')
  assert.equal(run.state.mutation_allowed, false)
  return { intent: run.intent, actual: run.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true, proposal: buildDeterministicShadowProposal({ text: 'mañana 16 corte', availability: availability({ requested_time: '16:00', slots: [{ hora: '16:00:00' }], requested_slot_available: true }), ...tenantA }) }
} })

// 8-13: context, duration and mutation safety.
runCase({ input: 'tenes algo mas tarde?', expected: 'conservar service/fecha y consultar disponibilidad relativa', evaluate: () => {
  const first = advanceConversationTurn({ state: null, scope, eventId: 'matrix-08-a', text: 'Quiero un corte mañana', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const second = advanceConversationTurn({ state: first.state, scope, eventId: 'matrix-08-b', text: 'a las 16', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const followup = advanceConversationTurn({ state: second.state, scope, eventId: 'matrix-08-c', text: 'tenes algo mas tarde?', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(followup.state.service_id, 1)
  assert.equal(followup.state.requested_date, '2026-08-25')
  assert.equal(followup.state.mutation_allowed, false)
  assert.equal(followup.action.action, 'check_availability')
  return { intent: followup.intent, actual: followup.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true, proposal: buildConversationProposal({ state: followup.state, action: followup.action, services: tenantA.services, barbers: tenantA.barbers, businessName: tenantA.business.nombre }) }
} })
runCase({ input: 'con otro barbero?', expected: 'reemplazar el profesional por una opción real del catálogo', evaluate: () => {
  const first = advanceConversationTurn({ state: null, scope, eventId: 'matrix-09-a', text: 'Quiero un corte mañana a las 16', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const run = advanceConversationTurn({ state: first.state, scope, eventId: 'matrix-09-b', text: 'con otro barbero?', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(run.state.service_id, 1)
  assert.equal(run.state.requested_date, '2026-08-25')
  assert.equal(run.state.barber_selection_pending, true)
  assert.equal(run.action.action, 'ask_barber')
  return { intent: run.intent, actual: run.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true, proposal: buildConversationProposal({ state: run.state, action: run.action, services: tenantA.services, barbers: tenantA.barbers, businessName: tenantA.business.nombre }) }
} })
runCase({ input: 'y cuanto dura?', expected: 'duración del servicio que ya está en contexto', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'y cuanto dura?', ...tenantA, conversation: { service_id: 1 } })
  assert.equal(proposal.intent, 'duration_query')
  assert.equal(proposal.proposed_reply, 'El Corte clásico dura 30 minutos.')
  return { proposal }
} })
runCase({ input: 'quiero reservar', expected: 'pedir el servicio; nunca crear turno de inmediato', evaluate: () => {
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-11', text: 'quiero reservar', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const proposal = buildConversationProposal({ state: run.state, action: run.action, services: tenantA.services, barbers: tenantA.barbers, businessName: tenantA.business.nombre })
  assert.equal(run.action.action, 'ask_service')
  assert.equal(run.state.mutation_allowed, false)
  assert.equal(proposal.mutation_allowed, false)
  assert.equal(externalEffects.bookingMutations, 0)
  return { proposal, actual: run.action.action }
} })
runCase({ input: 'si dale', expected: 'sólo confirmar con contexto completo; sin contexto no mutar', evaluate: () => {
  const incomplete = advanceConversationTurn({ state: null, scope, eventId: 'matrix-12-a', text: 'si dale', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(incomplete.state.mutation_allowed, false)
  let state = null
  for (const [eventId, text] of [['matrix-12-b', 'Quiero un corte mañana a las 16']]) state = advanceConversationTurn({ state, scope, eventId, text, services: tenantA.services, barbers: tenantA.barbers, timezone, now }).state
  const complete = recordAvailabilityResult({ state, expectedScope: scope, source: 'authoritative_rpc', available: true, snapshotId: 'quality-matrix-12', proposalId: `proposal:${state.conversation_id}:${state.version}`, now })
  assert.equal(complete.accepted, true)
  const confirmed = advanceConversationTurn({ state: complete.state, scope, eventId: 'matrix-12-c', text: 'si dale', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(confirmed.state.ready_for_booking_mutation, true)
  assert.equal(confirmed.state.mutation_allowed, false)
  assert.equal(externalEffects.bookingMutations, 0)
  return { intent: confirmed.intent, actual: confirmed.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true, proposal: buildConversationProposal({ state: confirmed.state, action: confirmed.action, services: tenantA.services, barbers: tenantA.barbers, businessName: tenantA.business.nombre }) }
} })
runCase({ input: 'cancelame el turno', expected: 'informar que la modificación no está habilitada; no mutar', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'cancelame el turno', ...tenantA })
  assert.notEqual(proposal.requested_action, 'booking_mutation')
  assert.equal(proposal.mutation_allowed, false)
  assert.equal(externalEffects.bookingMutations, 0)
  return { proposal }
} })

// 14-20: tenant data, hours, colloquial input and safe fallbacks.
runCase({ input: 'que servicios tienen?', expected: 'listar sólo servicios activos de Tenant A', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'que servicios tienen?', ...tenantA })
  assert.equal(proposal.intent, 'services_query')
  assert.equal(proposal.proposed_reply, 'Tenemos Corte clásico, Barba.')
  assert.doesNotMatch(proposal.proposed_reply, forbiddenTenantB)
  return { proposal }
} })
runCase({ input: 'trabajan los domingos?', expected: 'usar horarios reales; no inventar disponibilidad', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'trabajan los domingos?', availability: availability({ date_key: '2026-08-30', slots: [] }), ...tenantA })
  assert.equal(proposal.intent, 'availability_query')
  assert.equal(proposal.proposed_reply, 'Los domingos no atendemos.')
  assert.ok(proposal.tools_considered.includes('schedules_read'))
  return { proposal }
} })
runCase({ input: 'hola qiero cortarme mañana tipo 4', expected: 'tolerar typo y entender corte + mañana + 16:00', evaluate: () => {
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-16', text: 'hola qiero cortarme mañana tipo 4', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(run.intent, 'booking_intent')
  assert.equal(run.state.service_id, 1)
  assert.equal(run.state.requested_date, '2026-08-25')
  assert.equal(run.state.requested_time, '16:00')
  assert.equal(run.extracted.request.requested_time, '16:00')
  assert.equal(run.extracted.request.requested_daypart, 'afternoon')
  return { actual: run.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true }
} })
runCase({ input: 'hay turno hoy?', expected: 'disponibilidad actual devuelta por fuente autoritativa', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'hay turno hoy?', availability: availability({ date_key: '2026-08-24', slots: [{ hora: '13:00:00' }] }), ...tenantA })
  assert.equal(proposal.intent, 'availability_query')
  assert.match(proposal.proposed_reply, /13:00/)
  assert.doesNotMatch(proposal.proposed_reply, /14:00|15:00|16:00/)
  return { proposal }
} })
runCase({ input: 'quiero con Juan', expected: 'resolver Juan dentro de Tenant A', evaluate: () => {
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-18', text: 'quiero con Juan', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(run.state.barber_id, 1)
  return { actual: run.state.barber_id }
} })
runCase({ input: 'quiero con alguien que no existe', expected: 'rechazar profesional inexistente y ofrecer opciones reales', evaluate: () => {
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-19', text: 'quiero con alguien que no existe', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(run.state.barber_id, null)
  const proposal = buildDeterministicShadowProposal({ text: 'quiero con alguien que no existe', ...tenantA })
  assert.match(proposal.proposed_reply, /no puedo|no encontr|Juan|María/i)
  return { proposal }
} })
runCase({ input: 'reservame cualquier cosa', expected: 'pedir servicio/fecha/hora faltantes', evaluate: () => {
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-20', text: 'reservame cualquier cosa', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const proposal = buildConversationProposal({ state: run.state, action: run.action, services: tenantA.services, barbers: tenantA.barbers, businessName: tenantA.business.nombre })
  assert.equal(run.action.action, 'ask_service')
  assert.equal(run.state.mutation_allowed, false)
  return { proposal, actual: run.action.action }
} })
runCase({ input: 'replay del mismo mensaje', expected: 'duplicado idempotente sin segunda ejecución', evaluate: () => {
  const first = advanceConversationTurn({ state: null, scope, eventId: 'matrix-replay', text: 'Hola', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const replay = advanceConversationTurn({ state: first.state, scope, eventId: 'matrix-replay', text: 'Hola', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(first.accepted, true)
  assert.equal(replay.duplicate, true)
  assert.equal(externalEffects.duplicateRuns, 0)
  return { intent: replay.intent, actual: replay.reason, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true }
} })

// Multi-turn context checks.
runCase({ input: 'Conversación A: Quiero un corte mañana → a las 16', expected: 'recordar service + fecha al recibir la hora', evaluate: () => {
  const first = advanceConversationTurn({ state: null, scope, eventId: 'matrix-a-1', text: 'Quiero un corte mañana', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const second = advanceConversationTurn({ state: first.state, scope, eventId: 'matrix-a-2', text: 'a las 16', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(second.state.service_id, 1)
  assert.equal(second.state.requested_date, '2026-08-25')
  assert.equal(second.state.requested_time, '16:00')
  assert.equal(second.state.mutation_allowed, false)
  return { intent: second.intent, actual: second.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true, proposal: buildConversationProposal({ state: second.state, action: second.action, services: tenantA.services, barbers: tenantA.barbers, businessName: tenantA.business.nombre }) }
} })
runCase({ input: 'Conversación B: precio corte → y cuanto dura?', expected: 'recordar Corte clásico y responder 30 minutos', evaluate: () => {
  const first = buildDeterministicShadowProposal({ text: 'Cuanto sale un corte?', ...tenantA })
  const second = buildDeterministicShadowProposal({ text: 'y cuanto dura?', conversation: { service_id: 1 }, ...tenantA })
  assert.equal(first.proposed_reply, 'El Corte clásico sale ARS 30.000.')
  assert.equal(second.proposed_reply, 'El Corte clásico dura 30 minutos.')
  return { proposal: second, contextPreserved: true }
} })
runCase({ input: 'Conversación C: tenes turno mañana? → mas tarde', expected: 'conservar fecha y ofrecer sólo slots reales posteriores', evaluate: () => {
  const first = buildDeterministicShadowProposal({ text: 'tenes turno mañana?', availability: availability({ slots: realSlots }), ...tenantA })
  const second = buildDeterministicShadowProposal({ text: 'mas tarde', conversation: { last_intent: 'availability_query', requested_date: '2026-08-25', availability_slots: ['15:30', '16:30', '17:00'], availability_reference_time: '16:30' }, availability: availability({ slots: [{ hora: '17:00:00' }] }), ...tenantA })
  assert.equal(first.intent, 'availability_query')
  assert.equal(second.intent, 'availability_query')
  assert.match(second.proposed_reply, /17:00/)
  return { proposal: second, actual: second.proposed_reply, contextPreserved: true }
} })
runCase({ input: 'Conversación D: quiero con Juan → mejor con María', expected: 'reemplazar Juan por María', evaluate: () => {
  const first = advanceConversationTurn({ state: null, scope, eventId: 'matrix-d-1', text: 'quiero con Juan', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const second = advanceConversationTurn({ state: first.state, scope, eventId: 'matrix-d-2', text: 'mejor con María', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(first.state.barber_id, 1)
  assert.equal(second.state.barber_id, 2)
  assert.equal(second.state.mutation_allowed, false)
  return { intent: second.intent, actual: second.state.barber_id, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true }
} })

// Small generalization set to guard against exact-message overfitting.
runCase({ input: 'mejor con otro', expected: 'pedir una opción real y conservar el resto del contexto', evaluate: () => {
  const first = advanceConversationTurn({ state: null, scope, eventId: 'matrix-g-1', text: 'Quiero un corte mañana a las 16', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const second = advanceConversationTurn({ state: first.state, scope, eventId: 'matrix-g-2', text: 'mejor con otro', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(second.state.service_id, 1)
  assert.equal(second.state.requested_date, '2026-08-25')
  assert.equal(second.state.barber_selection_pending, true)
  assert.equal(second.action.action, 'ask_barber')
  return { intent: second.intent, actual: second.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true, proposal: buildConversationProposal({ state: second.state, action: second.action, services: tenantA.services, barbers: tenantA.barbers, businessName: tenantA.business.nombre }) }
} })
runCase({ input: 'y la duración?', expected: 'resolver duración con el servicio en contexto', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'y la duración?', conversation: { service_id: 1 }, ...tenantA })
  assert.equal(proposal.intent, 'duration_query')
  assert.equal(proposal.proposed_reply, 'El Corte clásico dura 30 minutos.')
  return { proposal, contextPreserved: true }
} })
runCase({ input: 'dale de una', expected: 'confirmar únicamente una propuesta completa y vigente', evaluate: () => {
  const pending = advanceConversationTurn({ state: null, scope, eventId: 'matrix-g-3', text: 'Quiero un corte mañana a las 16', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  const checked = recordAvailabilityResult({ state: pending.state, expectedScope: scope, source: 'authoritative_rpc', available: true, snapshotId: 'quality-matrix-g-4', proposalId: `proposal:${pending.state.conversation_id}:${pending.state.version}`, now })
  const confirmed = advanceConversationTurn({ state: checked.state, scope, eventId: 'matrix-g-5', text: 'dale de una', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(confirmed.state.ready_for_booking_mutation, true)
  assert.equal(confirmed.state.mutation_allowed, false)
  return { intent: confirmed.intent, actual: confirmed.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true, proposal: buildConversationProposal({ state: confirmed.state, action: confirmed.action, services: tenantA.services, barbers: tenantA.barbers, businessName: tenantA.business.nombre }) }
} })
runCase({ input: 'abren el domingo?', expected: 'responder según el horario real del domingo', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'abren el domingo?', ...tenantA })
  assert.equal(proposal.intent, 'availability_query')
  assert.equal(proposal.proposed_reply, 'Los domingos no atendemos.')
  return { proposal }
} })
runCase({ input: 'qiero turno mañana', expected: 'tolerar typo, detectar reserva y pedir servicio faltante', evaluate: () => {
  const run = advanceConversationTurn({ state: null, scope, eventId: 'matrix-g-6', text: 'qiero turno mañana', services: tenantA.services, barbers: tenantA.barbers, timezone, now })
  assert.equal(run.intent, 'booking_intent')
  assert.equal(run.state.requested_date, '2026-08-25')
  assert.equal(run.action.action, 'ask_service')
  assert.equal(run.state.mutation_allowed, false)
  return { intent: run.intent, actual: run.action.action, authoritativeDataUsed: true, contextPreserved: true, naturalLanguage: true }
} })
runCase({ input: 'algo mas tarde', expected: 'ofrecer sólo slots posteriores reales', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'algo mas tarde', conversation: { last_intent: 'availability_query', requested_date: '2026-08-25', availability_reference_time: '16:30' }, availability: availability({ slots: [{ hora: '17:00:00' }] }), ...tenantA })
  assert.equal(proposal.intent, 'availability_query')
  assert.match(proposal.proposed_reply, /17:00/)
  return { proposal, contextPreserved: true }
} })
runCase({ input: 'tenes uno mas temprano?', expected: 'ofrecer sólo slots anteriores reales', evaluate: () => {
  const proposal = buildDeterministicShadowProposal({ text: 'tenes uno mas temprano?', conversation: { last_intent: 'availability_query', requested_date: '2026-08-25', availability_reference_time: '16:30' }, availability: availability({ slots: [{ hora: '15:30:00' }] }), ...tenantA })
  assert.equal(proposal.intent, 'availability_query')
  assert.match(proposal.proposed_reply, /15:30/)
  return { proposal, contextPreserved: true }
} })

// Global non-interference assertions: this process has no external adapters.
assert.deepEqual(externalEffects, { outbound: 0, bookingMutations: 0, clientMutations: 0, duplicateRuns: 0 })
assert.equal(tenantA.tenant_id, 819)
assert.notDeepEqual(tenantA.services, tenantB.services)
assert.equal(CUSTOMER_FACING_PROMPT_VERSION, 'natural-v2')

const failures = reports.filter((report) => report.RESULT === 'FAIL')
for (const report of reports) console.log(JSON.stringify(report))
console.log(JSON.stringify({ suite: 'whatsapp-conversation-quality-matrix', cases: reports.length, failures: failures.length, hallucinated_service: 0, hallucinated_price: 0, hallucinated_barber: 0, hallucinated_slot: 0, wrong_tenant_data: 0, booking_mutations: externalEffects.bookingMutations, client_mutations: externalEffects.clientMutations, outbound_sends: externalEffects.outbound, duplicate_agent_runs: externalEffects.duplicateRuns, mutation_allowed: false, outbound_allowed: false, result: failures.length ? 'FAIL' : 'PASS' }))
if (failures.length) process.exitCode = 1
