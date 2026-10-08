// Tarea 41 (revisión): si WhatsApp no puede reservar porque el horario quedó
// bloqueado u ocupado, el cliente recibe un mensaje comprensible con otros
// horarios y puede elegir uno, sin turno creado ni éxito inventado.
// Handlers reales con Supabase en memoria y fetch simulado para Evolution;
// no reemplaza la prueba real entre los números QA.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  alternativeSlotTimes,
  buildSlotRejectedReply,
  classifyBookingSlotRejection,
  isSafeSlotRejectedReply,
} from '../supabase/functions/_shared/whatsappBookingMutation.mjs'
import { canonicalArgentineMobile } from '../supabase/functions/_shared/whatsappCustomer.mjs'
import { QA_BOOKING_ROUTE_URL } from '../supabase/functions/_shared/whatsappQaBookingRoute.mjs'
import { createMemoryDb, harnessEnv, loadEdgeFunction, senderHashFor } from './lib/edgeFunctionHarness.mjs'

// ---------------------------------------------------------------- puros
assert.equal(classifyBookingSlotRejection({ code: '22023', message: 'El horario está bloqueado para ese día.' }), 'slot_blocked', 'trigger de turnos')
assert.equal(classifyBookingSlotRejection({ code: '22023', message: 'Ese horario fue bloqueado. Elegí otro.' }), 'slot_blocked', 'chequeo de crear_reserva_whatsapp')
assert.equal(classifyBookingSlotRejection({ code: '23P01', message: 'Ese horario acaba de ocuparse. Elegí otro.' }), 'slot_taken')
assert.equal(classifyBookingSlotRejection({ code: '22023', message: 'Ese horario ya pasó. Elegí otro.' }), 'slot_unavailable')
assert.equal(classifyBookingSlotRejection({ code: '22023', message: 'El profesional no trabaja en ese horario.' }), 'slot_unavailable')
for (const error of [{ code: '22023', message: 'Faltan nombre y teléfono.' }, { code: '42501', message: 'bloqueado' }, { code: '23505' }, null, { message: 'bloqueado' }]) {
  assert.equal(classifyBookingSlotRejection(error), null, `no es un rechazo de horario: ${JSON.stringify(error)}`)
}
const state = { service_id: 70, barber_id: 9, requested_time: '16:00' }
const slots = [
  { barbero_id: 9, hora: '16:00:00' }, { barbero_id: 9, hora: '10:00:00' }, { barbero_id: 9, hora: '10:00:00' },
  { barbero_id: 4, hora: '11:00:00' }, { barbero_id: 9, hora: '25:00' }, { barbero_id: 9, hora: '12:30:00' },
]
assert.deepEqual(alternativeSlotTimes(slots, state), ['10:00', '12:30'], 'mismo profesional, sin el pedido, sin repetidos ni horas inválidas')
assert.deepEqual(alternativeSlotTimes(slots, { ...state, barber_id: null }), ['10:00', '11:00', '12:30'], 'sin profesional elegido: todos')
assert.equal(alternativeSlotTimes(Array.from({ length: 20 }, (_, i) => ({ barbero_id: 9, hora: `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}` })), state).length, 6, 'a lo sumo 6')
assert.equal(buildSlotRejectedReply({ reason: 'slot_blocked', alternatives: ['10:00', '12:30'] }), 'No pude reservar ese horario porque el negocio lo bloqueó. No se agendó ningún turno. Puedo ofrecerte: 10:00, 12:30. ¿Cuál te sirve?')
assert.equal(buildSlotRejectedReply({ reason: 'slot_taken', alternatives: [] }), 'No pude reservar ese horario porque se acaba de ocupar. No se agendó ningún turno. Ese día no quedan otros horarios. ¿Querés que busque otro día?')
assert.equal(buildSlotRejectedReply({ reason: 'otro', alternatives: [] }), null)
assert.equal(buildSlotRejectedReply({ reason: 'slot_blocked', alternatives: ['10:00; drop'] }), null, 'horarios inválidos no se interpolan')
assert.equal(isSafeSlotRejectedReply(buildSlotRejectedReply({ reason: 'slot_unavailable', alternatives: ['10:00'] })), true)
assert.equal(isSafeSlotRejectedReply('¡Listo! Tu turno quedó reservado'), false)

