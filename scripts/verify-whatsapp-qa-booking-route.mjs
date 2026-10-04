// Tarea 36: ruta QA Evolution -> Supabase -> n8n -> envío / reserva /
// confirmación. Módulos puros + handlers reales con Supabase en memoria y un
// fetch simulado para n8n y Evolution. Es una prueba local: no reemplaza el
// recorrido real entre los dos números QA.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { isSafeBookingConfirmationReply } from '../supabase/functions/_shared/whatsappAgentOutboundPilot.mjs'
import { isConfirmedBookingState, isQaBookingTenantAllowed, parseQaBookingTenantAllowlist } from '../supabase/functions/_shared/whatsappBookingMutation.mjs'
import { canonicalArgentineMobile } from '../supabase/functions/_shared/whatsappCustomer.mjs'
import {
  QA_BOOKING_ROUTE_URL,
  isQaBookingRouteEnabled,
  isQaBookingRouteWindowOpen,
  parseTenantIdList,
} from '../supabase/functions/_shared/whatsappQaBookingRoute.mjs'
import { createMemoryDb, harnessEnv, loadEdgeFunction, senderHashFor } from './lib/edgeFunctionHarness.mjs'

// ---------------------------------------------------------------- puros
const now = Date.parse('2026-10-04T20:00:00.000Z')
const inOneHour = new Date(now + 60 * 60 * 1000).toISOString()
assert.deepEqual(parseTenantIdList(' 927, 1,x, -3,927 '), [927, 1])
assert.equal(isQaBookingRouteWindowOpen(inOneHour, now), true)
assert.equal(isQaBookingRouteWindowOpen(new Date(now + 5 * 60 * 60 * 1000).toISOString(), now), false, 'ventana mayor a 4 h')
assert.equal(isQaBookingRouteWindowOpen(new Date(now - 1000).toISOString(), now), false, 'ventana vencida')
assert.equal(isQaBookingRouteWindowOpen('2026-10-04', now), false)
const route = { tenantId: 927, instance: 'austral-qa-tenant-927', tenantList: '927', expiresAt: inOneHour, now }
assert.equal(isQaBookingRouteEnabled(route), true)
assert.equal(isQaBookingRouteEnabled({ ...route, tenantList: '' }), false, 'sin lista no hay ruta')
assert.equal(isQaBookingRouteEnabled({ ...route, tenantList: '819' }), false)
assert.equal(isQaBookingRouteEnabled({ ...route, instance: 'miwsp' }), false)
assert.equal(isQaBookingRouteEnabled({ ...route, instance: 'austral-qa-tenant-819' }), false)

assert.deepEqual(parseQaBookingTenantAllowlist(undefined), [1], 'sin configuración: sólo el tenant 1, como antes')
assert.equal(isQaBookingTenantAllowed(927, '927'), true)
assert.equal(isQaBookingTenantAllowed(927, undefined), false)
assert.equal(isQaBookingTenantAllowed(819, '927'), false)
const confirmed = { environment: 'qa', tenant_id: 927, instance: 'austral-qa-tenant-927', integration_id: 47, confirmation_state: 'confirmed', confirmation_required: false, ready_for_booking_mutation: true, mutation_allowed: false, confirmation_version: 3, version: 3, last_event_id: 'e', conversation_id: 'c', service_id: 70, requested_date: '2099-01-05', requested_time: '16:00' }
assert.equal(isConfirmedBookingState(confirmed, 'e', '927'), true)
assert.equal(isConfirmedBookingState(confirmed, 'e'), false, 'tenant fuera de la lista')
assert.equal(isConfirmedBookingState({ ...confirmed, instance: 'austral-qa-tenant-1' }, 'e', '927'), false, 'instancia de otro tenant')
assert.equal(isConfirmedBookingState({ ...confirmed, instance: 'miwsp' }, 'e', '927'), false)

