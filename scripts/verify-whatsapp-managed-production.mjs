// WhatsApp administrado en producción: un negocio cualquiera (42) vincula su
// WhatsApp desde el panel y el bot responde, guarda la bandeja, reserva y
// confirma para un cliente nuevo, con los mismos handlers reales que QA928.
// Simulación local (Supabase en memoria, fetch simulado para n8n/Evolution):
// no reemplaza la prueba con un teléfono real.
import assert from 'node:assert/strict'
import { managedRuntimeProfile } from '../supabase/functions/_shared/qaManualRuntime.mjs'
import { buildManagedWorkflows } from './prepare-whatsapp-managed-workflows.mjs'
import { qaManualMessageRpc } from './lib/qaManualMessageHarness.mjs'
import { createMemoryDb, harnessEnv, loadEdgeFunction } from './lib/edgeFunctionHarness.mjs'

const TENANT = 42
const INSTANCE = `austral-prod-tenant-${TENANT}`
const CLIENT_PHONE = '5491155554242'
const CLIENT_JID = `${CLIENT_PHONE}@s.whatsapp.net`
const tz = 'America/Argentina/Buenos_Aires'
const env = {
  SUPABASE_URL: 'https://ssagttjdgtypxjcgdnrw.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'harness-only',
  WHATSAPP_RUNTIME_ENV: 'production',
  WHATSAPP_MANAGED_RUNTIME_ENABLED: '1',
  EVOLUTION_WEBHOOK_SECRET: 'harness-secret',
  EVOLUTION_BASE_URL: 'https://evolution.cuchitron.lat',
  EVOLUTION_API_KEY: 'harness-only',
  // Producción usa el asistente completo, como la prueba manual 928.
  WHATSAPP_QA_MANUAL_CONCIERGE_ENABLED: '1',
}
const setEnv = (overrides = {}) => { harnessEnv.clear(); for (const [k, v] of Object.entries({ ...env, ...overrides })) if (v !== undefined) harnessEnv.set(k, v) }
setEnv()

// ---------------------------------------------------------------- perfil
const get = (overrides = {}) => (key) => ({ ...env, ...overrides })[key]
assert.equal(managedRuntimeProfile(get()).environment, 'production')
assert.equal(managedRuntimeProfile(get({ WHATSAPP_MANAGED_RUNTIME_ENABLED: undefined })), null, 'producción apagada sin la habilitación explícita')
assert.equal(managedRuntimeProfile(get({ WHATSAPP_RUNTIME_ENV: 'qa' })), null)
assert.equal(managedRuntimeProfile(get({ SUPABASE_URL: 'https://ssagttjdgtypxjcgdnrw.supabase.co.evil.example' })), null)

// ---------------------------------------------------------------- workflows
const workflows = buildManagedWorkflows()
for (const [file, workflow] of Object.entries(workflows)) {
  const text = JSON.stringify(workflow)
  assert.equal(workflow.active, false, file)
  assert.doesNotMatch(text, /cmsymmszlzikqpvfqjre|austral-qa-tenant-|australQa36FnSecret/, `${file}: sin QA`)
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none', file)
  assert.equal(workflow.settings.saveDataErrorExecution, 'none', file)
}
const route = workflows['Austral WhatsApp Administrado - Ruta.json']
const validate = new Function('$input', '$env', route.nodes.find((n) => n.name === 'Validar ruta QA 36').parameters.jsCode)
const input = (body, secret = 'harness-secret') => ({ first: () => ({ json: { body, headers: { 'x-austral-qa-route-secret': secret } } }) })
const goodRoute = { event_id: 'E1', tenant_id: TENANT, integration_id: 7, instance: INSTANCE, ready_for_booking_mutation: false }
assert.equal(validate(input(goodRoute), { EVOLUTION_WEBHOOK_SECRET: 'harness-secret' })[0].json.tenant_id, TENANT)
assert.throws(() => validate(input({ ...goodRoute, instance: 'austral-prod-tenant-43' }), { EVOLUTION_WEBHOOK_SECRET: 'harness-secret' }), /tenant_rejected/)
assert.throws(() => validate(input({ ...goodRoute, instance: 'miwsp' }), { EVOLUTION_WEBHOOK_SECRET: 'harness-secret' }), /tenant_rejected/)
assert.throws(() => validate(input(goodRoute, 'otro'), { EVOLUTION_WEBHOOK_SECRET: 'harness-secret' }), /unauthorized/)