// ---------------------------------------------------------------- handlers
const CLIENT_JID = '5491155550107@s.whatsapp.net'
const tz = 'America/Argentina/Buenos_Aires'
const env = {
  SUPABASE_URL: 'https://cmsymmszlzikqpvfqjre.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'harness-only',
  WHATSAPP_PROVISIONING_ENV: 'qa',
  WHATSAPP_MODE: 'shadow',
  PILOT_MODE: 'shadow',
  WHATSAPP_PROVISIONING_ADAPTER: 'evolution',
  EVOLUTION_WEBHOOK_SECRET: 'harness-secret',
  WHATSAPP_OUTBOUND_QA_RECIPIENT: '5491155550107',
  WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH: senderHashFor(CLIENT_JID),
  WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED: '1',
  WHATSAPP_BOOKING_MUTATION_ALLOWED_TENANT_IDS: '927',
  WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED: '1',
  WHATSAPP_AGENT_OUTBOUND_ALLOWED_TENANT_IDS: '927',
  WHATSAPP_QA_927_AUTOMATION_ENABLED: '0',
  EVOLUTION_BASE_URL: 'https://evolution.cuchitron.lat',
  EVOLUTION_API_KEY: 'harness-only',
  WHATSAPP_PUBLIC_BOOKING_ORIGIN: 'https://reservas-qa.example.com',
  WHATSAPP_PUBLIC_BOOKING_ENVIRONMENT: 'qa',
  WHATSAPP_QA_BOOKING_ROUTE_TENANT_IDS: '927',
  WHATSAPP_QA_BOOKING_ROUTE_EXPIRES_AT: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}
harnessEnv.clear()
for (const [key, value] of Object.entries(env)) harnessEnv.set(key, value)

const fixture = () => ({
  saas_whatsapp_connections: [{ id: 5, barberia_id: 927, integration_id: 47, provider: 'evolution', environment: 'qa', state: 'CONNECTED', instance_name: 'austral-qa-tenant-927' }],
  saas_integraciones: [{ id: 47, barberia_id: 927, proveedor: 'evolution', integration_type: 'whatsapp', estado: 'conectado' }],
  barberias: [{ id: 927, nombre: 'Negocio QA', slug: 'e2e-qa-whatsapp-pairing-20260923', moneda: 'ARS', zona_horaria: tz, reservas_publicas: true }],
  servicios: [{ id: 70, barberia_id: 927, nombre: 'Corte de prueba QA', precio: 15000, duracion_min: 30, activo: true }],
  barberos: [{ id: 9, barberia_id: 927, nombre: 'Profesional QA', activo: true }],
  horarios_barbero: [],
  bloqueos_agenda: [],
  clientes: [{ id: 41, barberia_id: 927, nombre: 'Cliente Web', telefono: '5491155550107' }],
})

const minutes = (value) => { const [h, m] = String(value).slice(0, 5).split(':').map(Number); return h * 60 + m }
const blocked = (db, fecha, hora, barberoId) => db.tables.bloqueos_agenda.some((b) => b.barberia_id === 927 && b.fecha === fecha
  && (b.barbero_id == null || b.barbero_id === barberoId) && minutes(hora) < minutes(b.end_time) && minutes(hora) + 30 > minutes(b.start_time))
