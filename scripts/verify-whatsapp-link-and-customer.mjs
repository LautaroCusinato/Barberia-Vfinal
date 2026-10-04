// Tarea 35: oferta de reserva web o por chat y ficha única de cliente.
// Parte A: módulos puros. Parte B: handlers reales de las Edge Functions con
// un Supabase en memoria (simulación local: no hay WhatsApp, Evolution, n8n
// ni base real; la prueba integral es la tarea 36).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { isSafePersistedReply } from '../supabase/functions/_shared/whatsappAgentOutboundPilot.mjs'
import { normalizeCustomerReply } from '../supabase/functions/_shared/whatsappAgentShadow.mjs'
import { buildBookingConfirmedReply } from '../supabase/functions/_shared/whatsappBookingMutation.mjs'
import { evaluateBotPause } from '../supabase/functions/_shared/whatsappBotPause.mjs'
import {
  CHANNEL_OFFER_COOLDOWN_MS,
  buildChannelOfferReply,
  buildLinkResendReply,
  buildPublicBookingLink,
  buildWebChoiceReply,
  classifyChannelChoice,
  isChannelChoicePending,
  shouldOfferChannels,
  validatePublicBookingOrigin,
} from '../supabase/functions/_shared/whatsappChannelOffer.mjs'
import { advanceConversationTurn, applyWebChannelTurn } from '../supabase/functions/_shared/whatsappConversationRuntime.mjs'
import { canonicalArgentineMobile, extractCustomerName, resolveBookingCustomer } from '../supabase/functions/_shared/whatsappCustomer.mjs'
import { createMemoryDb, harnessEnv, loadEdgeFunction, senderHashFor } from './lib/edgeFunctionHarness.mjs'
import { MANUAL_PAUSE_EVALUATOR } from './lib/whatsappManualPauseGate.mjs'

// ---------------------------------------------------------------- Parte A
const QA_ORIGIN = 'https://reservas-qa.example.com'
const link = (overrides = {}) => buildPublicBookingLink({ origin: QA_ORIGIN, declaredEnvironment: 'qa', runtimeEnvironment: 'qa', slug: 'austral-qa-tenant-1', publicBookingEnabled: true, ...overrides })

assert.deepEqual(link(), { available: true, reason: null, url: 'https://reservas-qa.example.com/reservar/austral-qa-tenant-1' })
assert.equal(link({ origin: 'https://reservas-qa.example.com/' }).url, 'https://reservas-qa.example.com/reservar/austral-qa-tenant-1', 'barra final aceptada')
for (const [origin, reason] of [
  ['', 'booking_origin_missing'],
  ['no es url', 'booking_origin_invalid'],
  ['http://reservas-qa.example.com', 'booking_origin_not_https'],
  ['https://user:pass@reservas-qa.example.com', 'booking_origin_invalid'],
  ['https://reservas-qa.example.com/reservar/otro', 'booking_origin_not_origin'],
  ['https://reservas-qa.example.com?x=1', 'booking_origin_not_origin'],
  ['https://localhost:5173', 'booking_origin_not_public'],
  ['https://127.0.0.1', 'booking_origin_not_public'],
  ['https://app.local', 'booking_origin_not_public'],
  ['https://[::1]', 'booking_origin_not_public'],
]) assert.equal(link({ origin }).reason, reason, `origen ${origin}`)
assert.equal(validatePublicBookingOrigin('https://Reservas-QA.example.com').origin, 'https://reservas-qa.example.com')
assert.equal(link({ declaredEnvironment: 'production' }).reason, 'booking_origin_environment_mismatch', 'config copiada de otro entorno')
assert.equal(link({ declaredEnvironment: '' }).reason, 'booking_origin_environment_mismatch')
assert.equal(link({ origin: 'https://barberia-177.pages.dev' }).reason, 'booking_origin_environment_mismatch', 'QA nunca enlaza al frontend productivo')
assert.equal(link({ runtimeEnvironment: '' }).reason, 'runtime_environment_required')
for (const slug of [null, '', 'Mayus', 'con espacio', '../otro', 'a/b', '-x', `${'a'.repeat(81)}`]) assert.equal(link({ slug }).reason, 'business_slug_missing', `slug ${slug}`)
assert.equal(link({ publicBookingEnabled: false }).reason, 'public_booking_disabled')
assert.equal(link({ publicBookingEnabled: undefined }).reason, 'public_booking_disabled')

