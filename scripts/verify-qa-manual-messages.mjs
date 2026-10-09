// Cableado real de handlers, Supabase/HTTP simulados. Ninguna llamada de red.
import assert from 'node:assert/strict'
import { createMemoryDb, harnessEnv, loadEdgeFunction } from './lib/edgeFunctionHarness.mjs'
import { qaManualMessageRpc } from './lib/qaManualMessageHarness.mjs'
import { QA_MANUAL_ROUTE } from '../supabase/functions/_shared/qaManualRuntime.mjs'

const phone = '5491155550107'
const env = {
  SUPABASE_URL: 'https://cmsymmszlzikqpvfqjre.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'harness-only',
  WHATSAPP_PROVISIONING_ENV: 'qa', WHATSAPP_MODE: 'shadow', PILOT_MODE: 'shadow', WHATSAPP_PROVISIONING_ADAPTER: 'evolution',
  WHATSAPP_QA_MANUAL_TENANT_IDS: '928', WHATSAPP_QA_MANUAL_RECIPIENTS: `${phone},5491155552851`,
  EVOLUTION_WEBHOOK_SECRET: 'harness-secret', EVOLUTION_BASE_URL: 'https://evolution.cuchitron.lat', EVOLUTION_API_KEY: 'harness-only',
}
harnessEnv.clear()
for (const [key, value] of Object.entries(env)) harnessEnv.set(key, value)
const fixture = () => ({
  saas_whatsapp_connections: [{ id: 6, barberia_id: 928, integration_id: 48, provider: 'evolution', environment: 'qa', state: 'CONNECTED', instance_name: 'austral-qa-tenant-928', automation_enabled: true, outbound_enabled: true, booking_enabled: true }],
  saas_integraciones: [{ id: 48, barberia_id: 928, proveedor: 'evolution', integration_type: 'whatsapp', estado: 'conectado' }],
  barberias: [{ id: 928, nombre: 'Negocio QA', slug: 'austral-prueba-lautaro', moneda: 'ARS', zona_horaria: 'America/Argentina/Buenos_Aires', reservas_publicas: true }],
  servicios: [{ id: 70, barberia_id: 928, nombre: 'Corte', precio: 15000, duracion_min: 30, activo: true }],
  barberos: [{ id: 9, barberia_id: 928, nombre: 'Profesional QA', activo: true }], horarios_barbero: [], bloqueos_agenda: [],
})
const rpc = { ...qaManualMessageRpc, horarios_disponibles_reserva_publica: () => [{ barbero_id: 9, barbero_nombre: 'Profesional QA', hora: '16:00:00', duracion_min: 30 }] }
const realFetch = globalThis.fetch
const sends = []
const forwards = []
let providerHasId = true
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === QA_MANUAL_ROUTE) { forwards.push(JSON.parse(init.body)); return new Response('{}', { status: 200 }) }
  if (String(url).startsWith('https://evolution.cuchitron.lat/message/sendText/')) {
    sends.push(JSON.parse(init.body))
    return new Response(JSON.stringify(providerHasId ? { key: { id: `PROVIDER${sends.length}` }, status: 'PENDING' } : {}), { status: 201 })
  }
  throw new Error('unexpected_network_request')
}
const webhook = await loadEdgeFunction('whatsapp-evolution-webhook')
const outbound = await loadEdgeFunction('whatsapp-agent-outbound-pilot')
const mutation = await loadEdgeFunction('whatsapp-booking-mutation')
let counter = 0
const event = (text, id, sender = phone, instance = 'austral-qa-tenant-928') => ({ event: 'messages.upsert', instance, data: { key: { id, remoteJid: `${sender}@s.whatsapp.net`, fromMe: false }, message: { conversation: text }, messageType: 'conversation', messageTimestamp: Math.floor(Date.now() / 1000) } })
const send = async (text, { id = `IN${++counter}`, sender, instance } = {}) => ({ id, ...await webhook(event(text, id, sender, instance), { 'X-Austral-Webhook-Secret': 'harness-secret' }) })
const reply = id => outbound({ event_id: id }, { authorization: 'Bearer harness-only' })