// Simula las reglas de la base: la disponibilidad excluye bloqueos y turnos;
// la inserción rechaza con los mismos códigos que crear_reserva_whatsapp y
// el trigger. `antesDeInsertar` permite que un bloqueo entre en la carrera.
let antesDeInsertar = null
let errorForzado = null
const rpc = {
  horarios_disponibles_reserva_publica: (args, db) => ['10:00:00', '12:30:00', '16:00:00']
    .filter((hora) => !blocked(db, args.p_fecha, hora, 9))
    .filter((hora) => !db.tables.turnos.some((t) => t.fecha === args.p_fecha && `${t.hora}`.slice(0, 5) === hora.slice(0, 5)))
    .map((hora) => ({ barbero_id: 9, barbero_nombre: 'Profesional QA', hora, duracion_min: 30 })),
  crear_reserva_whatsapp: (args, db) => {
    antesDeInsertar?.(db, args)
    if (errorForzado) throw Object.assign(new Error(errorForzado.message), { code: errorForzado.code })
    if (blocked(db, args.p_fecha, args.p_hora, args.p_barbero_id)) throw Object.assign(new Error('El horario está bloqueado para ese día.'), { code: '22023' })
    if (db.tables.turnos.some((t) => t.fecha === args.p_fecha && `${t.hora}`.slice(0, 5) === String(args.p_hora).slice(0, 5))) throw Object.assign(new Error('Ese horario acaba de ocuparse. Elegí otro.'), { code: '23P01' })
    const telefono = canonicalArgentineMobile(args.p_telefono)
    const turno = { id: 900 + db.tables.turnos.length, barberia_id: 927, cliente_id: 41, servicio_id: args.p_servicio_id, barbero_id: args.p_barbero_id, fecha: args.p_fecha, hora: args.p_hora, estado: 'confirmado', origen: 'whatsapp', telefono }
    db.tables.turnos.push(turno)
    db.tables.saas_automation_events.push({ integration_id: args.p_integration_id, event_id: args.p_event_id, status: 'completed', result_reference: String(turno.id) })
    return [{ turno_id: turno.id, fecha: turno.fecha, hora: `${turno.hora}:00`, duracion_min: 30 }]
  },
}

const routeCalls = []
const sends = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const href = String(url)
  if (href === QA_BOOKING_ROUTE_URL) { routeCalls.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }) }
  if (href.startsWith('https://evolution.cuchitron.lat/message/sendText/')) {
    sends.push(JSON.parse(init.body))
    return new Response(JSON.stringify({ key: { id: `SENT${sends.length}` }, status: 'PENDING' }), { status: 201 })
  }
  return realFetch(url, init)
}

const webhook = await loadEdgeFunction('whatsapp-evolution-webhook')
const mutation = await loadEdgeFunction('whatsapp-booking-mutation')
const outbound = await loadEdgeFunction('whatsapp-agent-outbound-pilot')
const operator = { authorization: 'Bearer harness-only' }
let counter = 0
const send = async (text) => {
  const id = `S${counter += 1}`
  const result = await webhook({ event: 'messages.upsert', instance: 'austral-qa-tenant-927', data: { key: { id, remoteJid: CLIENT_JID, fromMe: false }, message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) } }, { 'X-Austral-Webhook-Secret': 'harness-secret' })
  return { ...result, id }
}
// Lo que hace el workflow n8n versionado (ver contrato al final).
async function n8n({ event_id: eventId, ready_for_booking_mutation: ready }) {
  if (!ready) return { reply: await outbound({ event_id: eventId }, operator) }
  const booking = await mutation({ event_id: eventId }, operator)
  if (booking.body.booking_created === true) return { booking, confirmation: await outbound({ event_id: eventId, kind: 'booking_confirmation' }, operator) }
  if (booking.body.slot_rejected === true && booking.body.conversation_reopened === true) return { booking, rejected: await outbound({ event_id: eventId, kind: 'booking_slot_rejected' }, operator) }
  return { booking, failed: true }
}
const stateOf = (db, eventId) => db.tables.saas_automation_shadow_runs.find((row) => row.event_id === eventId).metadata.conversation_state
const manana = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA', { timeZone: tz })
async function confirmar16(db) {
  await send('Quiero un turno de corte mañana a las 16')
  await n8n(routeCalls.at(-1))
  const r = await send('Sí')
  assert.equal(routeCalls.at(-1).ready_for_booking_mutation, true)
  assert.equal(db.tables.turnos.length, 0)
  return r
}