const url = link().url
const offerChat = buildChannelOfferReply({ businessName: 'Barbería QA', url, chatBookingEnabled: true })
assert.equal(offerChat, `¡Hola! Gracias por escribir a Barbería QA. Podés reservar online acá: ${url}. Si preferís, también podemos coordinar tu turno por este chat. ¿Cómo te queda más cómodo?`)
const offerWebOnly = buildChannelOfferReply({ businessName: 'Barbería QA', url, chatBookingEnabled: false })
assert.doesNotMatch(offerWebOnly, /coordinar tu turno/, 'sin reserva por chat habilitada no se promete')
assert.match(offerWebOnly, /reservar online acá/)
for (const reply of [offerChat, offerWebOnly, buildWebChoiceReply(), buildLinkResendReply({ url, linkAvailable: true }), buildLinkResendReply({ linkAvailable: false, chatBookingEnabled: true })]) {
  assert.equal(normalizeCustomerReply(reply), reply, 'el filtro de respuestas no altera el texto')
  for (const intent of ['general_query', 'booking_intent']) assert.equal(isSafePersistedReply({ intent, reply, metadata: { mutation_allowed: false, outbound_allowed: false, mutation_blocked: true, outbound_send: false } }), true, `outbound acepta: ${reply}`)
}
assert.doesNotMatch(buildLinkResendReply({ linkAvailable: false }), /https?:/, 'sin enlace no se inventa uno')
assert.doesNotMatch(buildWebChoiceReply(), /https?:/, 'elegir la web no repite el enlace')

for (const [text, expected] of [
  ['Prefiero por acá', 'chat'], ['por aca', 'chat'], ['Por este chat', 'chat'], ['mejor por whatsapp', 'chat'], ['acá', 'chat'], ['sigamos por aca', 'chat'],
  ['por la web', 'web'], ['Prefiero la web', 'web'], ['online', 'web'], ['el link', 'web'], ['desde el enlace', 'web'],
  ['pasame el link', 'link_request'], ['¿Me mandás el enlace de nuevo?', 'link_request'], ['cual es la pagina', 'link_request'],
  ['por la web o por acá', null], ['hola', null], ['quiero un corte mañana', null], ['', null],
]) assert.equal(classifyChannelChoice(text), expected, `elección: ${text}`)

const now = new Date('2026-10-04T15:00:00.000Z')
const offeredState = { channel_offer_at: now.toISOString(), channel_choice: null }
assert.deepEqual(shouldOfferChannels({ state: null, intent: 'general_query', extractedFields: {}, linkAvailable: true, now }), { offer: true, reason: null })
assert.equal(shouldOfferChannels({ state: null, intent: 'booking_intent', extractedFields: { pending_intent: 'booking_intent', last_intent: 'booking_intent' }, linkAvailable: true, now }).offer, true, 'intención de reservar sin datos concretos')
assert.equal(shouldOfferChannels({ state: null, intent: 'booking_intent', extractedFields: { service_id: 5 }, linkAvailable: true, now }).reason, 'concrete_booking_request', 'pedido concreto sigue sin menú')
assert.equal(shouldOfferChannels({ state: null, intent: 'price_query', extractedFields: {}, linkAvailable: true, now }).reason, 'intent_answered_directly')
assert.equal(shouldOfferChannels({ state: null, intent: 'general_query', extractedFields: {}, linkAvailable: false, now }).reason, 'link_unavailable')
assert.equal(shouldOfferChannels({ state: offeredState, intent: 'general_query', extractedFields: {}, linkAvailable: true, now: new Date(now.getTime() + 60_000) }).reason, 'offer_recently_sent', 'no se repite')
assert.equal(shouldOfferChannels({ state: offeredState, intent: 'general_query', extractedFields: {}, linkAvailable: true, now: new Date(now.getTime() + CHANNEL_OFFER_COOLDOWN_MS + 1) }).offer, true, 'después del período vuelve a ofrecerse')
assert.equal(shouldOfferChannels({ state: { confirmation_state: 'awaiting_confirmation' }, intent: 'general_query', extractedFields: {}, linkAvailable: true, now }).reason, 'confirmation_in_progress')
assert.equal(isChannelChoicePending(offeredState, now), true)
assert.equal(isChannelChoicePending({ ...offeredState, channel_choice: 'chat' }, now), false)
assert.equal(isChannelChoicePending(null, now), false)