try {
  // Contacto nuevo visible, pero no se usa el rótulo como nombre de reserva.
  let db = createMemoryDb(fixture(), { rpc })
  let incoming = await send('Quiero corte mañana a las 16')
  assert.equal(incoming.body.proposed_reply, '¿A nombre de quién dejo el turno?')
  assert.equal(db.tables.clientes.length, 1)
  assert.equal(db.tables.clientes[0].whatsapp_nombre_pendiente, true)
  assert.match(db.tables.clientes[0].nombre, /^Contacto WhatsApp/)
  assert.equal(db.tables.mensajes.length, 1)
  assert.equal(db.tables.mensajes[0].de, 'paciente')
  assert.equal(db.tables.mensajes[0].enviado_wsp, false)
  assert.equal(db.tables.mensajes[0].leido, false)
  const replay = await send('Quiero corte mañana a las 16', { id: incoming.id })
  assert.equal(replay.body.duplicate, true)
  assert.equal(db.tables.mensajes.length, 1)
  const askName = await reply(incoming.id)
  assert.equal(askName.body.panel_message_persisted, true)
  assert.equal(db.tables.mensajes[1].de, 'bot')
  assert.equal(db.tables.mensajes[1].estado_envio, 'aceptado')
  assert.notEqual(db.tables.mensajes[1].estado_envio, 'entregado')
  const known = await send('Soy Ana Pérez')
  assert.equal(db.tables.clientes.length, 1)
  assert.equal(db.tables.clientes[0].nombre, 'Ana Pérez')
  assert.equal(db.tables.clientes[0].whatsapp_nombre_pendiente, false)
  assert.match(known.body.proposed_reply, /¿Confirmás\?/)

  // Persistir mientras el bot está pausado conserva el chat sin responder.
  db = createMemoryDb({ ...fixture(), config: [{ barberia_id: 928, clave: 'bot_activo', valor: 'false' }] }, { rpc })
  const beforePaused = sends.length
  incoming = await send('Hola')
  assert.equal(incoming.body.reason, 'bot_paused')
  assert.equal(db.tables.mensajes.length, 1)
  assert.equal(db.tables.saas_automation_shadow_runs.length, 0)
  assert.equal(sends.length, beforePaused)

  // Fallo después de aceptación: recibo duradero y reparación sin reenvío,
  // incluso si el operador pausó el bot antes de la reparación.
  db = createMemoryDb({ ...fixture(), clientes: [{ id: 41, barberia_id: 928, nombre: 'Cliente existente', telefono: phone }] }, { rpc })
  incoming = await send('¿Cuánto sale el corte?')
  db.failPanelPersistence = 1
  const before = sends.length
  const failedPersistence = await reply(incoming.id)
  assert.equal(failedPersistence.status, 502)
  assert.equal(failedPersistence.body.sent, true)
  assert.equal(failedPersistence.body.panel_message_persisted, false)
  assert.equal(sends.length, before + 1)
  assert.equal(db.tables.mensajes.length, 1)
  assert.match(db.tables.saas_automation_events[0].result_reference, /^qa928-accepted:/)
  const acceptedTables = structuredClone(db.tables)
  // El recibo durable repara la bandeja aun cuando el canal ya no puede
  // enviar: estos casos deben FALLAR con los gates anteriores a la reparación.
  const repairCases = [
    ['evento viejo', tables => { tables.saas_automation_shadow_runs[0].observed_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString() }],
    ['conexión desconectada', tables => { tables.saas_whatsapp_connections[0].state = 'DISCONNECTED'; tables.saas_integraciones[0].estado = 'desactivado' }],
    ['capacidades apagadas', tables => { tables.saas_whatsapp_connections[0].automation_enabled = false; tables.saas_whatsapp_connections[0].outbound_enabled = false }],
    ['viejo, desconectado y apagado', tables => {
      tables.saas_automation_shadow_runs[0].observed_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
      tables.saas_whatsapp_connections[0].state = 'DISCONNECTED'
      tables.saas_whatsapp_connections[0].automation_enabled = false
      tables.saas_whatsapp_connections[0].outbound_enabled = false
      tables.saas_integraciones[0].estado = 'desactivado'
    }],
  ]
  for (const [label, change] of repairCases) {
    db = createMemoryDb(acceptedTables, { rpc })
    change(db.tables)
    const repaired = await reply(incoming.id)
    assert.equal(repaired.body.panel_message_persisted, true, `${label}: ${JSON.stringify(repaired.body)}`)
    assert.equal(db.tables.mensajes.length, 2, label)
    assert.equal(sends.length, before + 1, `${label}: cero nuevos envíos`)
    await reply(incoming.id)
    assert.equal(db.tables.mensajes.length, 2, `${label}: cero filas duplicadas`)
    assert.equal(sends.length, before + 1, `${label}: cero nuevos envíos al repetir`)
  }
  // Sin recibo aceptado los gates siguen bloqueando cualquier envío nuevo.
  for (const [label, change] of repairCases) {
    db = createMemoryDb(acceptedTables, { rpc })
    db.tables.saas_automation_events = []
    change(db.tables)
    const blocked = await reply(incoming.id)
    assert.ok(['fresh_source_event_required', 'qa_manual_flags_not_ready', 'qa_connection_not_connected'].includes(blocked.body.error), label)
    assert.equal(db.tables.mensajes.length, 1, `${label}: no se inventa una respuesta`)
    assert.equal(sends.length, before + 1, `${label}: sin recibo no amplía envío`)
  }
  db = createMemoryDb(acceptedTables, { rpc })
  db.tables.saas_automation_shadow_runs[0].metadata.conversation_state.tenant_id = 927
  const foreignReceipt = await reply(incoming.id)
  assert.equal(foreignReceipt.status, 403, 'un recibo no evita validar el negocio del estado')
  assert.equal(db.tables.mensajes.length, 1)
  assert.equal(sends.length, before + 1)
  db = createMemoryDb(acceptedTables, { rpc })
  db.tables.config = [{ barberia_id: 928, clave: 'bot_activo', valor: 'false' }]
  const recovered = await reply(incoming.id)
  assert.equal(recovered.body.duplicate, true)
  assert.equal(recovered.body.panel_message_persisted, true)
  assert.equal(db.tables.mensajes.length, 2)
  assert.equal(db.tables.mensajes[1].cliente_id, 41)
  assert.equal(db.tables.clientes[0].nombre, 'Cliente existente')
  assert.equal(sends.length, before + 1)
  await reply(incoming.id)
  assert.equal(db.tables.mensajes.length, 2)
  assert.equal(sends.length, before + 1)

  // No inventar aceptación con un 2xx sin identidad del proveedor.
  db = createMemoryDb(fixture(), { rpc })
  incoming = await send('Hola')
  providerHasId = false
  const missingId = await reply(incoming.id)
  assert.equal(missingId.body.send_outcome, 'uncertain')
  assert.equal(db.tables.mensajes.length, 1)
  const afterUncertain = sends.length
  await reply(incoming.id)
  assert.equal(sends.length, afterUncertain)
  providerHasId = true

  // Falla de persistencia entrante: no se genera propuesta ni se forwardea.
  db = createMemoryDb(fixture(), { rpc })
  db.failPanelPersistence = 1
  const routesBefore = forwards.length
  incoming = await send('Hola')
  assert.equal(incoming.status, 503)
  assert.equal(db.tables.clientes.length, 0)
  assert.equal(db.tables.saas_automation_shadow_runs.length, 0)
  assert.equal(forwards.length, routesBefore)
  const retried = await send('Hola', { id: incoming.id })
  assert.equal(retried.status, 200)
  assert.equal(db.tables.mensajes.length, 1)

  // Fallo al completar el nombre después de persistir el shadow: el mismo
  // evento se recupera sin duplicar ni recalcular la propuesta.
  db = createMemoryDb(fixture(), { rpc })
  db.failPanelPersistOnCall = 2
  incoming = await send('Hola')
  assert.equal(incoming.status, 503)
  assert.equal(db.tables.saas_automation_shadow_runs.length, 1)
  const afterShadowRetry = await send('Hola', { id: incoming.id })
  assert.equal(afterShadowRetry.body.duplicate, true)
  assert.equal(db.tables.saas_automation_shadow_runs.length, 1)
  assert.equal(db.tables.mensajes.length, 1)

  // Teléfono ajeno: ni fichas, ni mensajes, ni shadow runs.
  db = createMemoryDb(fixture(), { rpc })
  incoming = await send('Hola', { sender: '5491155559999' })
  assert.equal(incoming.body.reason, 'qa_recipient_not_allowed')
  assert.equal(db.tables.clientes.length, 0)
  assert.equal(db.tables.mensajes?.length || 0, 0)
  assert.equal(db.tables.saas_automation_shadow_runs.length, 0)

  // Otro tenant conserva el piloto anterior y no usa la nueva RPC de bandeja.
  const other = fixture()
  for (const row of other.saas_whatsapp_connections) { row.barberia_id = 927; row.instance_name = 'austral-qa-tenant-927' }
  for (const row of [...other.saas_integraciones, ...other.servicios, ...other.barberos]) row.barberia_id = 927
  other.barberias[0].id = 927
  db = createMemoryDb(other, { rpc })
  await send('Hola', { instance: 'austral-qa-tenant-927' })
  assert.ok(!db.calls.some(call => call.rpc === 'registrar_mensaje_whatsapp_qa928'))

  // La mutación tampoco acepta un nombre provisional con un estado adulterado
  // al que le faltó el nombre confirmado.
  db = createMemoryDb(fixture(), { rpc })
  await send('Quiero corte mañana a las 16')
  await send('Soy Ana')
  const confirmation = await send('Sí')
  const state = db.tables.saas_automation_shadow_runs.at(-1).metadata.conversation_state
  state.customer_name = null
  db.tables.clientes[0].whatsapp_nombre_pendiente = true
  db.tables.clientes[0].nombre = 'Contacto WhatsApp · …0107'
  const cannotBook = await mutation({ event_id: confirmation.id }, { authorization: 'Bearer harness-only' })
  assert.equal(cannotBook.body.error, 'customer_name_required')
  assert.equal(db.tables.turnos.length, 0)
  console.log('QA928 Mensajes: ficha única, nombre pendiente, pausa, reintentos, recuperación sin reenvío y aislamiento PASS (simulado)')
} finally { globalThis.fetch = realFetch }