// ---------------------------------------------------------------- handlers
const fixture = () => ({
  saas_whatsapp_connections: [
    { id: 11, barberia_id: TENANT, integration_id: 7, provider: 'evolution', environment: 'production', state: 'CONNECTED', instance_name: INSTANCE, automation_enabled: true, outbound_enabled: true, booking_enabled: true, handoff_enabled: false },
  ],
  saas_integraciones: [{ id: 7, barberia_id: TENANT, proveedor: 'evolution', integration_type: 'whatsapp', estado: 'conectado' }],
  barberias: [{ id: TENANT, nombre: 'Barbería Real', slug: 'barberia-real', moneda: 'ARS', zona_horaria: tz, reservas_publicas: true }],
  servicios: [{ id: 70, barberia_id: TENANT, nombre: 'Corte', precio: 12000, duracion_min: 30, activo: true }],
  barberos: [{ id: 9, barberia_id: TENANT, nombre: 'Lucas', activo: true }],
  horarios_barbero: [],
  bloqueos_agenda: [],
})
const rpc = {
  ...qaManualMessageRpc,
  horarios_disponibles_reserva_publica: () => ['10:00:00', '16:00:00'].map((hora) => ({ barbero_id: 9, barbero_nombre: 'Lucas', hora, duracion_min: 30 })),
  crear_reserva_whatsapp: (args, db) => {
    const done = db.tables.saas_automation_events.find((row) => row.event_id === args.p_event_id && row.status === 'completed')
    const existing = done && db.tables.turnos.find((row) => String(row.id) === done.result_reference)
    if (existing) return [{ turno_id: existing.id, fecha: existing.fecha, hora: `${existing.hora}:00`, duracion_min: 30 }]
    let cliente = db.tables.clientes.find((row) => row.barberia_id === TENANT && row.telefono === args.p_telefono)
    if (!cliente) db.tables.clientes.push(cliente = { id: 300 + db.tables.clientes.length, barberia_id: TENANT, nombre: args.p_nombre, telefono: args.p_telefono })
    const turno = { id: 900 + db.tables.turnos.length, barberia_id: TENANT, cliente_id: cliente.id, servicio_id: args.p_servicio_id, barbero_id: args.p_barbero_id, paciente: cliente.nombre, precio: 12000, fecha: args.p_fecha, hora: args.p_hora, estado: 'confirmado', origen: 'whatsapp', telefono: args.p_telefono }
    db.tables.turnos.push(turno)
    db.tables.saas_automation_events.push({ integration_id: args.p_integration_id, event_id: args.p_event_id, status: 'completed', result_reference: String(turno.id) })
    return [{ turno_id: turno.id, fecha: turno.fecha, hora: `${turno.hora}:00`, duracion_min: 30 }]
  },
}

const profile = managedRuntimeProfile(get())
const routeCalls = []
const sends = []
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const href = String(url)
  if (href === profile.route) {
    routeCalls.push({ headers: init.headers, body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ message: 'Workflow was started' }), { status: 200 })
  }
  if (href === profile.languageRoute) return new Response(JSON.stringify({ goal: 'unclear', confidence: 0 }), { status: 200 })
  if (href.startsWith('https://evolution.cuchitron.lat/message/sendText/')) {
    sends.push({ instance: decodeURIComponent(href.split('/').pop()), ...JSON.parse(init.body) })
    return new Response(JSON.stringify({ key: { id: `SENT${sends.length}` }, status: 'PENDING' }), { status: 201 })
  }
  throw new Error(`fetch inesperado: ${href}`)
}

const webhook = await loadEdgeFunction('whatsapp-evolution-webhook')
const mutation = await loadEdgeFunction('whatsapp-booking-mutation')
const outbound = await loadEdgeFunction('whatsapp-agent-outbound-pilot')
const operator = { authorization: 'Bearer harness-only' }
let counter = 0
const send = async (text, instance = INSTANCE) => {
  const id = `P${counter += 1}`
  const result = await webhook({ event: 'messages.upsert', instance, data: { key: { id, remoteJid: CLIENT_JID, fromMe: false }, message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) } }, { 'X-Austral-Webhook-Secret': 'harness-secret' })
  return { ...result, id }
}
async function n8nOrchestrate({ event_id: eventId, ready_for_booking_mutation: ready }) {
  if (!ready) return { reply: await outbound({ event_id: eventId }, operator) }
  const booking = await mutation({ event_id: eventId }, operator)
  if (booking.body.booking_created !== true) return { booking }
  return { booking, confirmation: await outbound({ event_id: eventId, kind: 'booking_confirmation' }, operator) }
}