assert.equal(canonicalArgentineMobile('5491155550001@s.whatsapp.net'), '5491155550001')
assert.equal(canonicalArgentineMobile('541155550001@s.whatsapp.net'), '5491155550001', 'JID sin 9')
assert.equal(canonicalArgentineMobile('+54 9 351 555-0002'), '5493515550002')
assert.equal(canonicalArgentineMobile('123456789@lid'), null, 'LID no es teléfono')
assert.equal(canonicalArgentineMobile('120363@g.us'), null)
assert.equal(canonicalArgentineMobile('1155550001'), null, 'sin código de país no se adivina')
assert.equal(canonicalArgentineMobile('5411555500'), null)

for (const [text, expected] of [
  ['Ana Pérez', 'Ana Pérez'], ['Soy Ana', 'Ana'], ['me llamo José María.', 'José María'], ['A nombre de Lu', 'Lu'], ["O'Connor", "O'Connor"],
  ['sí', null], ['dale', null], ['mañana a las 10', null], ['quiero un turno', null], ['1234', null], ['a', null], ['ana@example.com', null],
  ['uno dos tres cuatro cinco seis', null], ['por acá', null], ['https://x.y', null],
]) assert.equal(extractCustomerName(text), expected, `nombre: ${text}`)

assert.deepEqual(resolveBookingCustomer({ existing: { nombre: 'Ana Web', email: 'ana@example.com' }, conversationName: 'Otro' }), { status: 'existing', nombre: 'Ana Web', email: 'ana@example.com' }, 'el chat no reemplaza la ficha')
assert.deepEqual(resolveBookingCustomer({ existing: null, conversationName: 'Beto' }), { status: 'new', nombre: 'Beto', email: null })
assert.equal(resolveBookingCustomer({ existing: null, conversationName: null }).status, 'name_required', 'sin nombre de relleno')
assert.equal(resolveBookingCustomer({ existing: null, conversationName: 'E2E_QA_A_CLIENTE' }).status, 'name_required', 'un nombre de fixture no es válido')
assert.equal(resolveBookingCustomer({ existing: { nombre: '' }, conversationName: 'Carla' }).nombre, 'Carla', 'completa nombre vacío')

// Pausa: misma semántica que el gate productivo de n8n.
const n8nEvaluate = vm.runInNewContext(`${MANUAL_PAUSE_EVALUATOR}; evaluateManualPause`)
for (const rows of [[], [{ barberia_id: 1, clave: 'bot_activo', valor: 'true' }], [{ barberia_id: 1, clave: 'bot_activo', valor: 'false' }], [{ barberia_id: 1, clave: 'bot_activo', valor: 'x' }]]) {
  assert.deepEqual(evaluateBotPause(rows, 1), { ...n8nEvaluate(rows, 1) }, `pausa ${JSON.stringify(rows)}`)
}
assert.throws(() => evaluateBotPause([{ barberia_id: 2, clave: 'bot_activo', valor: 'true' }], 1), /manual_pause_lookup_invalid/)
assert.throws(() => evaluateBotPause([{ barberia_id: 1, clave: 'bot_activo', valor: 'true' }, { barberia_id: 1, clave: 'bot_activo', valor: 'true' }], 1), /ambiguous/)

assert.match(buildBookingConfirmedReply({ businessName: 'Barbería QA', serviceName: 'Corte clásico', fecha: '2099-01-05', hora: '16:00:00' }), /^¡Listo! Tu turno de Corte clásico quedó reservado para el lunes, 5 de enero a las 16:00 en Barbería QA\.$/)
assert.equal(buildBookingConfirmedReply({ fecha: null, hora: '16:00' }), null, 'sin fila guardada no hay confirmación')

