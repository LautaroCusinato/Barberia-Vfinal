// Saludo con enlace: el período de 12 h sólo bloquea un saludo entregado o con
// resultado incierto. Uno rechazado por el proveedor o nunca intentado se
// vuelve a ofrecer en el próximo mensaje, sin duplicar envíos.
// Módulos puros + handlers reales con Supabase en memoria y fetch simulado.
import assert from 'node:assert/strict'
import { classifyEvolutionSendOutcome } from '../supabase/functions/_shared/whatsappAgentOutboundPilot.mjs'
import {
  OFFER_DELIVERY_GRACE_MS,
  isChannelChoicePending,
  offerDeliveryState,
  shouldOfferChannels,
} from '../supabase/functions/_shared/whatsappChannelOffer.mjs'
import { QA_BOOKING_ROUTE_URL } from '../supabase/functions/_shared/whatsappQaBookingRoute.mjs'
import { createMemoryDb, harnessEnv, loadEdgeFunction, senderHashFor } from './lib/edgeFunctionHarness.mjs'

// ---------------------------------------------------------------- puros
assert.equal(classifyEvolutionSendOutcome({ threw: true }), 'uncertain', 'sin respuesta: incierto')
assert.equal(classifyEvolutionSendOutcome({ status: 201 }), 'sent')
for (const status of [400, 401, 403, 404, 422]) assert.equal(classifyEvolutionSendOutcome({ status }), 'rejected', `rechazo ${status}`)
for (const status of [408, 429, 500, 502, 503, 504, null]) assert.equal(classifyEvolutionSendOutcome({ status }), 'uncertain', `incierto ${status}`)

const now = new Date('2026-10-04T21:00:00.000Z')
const justNow = new Date(now.getTime() - 30_000).toISOString()
const longAgo = new Date(now.getTime() - OFFER_DELIVERY_GRACE_MS - 1000).toISOString()
assert.equal(offerDeliveryState({ offerEventId: null, offeredAt: longAgo, now }), null, 'estados previos sin evento: se respeta el período')
assert.equal(offerDeliveryState({ offerEventId: 'E', claim: { status: 'completed' }, offeredAt: longAgo, now }), 'delivered')
assert.equal(offerDeliveryState({ offerEventId: 'E', claim: { status: 'failed' }, offeredAt: justNow, now }), 'failed')
assert.equal(offerDeliveryState({ offerEventId: 'E', claim: { status: 'processing' }, offeredAt: longAgo, now }), 'uncertain')
assert.equal(offerDeliveryState({ offerEventId: 'E', claim: null, offeredAt: justNow, now }), 'pending', 'dentro del margen: todavía puede enviarse')
assert.equal(offerDeliveryState({ offerEventId: 'E', claim: null, offeredAt: longAgo, now }), 'not_attempted')

const offered = { channel_offer_at: justNow, channel_offer_event_id: 'E', channel_choice: null }
const base = { state: offered, intent: 'general_query', extractedFields: {}, linkAvailable: true, now }
for (const delivery of ['failed', 'not_attempted']) assert.equal(shouldOfferChannels({ ...base, previousOfferDelivery: delivery }).offer, true, `se repite si ${delivery}`)
for (const delivery of ['delivered', 'uncertain', 'pending', null]) assert.equal(shouldOfferChannels({ ...base, previousOfferDelivery: delivery }).reason, 'offer_recently_sent', `no se repite si ${delivery}`)
assert.equal(isChannelChoicePending(offered, now, 'failed'), false, 'un saludo no entregado no espera elección')
assert.equal(isChannelChoicePending(offered, now, 'delivered'), true)

// ---------------------------------------------------------------- handlers
const CLIENT_JID = '5491155552851@s.whatsapp.net'
const tz = 'America/Argentina/Buenos_Aires'
const env = {
  SUPABASE_URL: 'https://cmsymmszlzikqpvfqjre.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'harness-only',
  WHATSAPP_PROVISIONING_ENV: 'qa',
  WHATSAPP_MODE: 'shadow',
  PILOT_MODE: 'shadow',
  WHATSAPP_PROVISIONING_ADAPTER: 'evolution',
  EVOLUTION_WEBHOOK_SECRET: 'harness-secret',
  WHATSAPP_OUTBOUND_QA_RECIPIENT: '5491155552851',
  WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH: senderHashFor(CLIENT_JID),
  WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED: '1',
  WHATSAPP_AGENT_OUTBOUND_ALLOWED_TENANT_IDS: '819',
  EVOLUTION_BASE_URL: 'https://evolution.cuchitron.lat',
  EVOLUTION_API_KEY: 'harness-only',
  WHATSAPP_PUBLIC_BOOKING_ORIGIN: 'https://reservas-qa.example.com',
  WHATSAPP_PUBLIC_BOOKING_ENVIRONMENT: 'qa',
  WHATSAPP_QA_BOOKING_ROUTE_TENANT_IDS: '819',
  WHATSAPP_QA_BOOKING_ROUTE_EXPIRES_AT: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}