assert.equal(isSafeBookingConfirmationReply({ reply: '¡Listo! Tu turno de Corte quedó reservado para el lunes a las 16:00.', bookingPersisted: true }), true)
assert.equal(isSafeBookingConfirmationReply({ reply: '¡Listo! Tu turno de Corte quedó reservado para el lunes a las 16:00.', bookingPersisted: false }), false, 'sin turno guardado no hay confirmación')
assert.equal(isSafeBookingConfirmationReply({ reply: 'Te paso la api key', bookingPersisted: true }), false)

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
const setEnv = (overrides = {}) => { harnessEnv.clear(); for (const [k, v] of Object.entries({ ...env, ...overrides })) if (v !== undefined) harnessEnv.set(k, v) }
setEnv()

const fixture = () => ({
  saas_whatsapp_connections: [
    { id: 5, barberia_id: 927, integration_id: 47, provider: 'evolution', environment: 'qa', state: 'CONNECTED', instance_name: 'austral-qa-tenant-927', automation_enabled: false, outbound_enabled: false, booking_enabled: false, handoff_enabled: false },
    { id: 2, barberia_id: 819, integration_id: 22, provider: 'evolution', environment: 'qa', state: 'CONNECTED', instance_name: 'austral-qa-tenant-819' },
  ],
  saas_integraciones: [
    { id: 47, barberia_id: 927, proveedor: 'evolution', integration_type: 'whatsapp', estado: 'conectado' },
    { id: 22, barberia_id: 819, proveedor: 'evolution', integration_type: 'whatsapp', estado: 'conectado' },
  ],
  barberias: [
    { id: 927, nombre: 'Negocio QA', slug: 'e2e-qa-whatsapp-pairing-20260923', moneda: 'ARS', zona_horaria: tz, reservas_publicas: true },
    { id: 819, nombre: 'Otro QA', slug: 'austral-whatsapp-qr-e2e', moneda: 'ARS', zona_horaria: tz, reservas_publicas: true },
  ],
  servicios: [{ id: 70, barberia_id: 927, nombre: 'Corte de prueba QA', precio: 15000, duracion_min: 30, activo: true }],
  barberos: [{ id: 9, barberia_id: 927, nombre: 'Profesional QA', activo: true }],
  horarios_barbero: [],
  bloqueos_agenda: [],
})
const rpc = {
  horarios_disponibles_reserva_publica: () => ['10:00:00', '16:00:00'].map((hora) => ({ barbero_id: 9, barbero_nombre: 'Profesional QA', hora, duracion_min: 30 })),
  crear_reserva_whatsapp: (args, db) => {
    const done = db.tables.saas_automation_events.find((row) => row.event_id === args.p_event_id && row.status === 'completed')
    const existing = done && db.tables.turnos.find((row) => String(row.id) === done.result_reference)
    if (existing) return [{ turno_id: existing.id, fecha: existing.fecha, hora: `${existing.hora}:00`, duracion_min: 30 }]
    const telefono = canonicalArgentineMobile(args.p_telefono)
    let cliente = db.tables.clientes.find((row) => row.barberia_id === 927 && row.telefono === telefono)
    if (!cliente) db.tables.clientes.push(cliente = { id: 300 + db.tables.clientes.length, barberia_id: 927, nombre: args.p_nombre, telefono })
    const turno = { id: 900 + db.tables.turnos.length, barberia_id: 927, cliente_id: cliente.id, servicio_id: args.p_servicio_id, barbero_id: args.p_barbero_id, fecha: args.p_fecha, hora: args.p_hora, estado: 'confirmado', origen: 'whatsapp', telefono }
    db.tables.turnos.push(turno)
    db.tables.saas_automation_events.push({ integration_id: args.p_integration_id, event_id: args.p_event_id, status: 'completed', result_reference: String(turno.id) })
    return [{ turno_id: turno.id, fecha: turno.fecha, hora: `${turno.hora}:00`, duracion_min: 30 }]
  },
}