// Runtime: nombre sólo para cliente nuevo; elegir web corta la reserva por chat.
const scope = { tenantId: 1, integrationId: 11, instance: 'austral-qa-tenant-1', senderHash: 'sha256:0123456789ab', environment: 'qa' }
const services = [{ id: 5, nombre: 'Corte clásico', activo: true }]
const tz = 'America/Argentina/Buenos_Aires'
const t1 = advanceConversationTurn({ scope, eventId: 'e1', text: 'Quiero corte clásico mañana a las 16', services, timezone: tz, customerNameRequired: true, now })
assert.equal(t1.action.action, 'ask_name')
assert.equal(t1.state.awaiting_customer_name, true)
const t2 = advanceConversationTurn({ state: t1.state, scope, eventId: 'e2', text: 'Soy Ana', services, timezone: tz, customerNameRequired: true, now })
assert.equal(t2.state.customer_name, 'Ana')
assert.equal(t2.action.action, 'check_availability')
const t2b = advanceConversationTurn({ state: t1.state, scope, eventId: 'e2b', text: 'mejor pasado mañana', services, timezone: tz, customerNameRequired: true, now })
assert.equal(t2b.state.customer_name, null, 'un cambio de fecha no se toma como nombre')
assert.equal(t2b.action.action, 'ask_name')
const known = advanceConversationTurn({ scope, eventId: 'k1', text: 'Quiero corte clásico mañana a las 16', services, timezone: tz, customerNameRequired: false, now })
assert.equal(known.action.action, 'check_availability', 'cliente existente: no se pide el nombre')
const forced = advanceConversationTurn({ scope, eventId: 'f1', text: 'por acá', services, timezone: tz, forceBookingIntent: true, now })
assert.equal(forced.state.pending_intent, 'booking_intent')
assert.equal(forced.action.action, 'ask_service')
const web = applyWebChannelTurn({ state: t2.state, scope, eventId: 'w1', text: 'pasame el link', timezone: tz, linkResent: true, now })
assert.equal(web.accepted, true)
assert.equal(web.state.pending_intent, null)
assert.equal(web.state.service_id, null)
assert.equal(web.state.channel_choice, 'web')
assert.equal(web.state.ready_for_booking_mutation, false)
const expired = advanceConversationTurn({ state: { ...t2.state, channel_offer_at: now.toISOString() }, scope, eventId: 'late', text: 'hola', services, timezone: tz, now: new Date(now.getTime() + 31 * 60 * 1000) })
assert.equal(expired.accepted, true, 'un saludo después del vencimiento inicia otra conversación')
assert.equal(expired.state.channel_offer_at, now.toISOString(), 'conserva la memoria del saludo')
assert.equal(expired.state.service_id, null)

// Fuentes: sin nombre de fixture, migración sin sobrescritura y sin envíos desde el webhook.
const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
const mutationSource = read('supabase/functions/whatsapp-booking-mutation/index.ts')
const webhookSource = read('supabase/functions/whatsapp-evolution-webhook/index.ts')
const migration = read('supabase/migrations/20261004120000_whatsapp_cliente_unico.sql')
assert.doesNotMatch(mutationSource, /E2E_QA_A_CLIENTE|FALLBACK_NAME/)
assert.match(mutationSource, /customer_name_required/)
assert.match(mutationSource, /bot_paused/)
assert.match(webhookSource, /bot_paused/)
assert.match(webhookSource, /WHATSAPP_PUBLIC_BOOKING_ORIGIN|PUBLIC_BOOKING_ORIGIN_ENV/)
assert.doesNotMatch(webhookSource, /sendText|crear_reserva_whatsapp/)
assert.match(migration, /set nombre = case when nullif\(btrim\(public\.clientes\.nombre\), ''\) is null then excluded\.nombre else public\.clientes\.nombre end/)
assert.match(migration, /email = coalesce\(public\.clientes\.email, excluded\.email\)/)
assert.match(migration, /grant execute on function public\.crear_reserva_whatsapp\(bigint, text, bigint, bigint, date, time, text, text, text\) to service_role/)
assert.doesNotMatch(migration, /\b(drop|delete|truncate)\b/i, 'migración aditiva: sin borrar objetos ni datos')