const db = createMemoryDb(fixture(), { rpc })

// Instancias ajenas al entorno o protegidas no entran.
assert.equal((await send('Hola', 'austral-qa-tenant-42')).status, 403)
assert.equal((await send('Hola', 'miwsp')).status, 403)
assert.equal(routeCalls.length, 0)

// Cliente nuevo: pide turno, da su nombre y confirma.
let r = await send('Quiero un turno de corte mañana a las 16')
assert.equal(r.status, 200, JSON.stringify(r.body))
assert.equal(routeCalls.length, 1, 'el webhook avisa a n8n después de persistir')
assert.deepEqual(routeCalls[0].body, { event_id: r.id, tenant_id: TENANT, integration_id: 7, instance: INSTANCE, ready_for_booking_mutation: false })
let step = await n8nOrchestrate(routeCalls.at(-1).body)
assert.equal(step.reply.body.sent, true, JSON.stringify(step.reply.body))
assert.equal(sends.at(-1).instance, INSTANCE, 'responde por el WhatsApp del negocio')
assert.equal(sends.at(-1).number, CLIENT_PHONE, 'responde sólo al remitente real')
assert.equal(db.tables.mensajes.filter((m) => m.barberia_id === TENANT && m.de === 'paciente').length, 1, 'el mensaje del cliente queda en la bandeja')
assert.equal(db.tables.mensajes.filter((m) => m.barberia_id === TENANT && m.de === 'bot').length, 1, 'la respuesta del bot queda en la bandeja')

// El bot sigue la conversación hasta confirmar (nombre, si lo pide, y "Sí").
for (const answer of ['Soy Martina Gómez', 'Sí']) {
  if (db.tables.turnos.length) break
  r = await send(answer)
  assert.equal(r.status, 200, JSON.stringify(r.body))
  step = await n8nOrchestrate(routeCalls.at(-1).body)
  if (!routeCalls.at(-1).body.ready_for_booking_mutation) assert.equal(step.reply.body.sent, true, JSON.stringify(step.reply.body))
}
if (!db.tables.turnos.length) {
  r = await send('Sí')
  step = await n8nOrchestrate(routeCalls.at(-1).body)
}
assert.equal(step.booking?.body.booking_created, true, `reserva: ${JSON.stringify(step.booking?.body || step.reply?.body)} / último texto: ${sends.at(-1)?.text}`)
assert.equal(step.confirmation.body.sent, true, JSON.stringify(step.confirmation.body))
assert.equal(db.tables.turnos.length, 1)
assert.equal(db.tables.turnos[0].barberia_id, TENANT)
assert.equal(db.tables.turnos[0].telefono, CLIENT_PHONE)
assert.match(sends.at(-1).text, /^¡Listo! Tu turno quedó reservado ✅\n👤 Martina Gómez\n✂️ Corte/)
assert.match(sends.at(-1).text, /Barbería Real/)
assert.ok(sends.every((sent) => sent.instance === INSTANCE && sent.number === CLIENT_PHONE))

// Un reintento no duplica reserva ni confirmación.
const before = sends.length
assert.equal((await mutation({ event_id: r.id }, operator)).body.idempotent, true)
assert.equal((await outbound({ event_id: r.id, kind: 'booking_confirmation' }, operator)).body.duplicate, true)
assert.equal(sends.length, before)

// Sin la habilitación de producción, nada corre (falla cerrada).
setEnv({ WHATSAPP_MANAGED_RUNTIME_ENABLED: undefined })
const routesBefore = routeCalls.length
assert.equal((await send('¿Cuánto sale el corte?')).status, 503)
assert.equal(routeCalls.length, routesBefore)
setEnv()

// Bot pausado por el negocio: guarda el mensaje pero no responde.
db.tables.config.push({ barberia_id: TENANT, clave: 'bot_activo', valor: 'false' })
const inboxBefore = db.tables.mensajes.length
r = await send('¿Hay lugar el sábado?')
assert.equal(r.body.reason, 'bot_paused')
assert.equal(db.tables.mensajes.length, inboxBefore + 1, 'el mensaje igual llega a la bandeja')
assert.equal(routeCalls.length, routesBefore)

globalThis.fetch = realFetch
console.log(`WhatsApp administrado producción (negocio ${TENANT}): conversación, bandeja, reserva, confirmación única y apagado PASS (simulado)`)