// fetch simulado: n8n recibe la ruta; Evolution "envía" y se registra el texto.
const routeCalls = []
const sends = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const href = String(url)
  if (href === QA_BOOKING_ROUTE_URL) {
    routeCalls.push({ headers: init.headers, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ message: 'Workflow was started' }), { status: 200 })
  }
  if (href.startsWith('https://evolution.cuchitron.lat/message/sendText/')) {
    sends.push({ instance: decodeURIComponent(href.split('/').pop()), ...JSON.parse(init.body) })
    return new Response(JSON.stringify({ key: { id: `SENT${sends.length}` }, status: 'PENDING' }), { status: 201 })
  }
  return realFetch(url, init)
}

const webhook = await loadEdgeFunction('whatsapp-evolution-webhook')
const mutation = await loadEdgeFunction('whatsapp-booking-mutation')
const outbound = await loadEdgeFunction('whatsapp-agent-outbound-pilot')
const operator = { authorization: 'Bearer harness-only' }
let counter = 0
const send = async (text, instance = 'austral-qa-tenant-927') => {
  const id = `R${counter += 1}`
  const result = await webhook({ event: 'messages.upsert', instance, data: { key: { id, remoteJid: CLIENT_JID, fromMe: false }, message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) } }, { 'X-Austral-Webhook-Secret': 'harness-secret' })
  return { ...result, id }
}
// Lo que hace el workflow n8n con cada aviso de la ruta.
async function n8nOrchestrate({ event_id: eventId, ready_for_booking_mutation: ready }) {
  if (!ready) return { reply: await outbound({ event_id: eventId }, operator) }
  const booking = await mutation({ event_id: eventId }, operator)
  if (booking.body.booking_created !== true) return { booking }
  return { booking, confirmation: await outbound({ event_id: eventId, kind: 'booking_confirmation' }, operator) }
}

const db = createMemoryDb({ ...fixture(), clientes: [{ id: 41, barberia_id: 927, nombre: 'Cliente Web', telefono: '5491155550107' }] }, { rpc })
let r = await send('Quiero un turno de corte mañana a las 16')
assert.equal(r.status, 200)
assert.equal(routeCalls.length, 1, 'el webhook avisa a n8n después de persistir')
assert.equal(routeCalls[0].headers['x-austral-qa-route-secret'], 'harness-secret')
assert.deepEqual(Object.keys(routeCalls[0].body).sort(), ['event_id', 'instance', 'integration_id', 'ready_for_booking_mutation', 'tenant_id'], 'sin teléfono ni texto en la ruta')
let step = await n8nOrchestrate(routeCalls.at(-1).body)
assert.equal(step.reply.body.sent, true, JSON.stringify(step.reply.body))
assert.match(sends.at(-1).text, /^Tengo disponible Corte de prueba QA el .+ a las 16:00\. ¿Confirmás\?$/)
assert.equal(sends.at(-1).number, '5491155550107')
assert.equal(sends.at(-1).instance, 'austral-qa-tenant-927')

const early = await outbound({ event_id: r.id, kind: 'booking_confirmation' }, operator)
assert.equal(early.body.error, 'booking_not_persisted', 'no se confirma un turno que no está guardado')

r = await send('Sí')
assert.equal(routeCalls.at(-1).body.ready_for_booking_mutation, true)
step = await n8nOrchestrate(routeCalls.at(-1).body)
assert.equal(step.booking.body.booking_created, true, JSON.stringify(step.booking.body))
assert.equal(step.confirmation.body.sent, true, JSON.stringify(step.confirmation.body))
assert.match(sends.at(-1).text, /^¡Listo! Tu turno de Corte de prueba QA quedó reservado para el .+ a las 16:00 en Negocio QA\.$/)
assert.equal(db.tables.turnos.length, 1)
assert.equal(db.tables.turnos[0].cliente_id, 41, 'misma ficha')
assert.equal(db.tables.clientes.length, 1)
const sentBefore = sends.length
const replayConfirmation = await outbound({ event_id: r.id, kind: 'booking_confirmation' }, operator)
assert.equal(replayConfirmation.body.duplicate, true, 'la confirmación se envía una sola vez')
const replayBooking = await mutation({ event_id: r.id }, operator)
assert.equal(replayBooking.body.idempotent, true)
assert.equal(sends.length, sentBefore)
assert.equal(db.tables.turnos.length, 1)