// ---------------------------------------------------------------- Parte B
const CLIENT_JID = '5491155550001@s.whatsapp.net'
const BASE_ENV = {
  SUPABASE_URL: 'https://cmsymmszlzikqpvfqjre.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'harness-only',
  WHATSAPP_PROVISIONING_ENV: 'qa',
  WHATSAPP_MODE: 'shadow',
  PILOT_MODE: 'shadow',
  WHATSAPP_PROVISIONING_ADAPTER: 'evolution',
  EVOLUTION_WEBHOOK_SECRET: 'harness-secret',
  WHATSAPP_OUTBOUND_QA_RECIPIENT: '5491155550001',
  WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH: senderHashFor(CLIENT_JID),
  WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED: '1',
  WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED: '1',
  WHATSAPP_AGENT_OUTBOUND_ALLOWED_TENANT_IDS: '1,2',
  EVOLUTION_BASE_URL: 'https://evolution.invalid',
  EVOLUTION_API_KEY: 'harness-only',
  WHATSAPP_PUBLIC_BOOKING_ORIGIN: QA_ORIGIN,
  WHATSAPP_PUBLIC_BOOKING_ENVIRONMENT: 'qa',
}
function setEnv(overrides = {}) {
  harnessEnv.clear()
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) if (value !== undefined) harnessEnv.set(key, value)
}

const fixture = () => ({
  saas_whatsapp_connections: [
    { id: 1, barberia_id: 1, integration_id: 11, provider: 'evolution', environment: 'qa', state: 'CONNECTED', instance_name: 'austral-qa-tenant-1' },
    { id: 2, barberia_id: 2, integration_id: 22, provider: 'evolution', environment: 'qa', state: 'CONNECTED', instance_name: 'austral-qa-tenant-2' },
  ],
  saas_integraciones: [
    { id: 11, barberia_id: 1, proveedor: 'evolution', integration_type: 'whatsapp', estado: 'conectado' },
    { id: 22, barberia_id: 2, proveedor: 'evolution', integration_type: 'whatsapp', estado: 'conectado' },
  ],
  barberias: [
    { id: 1, nombre: 'Barbería QA', slug: 'austral-qa-tenant-1', moneda: 'ARS', zona_horaria: tz, reservas_publicas: true },
    { id: 2, nombre: 'Otro Negocio QA', slug: 'austral-qa-tenant-2', moneda: 'ARS', zona_horaria: tz, reservas_publicas: true },
  ],
  servicios: [
    { id: 5, barberia_id: 1, nombre: 'Corte clásico', descripcion: null, precio: 30000, duracion_min: 30, activo: true },
    { id: 6, barberia_id: 2, nombre: 'Corte clásico', descripcion: null, precio: 30000, duracion_min: 30, activo: true },
  ],
  barberos: [{ id: 7, barberia_id: 1, nombre: 'Lucas', activo: true }, { id: 8, barberia_id: 2, nombre: 'Sol', activo: true }],
  horarios_barbero: [],
  bloqueos_agenda: [],
})

// RPC simuladas: disponibilidad fija y la regla de ficha única de la migración.
const rpc = {
  horarios_disponibles_reserva_publica: (args, db) => {
    const business = db.tables.barberias.find((row) => row.slug === args.p_slug)
    const barber = db.tables.barberos.find((row) => row.barberia_id === business?.id)
    return ['10:00:00', '16:00:00'].map((hora) => ({ barbero_id: barber.id, barbero_nombre: barber.nombre, hora, duracion_min: 30 }))
      .filter((slot) => !db.tables.turnos.some((turno) => turno.barbero_id === slot.barbero_id && turno.fecha === args.p_fecha && `${turno.hora}:00` === slot.hora))
  },
  crear_reserva_whatsapp: (args, db) => {
    const integration = db.tables.saas_integraciones.find((row) => row.id === args.p_integration_id)
    const event = db.tables.saas_automation_events.find((row) => row.integration_id === args.p_integration_id && row.event_id === args.p_event_id)
    if (event?.status === 'completed') return [db.tables.turnos.find((row) => String(row.id) === event.result_reference)].map((row) => ({ turno_id: row.id, fecha: row.fecha, hora: `${row.hora}:00`, duracion_min: 30 }))
    const telefono = canonicalArgentineMobile(args.p_telefono)
    if (!telefono) throw Object.assign(new Error('phone'), { code: '22023' })
    let cliente = db.tables.clientes.find((row) => row.barberia_id === integration.barberia_id && row.telefono === telefono)
    if (!cliente) db.tables.clientes.push(cliente = { id: db.tables.clientes.length + 100, barberia_id: integration.barberia_id, nombre: args.p_nombre, telefono, email: args.p_email })
    const turno = { id: db.tables.turnos.length + 500, barberia_id: integration.barberia_id, cliente_id: cliente.id, barbero_id: args.p_barbero_id, servicio_id: args.p_servicio_id, paciente: args.p_nombre, telefono, fecha: args.p_fecha, hora: args.p_hora, origen: 'whatsapp' }
    db.tables.turnos.push(turno)
    db.tables.saas_automation_events.push({ integration_id: args.p_integration_id, event_id: args.p_event_id, status: 'completed', result_reference: String(turno.id) })
    return [{ turno_id: turno.id, fecha: turno.fecha, hora: `${turno.hora}:00`, duracion_min: 30 }]
  },
}