const setEnv = (overrides = {}) => { harnessEnv.clear(); for (const [k, v] of Object.entries({ ...env, ...overrides })) if (v !== undefined) harnessEnv.set(k, v) }
setEnv()
const fixture = () => ({
  saas_whatsapp_connections: [{ id: 2, barberia_id: 819, integration_id: 22, provider: 'evolution', environment: 'qa', state: 'CONNECTED', instance_name: 'austral-qa-tenant-819' }],
  saas_integraciones: [{ id: 22, barberia_id: 819, proveedor: 'evolution', integration_type: 'whatsapp', estado: 'conectado' }],
  barberias: [{ id: 819, nombre: 'Negocio QA', slug: 'austral-whatsapp-qr-e2e', moneda: 'ARS', zona_horaria: tz, reservas_publicas: true }],
  servicios: [{ id: 3, barberia_id: 819, nombre: 'Corte clásico', precio: 30000, duracion_min: 30, activo: true }],
  barberos: [], horarios_barbero: [], bloqueos_agenda: [],
})

// fetch simulado: la ruta n8n se registra; Evolution responde según el modo.
const routes = []
const sends = []
let evolutionMode = 'ok'
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init = {}) => {
  const href = String(url)
  if (href === QA_BOOKING_ROUTE_URL) { routes.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }) }
  if (href.startsWith('https://evolution.cuchitron.lat/message/sendText/')) {
    if (evolutionMode === 'throw') throw new Error('network')
    if (evolutionMode === 'reject') return new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
    if (evolutionMode === 'gateway') return new Response('', { status: 502 })
    sends.push(JSON.parse(init.body).text)
    return new Response(JSON.stringify({ key: { id: `S${sends.length}` } }), { status: 201 })
  }
  return realFetch(url, init)
}
const webhook = await loadEdgeFunction('whatsapp-evolution-webhook')
const outbound = await loadEdgeFunction('whatsapp-agent-outbound-pilot')
let counter = 0
// Mensaje del cliente + lo que hace n8n con la ruta (enviar la respuesta).
async function message(text) {
  const id = `D${counter += 1}`
  const result = await webhook({ event: 'messages.upsert', instance: 'austral-qa-tenant-819', data: { key: { id, remoteJid: CLIENT_JID, fromMe: false }, message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) } }, { 'X-Austral-Webhook-Secret': 'harness-secret' })
  assert.equal(result.status, 200, JSON.stringify(result.body))
  const send = await outbound({ event_id: id }, { authorization: 'Bearer harness-only' })
  return { id, reply: result.body.proposed_reply, send: send.body }
}
const hasLink = (text) => /reservar\/austral-whatsapp-qr-e2e/.test(text || '')
function ageOffer(db, minutes = 3) {
  const run = db.tables.saas_automation_shadow_runs.at(-1)
  run.metadata.conversation_state.channel_offer_at = new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

// 1. Saludo nunca intentado (piloto apagado, como el error de credencial del 04/10).
let db = createMemoryDb(fixture())
setEnv({ WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED: '0' })
let r = await message('Hola')
assert.ok(hasLink(r.reply))
assert.equal(r.send.error, 'agent_outbound_pilot_disabled')
assert.equal(db.tables.saas_automation_events.length, 0, 'sin reclamo: nunca se intentó')
setEnv()
r = await message('Hola, ¿estás?')
assert.ok(!hasLink(r.reply), 'dentro del margen no se duplica')
const prior = db.tables.saas_automation_shadow_runs.findLast((row) => row.metadata.conversation_state.channel_offer_event_id === 'D1')
prior.metadata.conversation_state.channel_offer_at = new Date(Date.now() - 3 * 60 * 1000).toISOString()
for (const row of db.tables.saas_automation_shadow_runs) row.metadata.conversation_state.channel_offer_at = prior.metadata.conversation_state.channel_offer_at
r = await message('Hola de nuevo')
assert.ok(hasLink(r.reply), 'pasado el margen, el saludo no intentado se repite automáticamente')
assert.equal(r.send.sent, true)
assert.equal(sends.filter(hasLink).length, 1)
r = await message('Buenas')
assert.ok(!hasLink(r.reply), 'entregado: no se repite')

// 2. Rechazo confirmado del proveedor: se repite en el próximo mensaje.
db = createMemoryDb(fixture())
evolutionMode = 'reject'
r = await message('Hola')
assert.equal(r.send.send_outcome, 'rejected')
assert.equal(db.tables.saas_automation_events.at(-1).status, 'failed')
evolutionMode = 'ok'
const before = sends.length
r = await message('¿Hola?')
assert.ok(hasLink(r.reply), 'rechazado: se vuelve a ofrecer de inmediato')
assert.equal(r.send.sent, true)
assert.equal(sends.length, before + 1)
r = await message('Ok')
assert.ok(!hasLink(r.reply))

// 3. Resultado incierto (sin respuesta o 502): no se repite, aunque pase el margen.
for (const mode of ['throw', 'gateway']) {
  db = createMemoryDb(fixture())
  evolutionMode = mode
  r = await message('Hola')
  assert.equal(r.send.send_outcome, 'uncertain', mode)
  assert.equal(db.tables.saas_automation_events.at(-1).status, 'processing', 'el reclamo bloquea duplicados')
  evolutionMode = 'ok'
  ageOffer(db, 30)
  r = await message('Hola otra vez')
  assert.ok(!hasLink(r.reply), `incierto (${mode}): no se arriesga un duplicado`)
  const retry = await outbound({ event_id: 'D' + (counter - 1) }, { authorization: 'Bearer harness-only' })
  assert.equal(retry.body.duplicate, true, 'el mismo envío incierto no se reintenta')
}

console.log(JSON.stringify({ suite: 'whatsapp-offer-delivery', not_attempted: 'REOFFER_AFTER_GRACE', rejected: 'REOFFER', uncertain: 'NO_REPEAT', delivered: 'NO_REPEAT', simulated: true, result: 'PASS' }))