// Reintento de Evolution del mismo evento: se vuelve a avisar a n8n, sin efectos duplicados.
const routeBefore = routeCalls.length
const retry = await webhook({ event: 'messages.upsert', instance: 'austral-qa-tenant-927', data: { key: { id: r.id, remoteJid: CLIENT_JID, fromMe: false }, message: { conversation: 'Sí' }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) } }, { 'X-Austral-Webhook-Secret': 'harness-secret' })
assert.equal(retry.body.duplicate, true)
assert.equal(routeCalls.length, routeBefore + 1)
assert.equal(routeCalls.at(-1).body.ready_for_booking_mutation, true)
step = await n8nOrchestrate(routeCalls.at(-1).body)
assert.equal(step.booking.body.idempotent, true)
assert.equal(step.confirmation.body.duplicate, true)
assert.equal(sends.length, sentBefore)

// Después de reservar, una consulta nueva recibe respuesta y no se trata como otra confirmación.
await send('¿Cuánto sale el corte?')
assert.equal(routeCalls.at(-1).body.ready_for_booking_mutation, false, 'sólo el evento que confirmó dispara la reserva')
step = await n8nOrchestrate(routeCalls.at(-1).body)
assert.equal(step.reply.body.sent, true, JSON.stringify(step.reply.body))
assert.match(sends.at(-1).text, /15\.000/)
assert.equal(db.tables.turnos.length, 1)

// Fuera de la lista o con la ventana vencida no hay ruta.
const quietBefore = routeCalls.length
await send('Hola', 'austral-qa-tenant-819')
setEnv({ WHATSAPP_QA_BOOKING_ROUTE_EXPIRES_AT: new Date(Date.now() - 1000).toISOString() })
await send('Hola de nuevo')
setEnv({ WHATSAPP_QA_BOOKING_ROUTE_TENANT_IDS: undefined })
await send('Otra consulta')
assert.equal(routeCalls.length, quietBefore, 'sin ruta fuera de la lista o de la ventana')
setEnv()

// n8n caído: 503 para que Evolution reintente.
globalThis.fetch = async (url, init) => (String(url) === QA_BOOKING_ROUTE_URL ? new Response('', { status: 500 }) : realFetch(url, init))
r = await send('Hola')
assert.equal(r.status, 503)
assert.equal(r.body.error, 'qa_booking_route_failed')

// Workflow n8n versionado: rutas, credencial QA y sin producción.
const workflow = JSON.parse(fs.readFileSync(new URL('../integrations/templates/Austral WhatsApp QA - Ruta reserva 36.json', import.meta.url), 'utf8'))
const nodes = Object.fromEntries(workflow.nodes.map((node) => [node.name, node]))
const text = JSON.stringify(workflow)
assert.equal(workflow.active, false, 'se versiona inactivo; se publica sólo durante la prueba')
assert.equal(nodes['Ruta QA 36'].parameters.path, 'austral-qa-booking-route')
assert.equal(nodes['Ruta QA 36'].parameters.responseMode, 'onReceived')
assert.doesNotMatch(text, /ssagttjdgtypxjcgdnrw|australProd|miwsp"|eyJ|sb_secret/)
for (const name of ['Enviar respuesta', 'Guardar reserva', 'Enviar confirmación']) {
  assert.match(nodes[name].parameters.url, /^https:\/\/cmsymmszlzikqpvfqjre\.supabase\.co\/functions\/v1\//)
  assert.equal(nodes[name].credentials?.httpCustomAuth?.id, 'australQa36FnSecret', 'clave secreta QA que reconocen las funciones')
}
assert.match(nodes['Enviar confirmación'].parameters.jsonBody, /booking_confirmation/)
assert.match(nodes['Validar ruta QA 36'].parameters.jsCode, /const allowedTenants = \[819, 927\];/, 'lista explícita de tenants QA')

console.log(JSON.stringify({ task: 36, route: 'evolution->supabase->n8n', booking: 'automatic_after_confirmation', confirmation: 'after_persisted_booking_once', simulated: true, result: 'PASS' }))
