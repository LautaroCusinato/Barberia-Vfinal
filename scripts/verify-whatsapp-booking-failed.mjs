// Reserva confirmada que no se pudo guardar por un motivo que no es el
// horario: el cliente recibe un aviso fijo en vez de silencio, nunca contradice
// un turno guardado y un reintento de n8n no lo repite. Handlers reales con
// Supabase en memoria y fetch simulado para Evolution; no es la prueba real.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  BOOKING_FAILED_REPLY,
  buildBookingFailedOperationId,
  isSafeBookingFailedReply,
} from '../supabase/functions/_shared/whatsappBookingMutation.mjs'
import { canonicalArgentineMobile } from '../supabase/functions/_shared/whatsappCustomer.mjs'
import { QA_BOOKING_ROUTE_URL } from '../supabase/functions/_shared/whatsappQaBookingRoute.mjs'
import { createMemoryDb, harnessEnv, loadEdgeFunction, senderHashFor } from './lib/edgeFunctionHarness.mjs'

// ---------------------------------------------------------------- puros
assert.equal(isSafeBookingFailedReply(BOOKING_FAILED_REPLY), true)
assert.equal(isSafeBookingFailedReply('¡Listo! Tu turno quedó reservado'), false)
assert.equal(isSafeBookingFailedReply(`${BOOKING_FAILED_REPLY} extra`), false, 'sólo el texto fijo')
assert.doesNotMatch(BOOKING_FAILED_REPLY, /^¡Listo/)
assert.match(BOOKING_FAILED_REPLY, /todavía no quedó reservado\./, 'dice explícitamente que no hay turno')
assert.equal(buildBookingFailedOperationId('ABC 123;drop'), 'booking-failed:ABC123drop')
assert.equal(buildBookingFailedOperationId(''), null)
// El guardián se ejercita con los handlers reales: aviso aceptado sin turno y rechazado con turno guardado.

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
// Lo que hace el workflow n8n QA928 versionado (ver contrato al final).
async function n8n({ event_id: eventId, ready_for_booking_mutation: ready }) {
  if (!ready) return { reply: await outbound({ event_id: eventId }, operator) }
  const booking = await mutation({ event_id: eventId }, operator)
  if (booking.body.booking_created === true) return { booking, confirmation: await outbound({ event_id: eventId, kind: 'booking_confirmation' }, operator) }
  if (booking.body.slot_rejected === true && booking.body.conversation_reopened === true) return { booking, rejected: await outbound({ event_id: eventId, kind: 'booking_slot_rejected' }, operator) }
  if (booking.body.booking_follow_up === true && booking.body.conversation_reopened === true) return { booking, reply: await outbound({ event_id: eventId }, operator) }
  return { booking, failed: true, notice: await outbound({ event_id: eventId, kind: 'booking_failed' }, operator) }
}
const stateOf = (db, eventId) => db.tables.saas_automation_shadow_runs.find((row) => row.event_id === eventId).metadata.conversation_state
async function confirmar16(db) {
  await send('Quiero un turno de corte mañana a las 16')
  await n8n(routeCalls.at(-1))
  const r = await send('Sí')
  assert.equal(routeCalls.at(-1).ready_for_booking_mutation, true)
  assert.equal(db.tables.turnos.length, 0)
  return r
}

// 1. Error del servidor que no es de horario: aviso fijo, sin turno ni reapertura.
let db = createMemoryDb(fixture(), { rpc })
let r = await confirmar16(db)
errorForzado = { code: '42501', message: 'La integración de WhatsApp no está disponible.' }
let sentBefore = sends.length
let step = await n8n(routeCalls.at(-1))
errorForzado = null
assert.equal(step.booking.body.error, 'booking_creation_failed')
assert.equal(step.failed, true)
assert.equal(step.notice.body.sent, true, JSON.stringify(step.notice.body))
assert.equal(sends.length, sentBefore + 1)
assert.equal(sends.at(-1).text, BOOKING_FAILED_REPLY)
assert.equal(db.tables.turnos.length, 0, 'ningún turno')
assert.equal(stateOf(db, r.id).confirmation_state, 'confirmed', 'el aviso no cambia la conversación')
// Reintento de n8n: no se repite el aviso.
assert.equal((await outbound({ event_id: r.id, kind: 'booking_failed' }, operator)).body.duplicate, true)
assert.equal(sends.length, sentBefore + 1)