// 1. Carrera: el bloqueo de 16 a 18 se guarda entre la revalidación y el INSERT.
let db = createMemoryDb(fixture(), { rpc })
let r = await confirmar16(db)
antesDeInsertar = (base, args) => { if (!base.tables.bloqueos_agenda.length) base.tables.bloqueos_agenda.push({ id: 1, barberia_id: 927, barbero_id: null, fecha: args.p_fecha, start_time: '16:00', end_time: '18:00' }) }
let sentBefore = sends.length
let step = await n8n(routeCalls.at(-1))
antesDeInsertar = null
assert.equal(step.booking.status, 409, JSON.stringify(step.booking.body))
assert.equal(step.booking.body.error, 'slot_blocked')
assert.notEqual(step.booking.body.booking_created, true)
assert.equal(step.booking.body.booking_mutation_executed, false)
assert.equal(db.tables.turnos.length, 0, 'ningún turno')
assert.equal(step.rejected.body.sent, true, JSON.stringify(step.rejected.body))
assert.equal(sends.length, sentBefore + 1)
assert.equal(sends.at(-1).text, 'No pude reservar ese horario porque el negocio lo bloqueó. No se agendó ningún turno. Puedo ofrecerte: 10:00, 12:30. ¿Cuál te sirve?')
assert.doesNotMatch(sends.at(-1).text, /Listo|quedó reservado/)
const reabierto = stateOf(db, r.id)
assert.equal(reabierto.confirmation_state, 'collecting')
assert.equal(reabierto.ready_for_booking_mutation, false)
assert.deepEqual(reabierto.availability_slots, ['10:00', '12:30'])
// Reintentos de n8n: ni otro mensaje ni otra reserva.
assert.equal((await outbound({ event_id: r.id, kind: 'booking_slot_rejected' }, operator)).body.duplicate, true)
const otraVez = await mutation({ event_id: r.id }, operator)
assert.equal(otraVez.body.error, 'confirmed_booking_state_required')
assert.notEqual(otraVez.body.slot_rejected, true)
assert.equal((await outbound({ event_id: r.id, kind: 'booking_confirmation' }, operator)).body.error, 'booking_not_persisted', 'no se inventa una confirmación')
assert.equal(sends.length, sentBefore + 1)
// El cliente elige otro horario y la conversación sigue: propuesta, confirmación y turno.
r = await send('a las 10')
assert.equal(routeCalls.at(-1).ready_for_booking_mutation, false)
assert.equal((await n8n(routeCalls.at(-1))).reply.body.sent, true)
assert.match(sends.at(-1).text, /^Tengo disponible Corte de prueba QA el .+ a las 10:00\. ¿Confirmás\?$/)
r = await send('Sí')
step = await n8n(routeCalls.at(-1))
assert.equal(step.booking.body.booking_created, true, JSON.stringify(step.booking.body))
assert.match(sends.at(-1).text, /^¡Listo! Tu turno de Corte de prueba QA quedó reservado para el .+ a las 10:00 en Negocio QA\.$/)
assert.deepEqual(db.tables.turnos.map((t) => String(t.hora).slice(0, 5)), ['10:00'])

// 2. El día ya estaba bloqueado al revalidar (bloqueo guardado después de la propuesta).
db = createMemoryDb(fixture(), { rpc })
r = await confirmar16(db)
db.tables.bloqueos_agenda.push({ id: 2, barberia_id: 927, barbero_id: null, fecha: manana(), start_time: '00:00', end_time: '23:59' })
step = await n8n(routeCalls.at(-1))
assert.equal(step.booking.status, 409)
assert.equal(step.booking.body.error, 'slot_blocked', 'la revalidación reconoce el bloqueo')
assert.equal(db.calls.filter((c) => c.rpc === 'crear_reserva_whatsapp').length, 0, 'no intenta insertar')
assert.equal(sends.at(-1).text, 'No pude reservar ese horario porque el negocio lo bloqueó. No se agendó ningún turno. Ese día no quedan otros horarios. ¿Querés que busque otro día?')
assert.equal(db.tables.turnos.length, 0)

// 3. Ocupado por otra reserva en el instante del INSERT.
db = createMemoryDb(fixture(), { rpc })
r = await confirmar16(db)
antesDeInsertar = (base, args) => { if (!base.tables.turnos.length) base.tables.turnos.push({ id: 1, barberia_id: 927, fecha: args.p_fecha, hora: '16:00', estado: 'confirmado', origen: 'web' }) }
step = await n8n(routeCalls.at(-1))
antesDeInsertar = null
assert.equal(step.booking.body.error, 'slot_taken')
assert.match(sends.at(-1).text, /^No pude reservar ese horario porque se acaba de ocupar\. No se agendó ningún turno\. Puedo ofrecerte: 10:00, 12:30\./)
assert.equal(db.tables.turnos.length, 1, 'sólo el turno ajeno')