setEnv()
const webhook = await loadEdgeFunction('whatsapp-evolution-webhook')
const mutation = await loadEdgeFunction('whatsapp-booking-mutation')
const outbound = await loadEdgeFunction('whatsapp-agent-outbound-pilot')
let eventCounter = 0
async function send(text, { id = `EVT${eventCounter += 1}`, instance = 'austral-qa-tenant-1', key = {} } = {}) {
  const result = await webhook({ event: 'messages.upsert', instance, data: { key: { id, remoteJid: CLIENT_JID, fromMe: false, ...key }, message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) } }, { 'X-Austral-Webhook-Secret': 'harness-secret' })
  return { ...result, id }
}
const book = (eventId) => mutation({ event_id: eventId }, { authorization: 'Bearer operador' })

// B1. Cliente nuevo: saludo con las dos opciones, elige chat y reserva.
let db = createMemoryDb(fixture(), { rpc })
let r = await send('Hola')
assert.equal(r.status, 200)
assert.equal(r.body.proposed_reply, `¡Hola! Gracias por escribir a Barbería QA. Podés reservar online acá: ${QA_ORIGIN}/reservar/austral-qa-tenant-1. Si preferís, también podemos coordinar tu turno por este chat. ¿Cómo te queda más cómodo?`)
const replay = await send('Hola', { id: r.id })
assert.equal(replay.body.duplicate, true, 'webhook duplicado no genera otra respuesta')
assert.equal(db.tables.saas_automation_shadow_runs.length, 1)
r = await send('Hola, ¿siguen ahí?')
assert.doesNotMatch(r.body.proposed_reply, /https?:/, 'el enlace no se repite en cada mensaje')
r = await send('Prefiero por acá')
assert.equal(r.body.proposed_reply, 'Dale, seguimos por acá. ¿Qué servicio querés reservar?')
r = await send('Corte clásico')
assert.match(r.body.proposed_reply, /¿Qué día/)
r = await send('mañana a las 16')
assert.equal(r.body.proposed_reply, '¿A nombre de quién dejo el turno?', 'cliente nuevo: se pide el nombre, no el teléfono')
r = await send('Soy Ana Pérez')
assert.match(r.body.proposed_reply, /^Tengo disponible Corte clásico el .+ a las 16:00 a nombre de Ana Pérez\. ¿Confirmás\?$/)
assert.equal(db.tables.turnos.length + db.tables.clientes.length, 0, 'nada se guarda antes de confirmar')
r = await send('Sí')
assert.equal(r.body.ready_for_booking_mutation, true)
assert.doesNotMatch(r.body.proposed_reply, /reservad|confirmad|quedó/i, 'no se confirma antes de guardar')
assert.equal(db.tables.turnos.length, 0)
let booked = await book(r.id)
assert.equal(booked.status, 200, JSON.stringify(booked.body))
assert.equal(booked.body.booking_created, true)
assert.equal(booked.body.customer_status, 'new')
assert.match(booked.body.confirmation_reply, /^¡Listo! Tu turno de Corte clásico quedó reservado para el .+ a las 16:00 en Barbería QA\.$/)
assert.deepEqual(db.tables.clientes.map(({ barberia_id, nombre, telefono }) => ({ barberia_id, nombre, telefono })), [{ barberia_id: 1, nombre: 'Ana Pérez', telefono: '5491155550001' }])
const again = await book(r.id)
assert.equal(again.body.idempotent, true, 'doble confirmación: el mismo turno')
assert.equal(db.tables.turnos.length, 1)
assert.ok(!db.calls.some((call) => call.args && JSON.stringify(call.args).includes('E2E_QA_A_CLIENTE')), 'sin nombre de fixture')