// 2. Estado inválido (409 sin marcas de seguimiento): también avisa.
db = createMemoryDb(fixture(), { rpc })
r = await confirmar16(db)
db.tables.saas_automation_shadow_runs.find((row) => row.event_id === r.id).metadata.conversation_state.ready_for_booking_mutation = false
sentBefore = sends.length
step = await n8n(routeCalls.at(-1))
assert.equal(step.booking.status, 409)
assert.equal(step.booking.body.error, 'confirmed_booking_state_required')
assert.equal(step.notice.body.sent, true, JSON.stringify(step.notice.body))
assert.equal(sends.at(-1).text, BOOKING_FAILED_REPLY)
assert.equal(sends.length, sentBefore + 1)

// 3. Una reserva guardada nunca recibe el aviso de falla.
db = createMemoryDb(fixture(), { rpc })
r = await confirmar16(db)
step = await n8n(routeCalls.at(-1))
assert.equal(step.booking.body.booking_created, true)
sentBefore = sends.length
assert.equal((await outbound({ event_id: r.id, kind: 'booking_failed' }, operator)).body.error, 'booking_already_persisted')
assert.equal(sends.length, sentBefore)

// ---------------------------------------------------------------- n8n
const read = (file) => JSON.parse(fs.readFileSync(new URL('../integrations/templates/' + file, import.meta.url), 'utf8'))
const route = read('Austral WhatsApp QA - Prueba manual 928.json')
const nodes = Object.fromEntries(route.nodes.map((node) => [node.name, node]))
// Privacidad: ninguna ejecución guarda headers, teléfonos ni textos; el motivo
// de un fallo queda en los logs de las funciones (sólo el código).
assert.equal(route.settings.saveDataErrorExecution, 'none')
assert.equal(route.settings.saveDataSuccessExecution, 'none')
assert.deepEqual(route.connections['¿Horario rechazado?'].main[1], [{ node: 'Avisar reserva no guardada', type: 'main', index: 0 }])
assert.deepEqual(route.connections['Avisar reserva no guardada'].main, [[{ node: 'Reserva no guardada', type: 'main', index: 0 }]])
const notice = nodes['Avisar reserva no guardada']
assert.equal(notice.parameters.url, 'https://cmsymmszlzikqpvfqjre.supabase.co/functions/v1/whatsapp-agent-outbound-pilot')
assert.match(notice.parameters.jsonBody, /kind: 'booking_failed'/)
assert.doesNotMatch(notice.parameters.jsonBody, /reply|text/i, 'n8n no arma texto: lo hace el servidor')
assert.deepEqual(notice.credentials, nodes['Ofrecer otro horario'].credentials)
assert.equal(notice.parameters.options?.response?.response?.neverError, true)
assert.match(nodes['Reserva no guardada'].parameters.jsCode, /throw new Error\('booking_not_saved:/, 'la ejecución sigue marcada como fallida')
for (const name of ['Enviar respuesta', 'Enviar confirmación', 'Ofrecer otro horario', 'Avisar reserva no guardada', 'Guardar reserva']) {
  assert.equal(nodes[name].retryOnFail, true, name)
  assert.equal(nodes[name].maxTries, 2, name)
  // Sólo reintenta fallos de red: un 403/409 del servidor es definitivo.
  assert.equal(nodes[name].parameters.options?.response?.response?.neverError, true, name)
}
const language = read('Austral WhatsApp QA - Lenguaje 928.json')
const llm = language.nodes.find((node) => node.name === 'Entender pedido con DeepSeek')
assert.equal(llm.parameters.options.timeout, 4000)
assert.equal(llm.retryOnFail, true)
assert.ok(llm.parameters.options.timeout * llm.maxTries + llm.waitBetweenTries < 9000, 'dentro del límite del webhook')
assert.equal(language.settings.saveDataErrorExecution, 'none')
assert.equal(read('Austral Panel Send - QA manual 928.json').settings.saveDataErrorExecution, 'none')

console.log(JSON.stringify({ suite: 'whatsapp-booking-failed', server_error: 'NOTICE_ONCE', invalid_state: 'NOTICE', persisted: 'NO_NOTICE', n8n_contract: 'PASS', simulated: true, result: 'PASS' }))