// 4. Otro error del servidor: sin ofrecer horarios, sin mensaje y sin reabrir.
db = createMemoryDb(fixture(), { rpc })
r = await confirmar16(db)
errorForzado = { code: '42501', message: 'La integración de WhatsApp no está disponible.' }
sentBefore = sends.length
step = await n8n(routeCalls.at(-1))
errorForzado = null
assert.equal(step.booking.body.error, 'booking_creation_failed')
assert.notEqual(step.booking.body.slot_rejected, true)
assert.equal(step.failed, true)
assert.equal(stateOf(db, r.id).confirmation_state, 'confirmed', 'no se reabre ante un error que no es de horario')
assert.equal((await outbound({ event_id: r.id, kind: 'booking_slot_rejected' }, operator)).body.error, 'slot_rejection_not_found')
assert.equal(sends.length, sentBefore)

// 5. Un evento cuya reserva sí se guardó nunca recibe el aviso de rechazo.
db = createMemoryDb(fixture(), { rpc })
r = await confirmar16(db)
step = await n8n(routeCalls.at(-1))
assert.equal(step.booking.body.booking_created, true)
const run = db.tables.saas_automation_shadow_runs.find((row) => row.event_id === r.id)
run.metadata.booking_rejection = { reason: 'slot_blocked', alternatives: [], claim_key: `booking:${run.metadata.conversation_state.conversation_id}:${run.metadata.conversation_state.confirmation_version}` }
run.metadata.conversation_state.confirmation_state = 'collecting'
run.metadata.conversation_state.ready_for_booking_mutation = false
assert.equal((await outbound({ event_id: r.id, kind: 'booking_slot_rejected' }, operator)).body.error, 'booking_already_persisted')

// ---------------------------------------------------------------- n8n
const workflow = JSON.parse(fs.readFileSync(new URL('../integrations/templates/Austral WhatsApp QA - Ruta reserva 36.json', import.meta.url), 'utf8'))
const nodes = Object.fromEntries(workflow.nodes.map((node) => [node.name, node]))
assert.equal(nodes['Guardar reserva'].parameters.options?.response?.response?.neverError, true, 'un 409 llega al IF en lugar de cortar la ejecución')
assert.deepEqual(workflow.connections['¿Turno guardado?'].main[1], [{ node: '¿Horario rechazado?', type: 'main', index: 0 }])
assert.match(JSON.stringify(nodes['¿Horario rechazado?'].parameters), /slot_rejected === true && \$json\.conversation_reopened === true/)
assert.deepEqual(workflow.connections['¿Horario rechazado?'].main, [
  [{ node: 'Ofrecer otro horario', type: 'main', index: 0 }],
  [{ node: 'Reserva no guardada', type: 'main', index: 0 }],
])
assert.match(nodes['Ofrecer otro horario'].parameters.url, /^https:\/\/cmsymmszlzikqpvfqjre\.supabase\.co\/functions\/v1\/whatsapp-agent-outbound-pilot$/)
assert.match(nodes['Ofrecer otro horario'].parameters.jsonBody, /kind: 'booking_slot_rejected'/)
assert.doesNotMatch(nodes['Ofrecer otro horario'].parameters.jsonBody, /retry|reply|text/i, 'n8n no arma ni reenvía texto: lo hace el servidor')
assert.equal(nodes['Ofrecer otro horario'].credentials?.httpCustomAuth?.id, 'australQa36FnSecret')
assert.match(nodes['Reserva no guardada'].parameters.jsCode, /throw new Error/, 'los demás fallos siguen marcando la ejecución')

console.log(JSON.stringify({ task: 41, suite: 'whatsapp-slot-rejected', blocked_race: 'REOFFER', blocked_recheck: 'REOFFER', taken: 'REOFFER', other_error: 'NO_REOFFER', persisted: 'NO_REJECTION', simulated: true, result: 'PASS' }))