// B2. Cliente que ya reservó por la web: elige web, pide el enlace y después reserva por chat.
db = createMemoryDb({ ...fixture(), clientes: [{ id: 41, barberia_id: 1, nombre: 'Ana Web', telefono: '5491155550001', email: 'ana@example.com' }] }, { rpc })
r = await send('Buenas')
assert.match(r.body.proposed_reply, /reservar online acá/)
r = await send('por la web')
assert.equal(r.body.proposed_reply, buildWebChoiceReply())
r = await send('pasame el link de nuevo')
assert.equal(r.body.proposed_reply, `Acá tenés el enlace para reservar online: ${QA_ORIGIN}/reservar/austral-qa-tenant-1.`)
assert.equal(db.tables.turnos.length, 0, 'pedir el enlace no agenda nada')
r = await send('Quiero un turno de corte clásico mañana a las 16')
assert.match(r.body.proposed_reply, /^Tengo disponible Corte clásico el .+ a las 16:00\. ¿Confirmás\?$/, 'cliente existente: sin pedir nombre ni revelar la ficha')
r = await send('dale')
booked = await book(r.id)
assert.equal(booked.body.customer_status, 'existing')
assert.equal(db.tables.clientes.length, 1, 'misma ficha que la web')
assert.equal(db.tables.clientes[0].nombre, 'Ana Web', 'la ficha no se sobrescribe')
assert.equal(db.tables.turnos[0].cliente_id, 41)
const createCall = db.calls.find((call) => call.rpc === 'crear_reserva_whatsapp')
assert.equal(createCall.args.p_nombre, 'Ana Web')
assert.equal(createCall.args.p_telefono, '5491155550001')

// B3. Pedido concreto de entrada: se atiende sin forzar el menú.
db = createMemoryDb(fixture(), { rpc })
r = await send('Quiero un turno de corte clásico mañana a las 16')
assert.equal(r.body.proposed_reply, '¿A nombre de quién dejo el turno?')
assert.doesNotMatch(JSON.stringify(db.tables.saas_automation_shadow_runs), /reservar\/austral/)

// B4. Reserva por chat en curso y el cliente pide el enlace: la propuesta se descarta.
db = createMemoryDb({ ...fixture(), clientes: [{ id: 41, barberia_id: 1, nombre: 'Ana Web', telefono: '5491155550001' }] }, { rpc })
await send('Quiero un turno de corte clásico mañana a las 16')
r = await send('pasame el link')
assert.match(r.body.proposed_reply, /reservar\/austral-qa-tenant-1/)
r = await send('Sí')
assert.notEqual(r.body.ready_for_booking_mutation, true)
booked = await book(r.id)
assert.equal(booked.status, 409, 'no hay reserva paralela por chat')
assert.equal(db.tables.turnos.length, 0)

// B5. Cliente nuevo sin nombre en la conversación: no se agenda con un nombre de relleno.
db = createMemoryDb(fixture(), { rpc })
await send('Quiero corte clásico mañana a las 16')
await send('Soy Ana')
r = await send('Sí')
const run = db.tables.saas_automation_shadow_runs.find((row) => row.event_id === r.id)
run.metadata.conversation_state.customer_name = null
booked = await book(r.id)
assert.equal(booked.body.error, 'customer_name_required')
assert.equal(db.tables.turnos.length, 0)

// B6. Pausa por atención humana: sin saludo, sin reserva y sin envío.
db = createMemoryDb({ ...fixture(), config: [{ barberia_id: 1, clave: 'bot_activo', valor: 'false' }] }, { rpc })
r = await send('Hola')
assert.equal(r.status, 202)
assert.equal(r.body.reason, 'bot_paused')
assert.equal(db.tables.saas_automation_shadow_runs.length, 0)
db.tables.config = []
await send('Quiero corte clásico mañana a las 16')
await send('Ana')
r = await send('Sí')
const outboundRun = db.tables.saas_automation_shadow_runs.at(-1)
db.tables.config = [{ barberia_id: 1, clave: 'bot_activo', valor: 'false' }]
assert.equal((await book(r.id)).body.error, 'bot_paused')
assert.equal((await outbound({ event_id: outboundRun.event_id }, { authorization: 'Bearer operador' })).body.error, 'bot_paused')
db.failTables.add('config')
assert.equal((await send('Hola')).status, 503, 'error al leer la pausa: no responde')
assert.equal(db.tables.turnos.length, 0)

// B7. Enlace no disponible: no se inventa (origen ausente, web deshabilitada, slug ausente).
for (const [label, setup] of [
  ['origen ausente', () => setEnv({ WHATSAPP_PUBLIC_BOOKING_ORIGIN: undefined })],
  ['origen de producción', () => setEnv({ WHATSAPP_PUBLIC_BOOKING_ORIGIN: 'https://barberia-177.pages.dev' })],
  ['entorno declarado distinto', () => setEnv({ WHATSAPP_PUBLIC_BOOKING_ENVIRONMENT: 'production' })],
  ['reserva web deshabilitada', () => { setEnv(); db.tables.barberias[0].reservas_publicas = false }],
  ['slug ausente', () => { setEnv(); db.tables.barberias[0].slug = null }],
]) {
  db = createMemoryDb(fixture(), { rpc })
  setup()
  r = await send('Hola')
  assert.equal(r.status, 200, label)
  assert.doesNotMatch(r.body.proposed_reply, /https?:|reservar online/, `sin enlace: ${label}`)
  r = await send('pasame el link')
  assert.doesNotMatch(r.body.proposed_reply, /https?:/, `sin enlace a pedido: ${label}`)
}
// Sin enlace, pedirlo no descarta la reserva por chat en curso.
setEnv({ WHATSAPP_PUBLIC_BOOKING_ORIGIN: undefined })
db = createMemoryDb({ ...fixture(), clientes: [{ id: 41, barberia_id: 1, nombre: 'Ana Web', telefono: '5491155550001' }] }, { rpc })
await send('Quiero un turno de corte clásico mañana a las 16')
r = await send('pasame el link')
assert.match(r.body.proposed_reply, /^Por ahora no tengo un enlace de reserva online para compartirte\. Si querés, coordinamos tu turno por acá\.$/)
assert.equal(db.tables.saas_automation_shadow_runs.at(-1).metadata.conversation_state.service_id, 5, 'conserva los datos de la reserva por chat')
setEnv()

// B8. Otro negocio: su propio enlace y sin prometer reserva por chat (sólo el tenant QA 1 agenda).
db = createMemoryDb(fixture(), { rpc })
r = await send('Hola', { instance: 'austral-qa-tenant-2' })
assert.match(r.body.proposed_reply, /Gracias por escribir a Otro Negocio QA\. Podés reservar online acá: https:\/\/reservas-qa\.example\.com\/reservar\/austral-qa-tenant-2\./)
assert.doesNotMatch(r.body.proposed_reply, /coordinar tu turno/)
r = await send('Hola', { instance: 'austral-qa-tenant-1' })
assert.match(r.body.proposed_reply, /reservar\/austral-qa-tenant-1\./, 'cada negocio tiene su conversación y su enlace')
setEnv({ WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED: '0' })
db = createMemoryDb(fixture(), { rpc })
r = await send('Hola')
assert.doesNotMatch(r.body.proposed_reply, /coordinar tu turno/, 'con el piloto de reservas apagado no se promete el chat')
setEnv()

// B9. Identidad LID: sólo con la alternativa verificada del proveedor.
db = createMemoryDb(fixture(), { rpc })
await send('Hola', { key: { remoteJid: '99887766@lid', remoteJidAlt: CLIENT_JID } })
assert.equal(db.tables.saas_automation_shadow_runs.at(-1).metadata.sender_hash, senderHashFor(CLIENT_JID))
db = createMemoryDb({ ...fixture(), clientes: [{ id: 41, barberia_id: 1, nombre: 'Ana Web', telefono: '5491155550001' }] }, { rpc })
await send('Quiero corte clásico mañana a las 16', { key: { remoteJid: '99887766@lid' } })
const lidRun = db.tables.saas_automation_shadow_runs.at(-1)
assert.equal(lidRun.metadata.sender_hash, senderHashFor('99887766@lid'), 'sin alternativa se conserva el LID')
assert.equal(lidRun.metadata.proposed_reply, '¿A nombre de quién dejo el turno?', 'sin teléfono verificado no se asume la ficha')

console.log(JSON.stringify({
  task: 35,
  pure_modules: 'PASS',
  edge_handlers_simulated: ['new_customer_chat', 'existing_web_customer', 'concrete_request', 'web_choice_cancels_chat', 'name_required', 'manual_pause', 'link_unavailable', 'other_tenant', 'lid_identity'],
  real_whatsapp_or_supabase: false,
  result: 'PASS',
}))
