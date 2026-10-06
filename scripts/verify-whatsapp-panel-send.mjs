// Tarea 38: envío manual del panel y "Iniciar chat" desde la ficha del cliente.
// Ejercita el handler real de whatsapp-panel-send con una base en memoria y un
// webhook simulado. No usa red, Supabase ni WhatsApp. Cada acceso a la base
// cede el turno (setImmediate) para que las carreras sean reproducibles.
// Dos modos de reserva: sin migración (camino por tablas, atomic: false) y con
// la RPC (atomic: true, emulada en memoria sin ceder el turno). La atomicidad
// real de la RPC se prueba en PostgreSQL local:
// scripts/sql/whatsapp-panel-send/run.sh.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PANEL_SEND_CONTRACT,
  PANEL_SEND_PROPOSED_SETTINGS,
  classifyWebhookResponse,
  classifyWebhookStatus,
  handlePanelSend,
  integrationBlock,
  panelSendErrorBody,
  panelSendSettings,
  senderBlock,
} from '../supabase/functions/_shared/whatsappPanelSend.mjs'

const PANEL_SEND_RATE_LIMIT = PANEL_SEND_PROPOSED_SETTINGS.rateLimit
const FIXED = panelSendSettings({ WHATSAPP_PANEL_SEND_INSTANCE: 'miwsp' })
const ROUTED = panelSendSettings({ WHATSAPP_PANEL_SEND_ROUTING: 'instance' })

const TENANT = 7
const OTHER_TENANT = 9
const NOW = new Date('2026-10-05T15:00:00.000Z')
const tick = () => new Promise((resolve) => setImmediate(resolve))

function createDb(overrides = {}) {
  const db = {
    members: [
      { barberia_id: TENANT, user_id: 'owner-7', role: 'owner' },
      { barberia_id: TENANT, user_id: 'recep-7', role: 'recepcionista' },
      { barberia_id: TENANT, user_id: 'lector-7', role: 'readonly' },
      { barberia_id: OTHER_TENANT, user_id: 'owner-9', role: 'owner' },
    ],
    access: { [TENANT]: 'active', [OTHER_TENANT]: 'active' },
    // El negocio 7 es el dueño de la instancia del webhook; el 9 tiene la suya.
    integraciones: { [TENANT]: { estado: 'conectado', external_instance_id: 'MiWsp' }, [OTHER_TENANT]: { estado: 'conectado', external_instance_id: 'austral-qa-tenant-9' } },
    config: [],
    clientes: [
      { id: 100, barberia_id: TENANT, nombre: 'Ana Pérez', telefono: '5491122334455' },
      { id: 101, barberia_id: TENANT, nombre: 'Beto Sin Tel', telefono: '' },
      { id: 102, barberia_id: TENANT, nombre: 'Caro Fijo', telefono: '011 4444-5555' },
      { id: 103, barberia_id: TENANT, nombre: 'Dani Sin 9', telefono: '+54 11 2233-4455' },
      { id: 900, barberia_id: OTHER_TENANT, nombre: 'Ajeno', telefono: '5491199998888' },
    ],
    mensajes: [],
    nextId: 1,
    failures: {},
    // Plantilla actual de n8n: responde al recibir (sin result).
    outcome: 'received',
    atomic: false,
    ...overrides,
  }
  const maybeFail = (name) => { if (db.failures[name]) throw new Error(`${name} failed`) }
  const inWindow = (m, since) => m.created_at >= since
  const store = {
    async membership(tenantId, userId) { await tick(); maybeFail('membership'); return db.members.find((m) => m.barberia_id === tenantId && m.user_id === userId) || null },
    async accessState(tenantId) { await tick(); maybeFail('accessState'); return db.access[tenantId] ?? 'none' },
    async integration(tenantId) { await tick(); maybeFail('integration'); return db.integraciones[tenantId] || null },
    async botConfig(tenantId) { await tick(); maybeFail('botConfig'); return db.config.filter((row) => row.barberia_id === tenantId) },
    async cliente(tenantId, clienteId) { await tick(); maybeFail('cliente'); return db.clientes.find((c) => c.id === clienteId && c.barberia_id === tenantId) || null },
    async countRecentPanelSends(tenantId, since) { await tick(); maybeFail('count'); return db.mensajes.filter((m) => m.barberia_id === tenantId && m.de === 'clinica' && inWindow(m, since)).length },
    async countEarlierSameText({ tenantId, clienteId, texto, since, beforeId, states }) { await tick(); maybeFail('count'); return db.mensajes.filter((m) => m.barberia_id === tenantId && m.cliente_id === clienteId && m.de === 'clinica' && m.texto === texto && states.includes(m.estado_envio) && inWindow(m, since) && m.id < beforeId).length },
    async countPanelSendsThrough(tenantId, since, throughId) { await tick(); maybeFail('count'); return db.mensajes.filter((m) => m.barberia_id === tenantId && m.de === 'clinica' && inWindow(m, since) && m.id <= throughId).length },
    async insertMensaje(row) { await tick(); maybeFail('insert'); const saved = { id: db.nextId++, created_at: NOW.toISOString(), ...row }; db.mensajes.push(saved); return { ...saved } },
    async deleteMensaje(tenantId, id) { await tick(); maybeFail('delete'); db.mensajes = db.mensajes.filter((m) => !(m.id === id && m.barberia_id === tenantId)) },
    async updateMensaje(tenantId, id, patch) { await tick(); const row = db.mensajes.find((m) => m.id === id && m.barberia_id === tenantId); Object.assign(row, patch); return { ...row } },
    // Emulación de reservar_envio_panel: sin ceder el turno, como bajo el lock.
    async reserve({ tenantId, clienteId, clientMessageId, texto, hora, confirmResend, settings }) {
      await tick()
      if (!db.atomic) return null
      maybeFail('reserve')
      const cliente = db.clientes.find((c) => c.id === clienteId && c.barberia_id === tenantId)
      if (!cliente) return { status: 'customer_not_found' }
      const existing = db.mensajes.find((m) => m.barberia_id === tenantId && m.client_message_id === clientMessageId)
      const since = (seconds) => new Date(NOW.getTime() - seconds * 1000).toISOString()
      const inRate = (m) => m.barberia_id === tenantId && m.de === 'clinica' && m.estado_envio !== 'fallido' && m.created_at >= since(settings.rateWindowSeconds)
      const pause = () => { db.config = [{ barberia_id: tenantId, clave: 'bot_activo', valor: 'false' }, ...db.config.filter((c) => c.barberia_id !== tenantId)] }
      if (existing) {
        if (existing.cliente_id !== clienteId || existing.texto !== texto) return { status: 'idempotency_conflict' }
        if (!(existing.estado_envio === 'fallido' || (existing.estado_envio === 'incierto' && confirmResend))) return { status: 'replay', mensaje: { ...existing } }
        if (db.mensajes.filter((m) => inRate(m) && m.id !== existing.id).length >= settings.rateLimit) return { status: 'rate_limited' }
        Object.assign(existing, { estado_envio: 'pendiente', enviado_wsp: false })
        pause()
        return { status: 'reserved', mensaje: { ...existing } }
      }
      if (!confirmResend && db.mensajes.some((m) => m.barberia_id === tenantId && m.cliente_id === clienteId && m.de === 'clinica' && m.texto === texto && m.estado_envio !== 'fallido' && m.created_at >= since(settings.duplicateWindowSeconds))) return { status: 'possible_duplicate' }
      if (db.mensajes.filter(inRate).length >= settings.rateLimit) return { status: 'rate_limited' }
      const row = { id: db.nextId++, created_at: NOW.toISOString(), barberia_id: tenantId, cliente_id: clienteId, paciente: cliente.nombre, texto, de: 'clinica', hora, leido: true, telefono: '5491122334455', enviado_wsp: false, estado_envio: 'pendiente', client_message_id: clientMessageId }
      db.mensajes.push(row)
      pause()
      return { status: 'reserved', mensaje: { ...row } }
    },
    async complete(tenantId, id, estado, providerMessageId) {
      await tick()
      if (!['recibido_n8n', 'aceptado', 'incierto', 'fallido'].includes(estado)) throw new Error('invalid_result')
      const row = db.mensajes.find((m) => m.id === id && m.barberia_id === tenantId && ['pendiente', 'incierto'].includes(m.estado_envio))
      if (!row) return null
      Object.assign(row, { estado_envio: estado, enviado_wsp: ['recibido_n8n', 'aceptado'].includes(estado), ...(estado === 'aceptado' && providerMessageId ? { whatsapp_id: providerMessageId } : {}) })
      return { ...row }
    },
  }
  const deliveries = []
  const deliver = async (payload) => {
    deliveries.push(payload)
    await tick()
    if (db.outcome === 'throw') throw new Error('timeout')
    if (db.outcome === 'accepted') return { outcome: 'accepted', providerMessageId: 'EVO-1' }
    return db.outcome
  }
  return { db, store, deliver, deliveries }
}

async function run(ctx, body, userId = 'owner-7', settings = FIXED) {
  try {
    return { ok: true, value: await handlePanelSend({ user: { id: userId }, body, store: ctx.store, deliver: ctx.deliver, settings, now: NOW }) }
  } catch (error) {
    const { status, body: errorBody } = panelSendErrorBody(error)
    return { ok: false, status, code: errorBody.error.code, message: errorBody.error.message, contract: errorBody.contract, botPaused: errorBody.bot_paused }
  }
}

const send = (texto, extra = {}) => ({ action: 'send', tenant_id: TENANT, cliente_id: 100, texto, ...extra })

const results = []
async function test(name, fn) {
  await fn()
  results.push(name)
}

await test('cliente existente sin conversación: preflight listo, sin escribir ni enviar', async () => {
  const ctx = createDb()
  const result = await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { ready: true, contract: PANEL_SEND_CONTRACT, cliente_id: 100, bot_active: true })
  assert.equal(ctx.db.mensajes.length, 0, 'abrir el chat no crea mensajes')
  assert.equal(ctx.deliveries.length, 0, 'abrir el chat no envía nada')
})

await test('preflight repetido (doble clic / dos operadores) no escribe nada', async () => {
  const ctx = createDb()
  const [a, b] = await Promise.all([
    run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, 'owner-7'),
    run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, 'recep-7'),
  ])
  assert.equal(a.ok && b.ok, true)
  assert.equal(ctx.db.mensajes.length, 0)
  assert.equal(ctx.deliveries.length, 0)
})

await test('primer mensaje: queda asociado al cliente correcto con teléfono canónico de la ficha', async () => {
  const ctx = createDb()
  const result = await run(ctx, send('  Hola Ana  ', { hora: '12:00', telefono: '5490000000000', barberia_id: OTHER_TENANT, instance: 'otra' }))
  assert.equal(result.ok, true)
  assert.equal(ctx.db.mensajes.length, 1)
  const [row] = ctx.db.mensajes
  assert.equal(row.barberia_id, TENANT)
  assert.equal(row.cliente_id, 100)
  assert.equal(row.paciente, 'Ana Pérez', 'el nombre sale de la ficha')
  assert.equal(row.telefono, '5491122334455')
  assert.equal(row.texto, 'Hola Ana')
  assert.equal(row.de, 'clinica')
  assert.equal(row.hora, '12:00')
  assert.equal(row.enviado_wsp, true)
  assert.equal(row.estado_envio, 'recibido_n8n', 'la plantilla actual sólo confirma la recepción en n8n')
  assert.deepEqual(ctx.deliveries, [{ telefono: '5491122334455', texto: 'Hola Ana', barberia_id: TENANT, instance: 'miwsp', client_message_id: null }], 'el body no puede elegir teléfono, negocio ni instancia')
  assert.equal(result.value.sent, true)
  assert.equal(result.value.contract, PANEL_SEND_CONTRACT)
  assert.equal(result.value.mensaje.id, row.id)
  assert.equal(result.value.mensaje.cliente_id, 100)
})

await test('cliente con conversación existente: el mensaje se agrega al mismo cliente', async () => {
  const ctx = createDb()
  ctx.db.mensajes.push({ id: 50, barberia_id: TENANT, cliente_id: 100, de: 'paciente', texto: 'Hola', created_at: '2026-10-01T10:00:00.000Z' })
  ctx.db.nextId = 51
  const result = await run(ctx, send('Respuesta'))
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.db.mensajes.map((m) => m.cliente_id), [100, 100])
})

await test('compatibilidad: panel anterior (sin action) no duplica la fila que ya guardó el navegador', async () => {
  const ctx = createDb()
  // El panel viejo inserta primero desde el navegador y después llama sin action.
  ctx.db.mensajes.push({ id: 1, barberia_id: TENANT, cliente_id: 100, de: 'clinica', texto: 'Hola', estado_envio: 'enviado', created_at: NOW.toISOString() })
  ctx.db.nextId = 2
  const result = await run(ctx, { tenant_id: TENANT, cliente_id: 100, texto: 'Hola' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { sent: true, contract: PANEL_SEND_CONTRACT })
  assert.equal(ctx.db.mensajes.length, 1, 'el servidor no inserta otra fila')
  assert.equal(ctx.deliveries.length, 1)
  // Sus errores siguen el contrato viejo (la fila del navegador queda).
  ctx.db.outcome = 'throw'
  const uncertain = await run(ctx, { tenant_id: TENANT, cliente_id: 100, texto: 'Otro' })
  assert.equal(uncertain.code, 'panel_send_uncertain')
  ctx.db.outcome = 'rejected'
  const rejected = await run(ctx, { tenant_id: TENANT, cliente_id: 100, texto: 'Otro' })
  assert.equal(rejected.code, 'panel_send_rejected')
  assert.equal(ctx.db.mensajes.length, 1)
})

await test('compatibilidad: el límite del panel anterior cuenta la fila que ya guardó', async () => {
  const ctx = createDb()
  for (let i = 0; i < PANEL_SEND_RATE_LIMIT; i += 1) ctx.db.mensajes.push({ id: i + 1, barberia_id: TENANT, cliente_id: 100, de: 'clinica', texto: `m${i}`, created_at: NOW.toISOString() })
  assert.equal((await run(ctx, { tenant_id: TENANT, cliente_id: 100, texto: 'm19' })).ok, true, 'la vigésima pasa')
  ctx.db.mensajes.push({ id: 21, barberia_id: TENANT, cliente_id: 100, de: 'clinica', texto: 'm20', created_at: NOW.toISOString() })
  assert.equal((await run(ctx, { tenant_id: TENANT, cliente_id: 100, texto: 'm20' })).code, 'send_rate_limited')
})

await test('bloqueos previos al envío no informan pausa; la confirmación de reenvío advierte que pudo haber llegado', async () => {
  const ctx = createDb()
  for (let i = 0; i < PANEL_SEND_RATE_LIMIT; i += 1) assert.equal((await run(ctx, send(`m${i}`))).ok, true)
  const limited = await run(ctx, send('Otro'))
  assert.equal(limited.code, 'send_rate_limited')
  assert.equal(limited.botPaused, undefined, 'no se intentó enviar: no hay traspaso que informar')
  assert.equal(ctx.deliveries.length, PANEL_SEND_RATE_LIMIT, 'el frenado no llega a n8n')
  const ctx2 = createDb({ outcome: 'uncertain' })
  await run(ctx2, send('Hola'))
  const again = await run(ctx2, send('Hola'))
  assert.equal(again.code, 'panel_send_possible_duplicate')
  assert.match(again.message, /podría haber llegado/)
  assert.match(again.message, /dos veces/)
  assert.equal(ctx2.deliveries.length, 1, 'un incierto nunca se reenvía sin confirmación')
})

await test('teléfono sin 9 se normaliza al canónico 549', async () => {
  const ctx = createDb()
  const result = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 103, texto: 'Hola' })
  assert.equal(result.ok, true)
  assert.equal(ctx.deliveries[0].telefono, '5491122334455')
})

await test('teléfono inválido o ausente: error claro, sin escribir ni enviar', async () => {
  for (const [clienteId, code] of [[101, 'customer_phone_missing'], [102, 'customer_phone_invalid']]) {
    const ctx = createDb()
    for (const action of ['preflight', 'send']) {
      const result = await run(ctx, { action, tenant_id: TENANT, cliente_id: clienteId, texto: 'Hola' })
      assert.equal(result.ok, false)
      assert.equal(result.status, 422)
      assert.equal(result.code, code)
      assert.match(result.message, /ficha/)
    }
    assert.equal(ctx.db.mensajes.length, 0)
    assert.equal(ctx.deliveries.length, 0)
  }
})

await test('tenant ajeno: sin membresía o cliente de otro negocio', async () => {
  const ctx = createDb()
  const otherTenant = await run(ctx, { action: 'send', tenant_id: OTHER_TENANT, cliente_id: 900, texto: 'Hola' }, 'owner-7')
  assert.equal(otherTenant.status, 403)
  assert.equal(otherTenant.code, 'tenant_membership_required')
  const foreignClient = await run(ctx, send('Hola', { cliente_id: 900 }), 'owner-7')
  assert.equal(foreignClient.status, 404)
  assert.equal(foreignClient.code, 'customer_not_found')
  const preflightForeign = await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 900 }, 'owner-7')
  assert.equal(preflightForeign.code, 'customer_not_found')
  assert.equal(ctx.db.mensajes.length, 0)
  assert.equal(ctx.deliveries.length, 0)
})

await test('remitente: sólo el negocio dueño de la instancia del webhook puede enviar', async () => {
  const ctx = createDb()
  // El negocio 9 está conectado con su propio número: el webhook fijo saldría desde miwsp.
  for (const action of ['preflight', 'send']) {
    const result = await run(ctx, { action, tenant_id: OTHER_TENANT, cliente_id: 900, texto: 'Hola' }, 'owner-9')
    assert.equal(result.status, 409)
    assert.equal(result.code, 'panel_send_sender_mismatch')
  }
  // Sin instancia registrada tampoco.
  ctx.db.integraciones[TENANT] = { estado: 'conectado', external_instance_id: null }
  assert.equal((await run(ctx, send('Hola'))).code, 'panel_send_sender_mismatch')
  // Sin configuración del servidor, nadie envía (falla cerrada).
  ctx.db.integraciones[TENANT] = { estado: 'conectado', external_instance_id: 'miwsp' }
  const unconfigured = await run(ctx, send('Hola'), 'owner-7', panelSendSettings({}))
  assert.equal(unconfigured.status, 503)
  assert.equal(unconfigured.code, 'panel_send_not_configured')
  assert.equal(ctx.deliveries.length, 0)
  assert.equal(ctx.db.mensajes.length, 0)
  assert.equal(senderBlock({ external_instance_id: ' MIWSP ' }, FIXED), null)
})

await test('rol de sólo lectura y sesión ausente', async () => {
  const ctx = createDb()
  const readonly = await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, 'lector-7')
  assert.equal(readonly.status, 403)
  assert.equal(readonly.code, 'send_role_required')
  const anonymous = await handlePanelSend({ user: null, body: { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, store: ctx.store, deliver: ctx.deliver, settings: FIXED }).catch((error) => error)
  assert.equal(anonymous.status, 401)
})

await test('plan sin entitlement', async () => {
  for (const state of ['expired', 'suspended', 'none']) {
    const ctx = createDb()
    ctx.db.access[TENANT] = state
    const result = await run(ctx, send('Hola'))
    assert.equal(result.status, 402)
    assert.equal(result.code, 'subscription_inactive')
    assert.equal(ctx.deliveries.length, 0)
  }
})

await test('integración desconectada, pausada o ausente', async () => {
  const cases = [[null, 'whatsapp_not_configured'], [{ estado: 'desactivado', external_instance_id: 'miwsp' }, 'whatsapp_paused'], [{ estado: 'pendiente', external_instance_id: 'miwsp' }, 'whatsapp_disconnected'], [{ estado: 'error', external_instance_id: 'miwsp' }, 'whatsapp_disconnected']]
  for (const [integration, code] of cases) {
    const ctx = createDb()
    ctx.db.integraciones[TENANT] = integration
    for (const action of ['preflight', 'send']) {
      const result = await run(ctx, { action, tenant_id: TENANT, cliente_id: 100, texto: 'Hola' })
      assert.equal(result.status, 409)
      assert.equal(result.code, code)
      assert.match(result.message, /Configuración/)
    }
    assert.equal(ctx.db.mensajes.length, 0)
    assert.equal(ctx.deliveries.length, 0)
  }
  assert.equal(integrationBlock({ estado: 'conectado' }), null)
})

await test('pausa del bot: no bloquea la respuesta manual (es el traspaso); configuración ambigua falla cerrada', async () => {
  const paused = createDb({ config: [{ barberia_id: TENANT, clave: 'bot_activo', valor: 'false' }] })
  const preflight = await run(paused, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 })
  assert.equal(preflight.value.bot_active, false)
  const manual = await run(paused, send('Te atiendo yo'))
  assert.equal(manual.ok, true, 'con el bot en pausa la persona puede responder')
  assert.equal(paused.deliveries.length, 1)
  const ambiguous = createDb({ config: [{ barberia_id: TENANT, clave: 'bot_activo', valor: 'true' }, { barberia_id: TENANT, clave: 'bot_activo', valor: 'false' }] })
  const result = await run(ambiguous, send('Hola'))
  assert.equal(result.code, 'bot_pause_lookup_failed')
  assert.equal(ambiguous.deliveries.length, 0)
})

await test('clasificación del webhook: sólo 4xx (salvo 408) es rechazo confirmado', async () => {
  assert.equal(classifyWebhookStatus(200), 'accepted')
  assert.equal(classifyWebhookStatus(204), 'accepted')
  for (const status of [400, 401, 403, 404, 422, 429]) assert.equal(classifyWebhookStatus(status), 'rejected', String(status))
  for (const status of [408, 500, 502, 503, 504, 0, undefined]) assert.equal(classifyWebhookStatus(status), 'uncertain', String(status))
})

await test('rechazo confirmado: la fila se retira y reintentar es seguro', async () => {
  const ctx = createDb({ outcome: 'rejected' })
  const result = await run(ctx, send('Hola'))
  assert.equal(result.status, 502)
  assert.equal(result.code, 'panel_send_rejected')
  assert.match(result.message, /no salió/)
  assert.match(result.message, /borrador/)
  // Decisión del dueño (05/10): el bot queda pausado igual. Sin la reserva
  // atómica el servidor no lo pausó, así que lo informa para que lo haga el panel.
  assert.equal(result.botPaused, false, 'sin migración el servidor informa que no pausó')
  assert.equal(ctx.db.mensajes.length, 0, 'no queda un mensaje que el cliente nunca recibió')
  ctx.db.outcome = 'received'
  const retry = await run(ctx, send('Hola'))
  assert.equal(retry.ok, true, 'después de un rechazo confirmado el reintento no pide confirmación')
  assert.equal(ctx.db.mensajes.length, 1)
})

await test('rechazo confirmado sin poder borrar: la fila queda como fallida, no como pendiente', async () => {
  const ctx = createDb({ outcome: 'rejected' })
  ctx.db.failures.delete = true
  const result = await run(ctx, send('Hola'))
  assert.equal(result.code, 'panel_send_rejected')
  assert.equal(ctx.db.mensajes[0].estado_envio, 'fallido')
})

await test('resultado incierto: se conserva la evidencia y el reintento idéntico pide confirmación', async () => {
  for (const outcome of ['uncertain', 'throw', 'algo-raro']) {
    const ctx = createDb({ outcome })
    const result = await run(ctx, send('Hola'))
    assert.equal(result.ok, true, outcome)
    assert.equal(result.value.uncertain, true)
    assert.equal(result.value.sent, false)
    assert.equal(result.value.mensaje.estado_envio, 'incierto')
    assert.equal(ctx.db.mensajes.length, 1, 'la fila no se borra')
    assert.equal(ctx.db.mensajes[0].estado_envio, 'incierto')
    assert.equal(ctx.db.mensajes[0].enviado_wsp, false)
    ctx.db.outcome = 'received'
    const retry = await run(ctx, send('Hola'))
    assert.equal(retry.status, 409)
    assert.equal(retry.code, 'panel_send_possible_duplicate')
    assert.equal(ctx.deliveries.length, 1, 'el reintento no llega a n8n')
    assert.equal(ctx.db.mensajes.length, 1, 'el intento frenado no deja fila')
    const confirmed = await run(ctx, send('Hola', { confirm_resend: true }))
    assert.equal(confirmed.ok, true, 'con confirmación explícita se reenvía')
    assert.equal(ctx.deliveries.length, 2)
  }
})

await test('respuesta perdida del lado del panel: el mismo texto ya enviado pide confirmación', async () => {
  const ctx = createDb()
  assert.equal((await run(ctx, send('Hola'))).ok, true)
  // El panel no recibió la respuesta y el operador reintenta.
  const retry = await run(ctx, send('Hola'))
  assert.equal(retry.code, 'panel_send_possible_duplicate')
  assert.equal(ctx.deliveries.length, 1)
  // Otro texto, otro cliente o fuera de la ventana no se frena.
  assert.equal((await run(ctx, send('Hola de nuevo'))).ok, true)
  assert.equal((await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 103, texto: 'Hola' })).ok, true)
  ctx.db.mensajes.forEach((m) => { m.created_at = '2026-10-05T14:50:00.000Z' })
  assert.equal((await run(ctx, send('Hola'))).ok, true)
})

await test('doble envío simultáneo del mismo texto: sólo uno sale', async () => {
  const ctx = createDb()
  const [a, b] = await Promise.all([run(ctx, send('Hola')), run(ctx, send('Hola'), 'recep-7')])
  assert.equal([a, b].filter((r) => r.ok).length, 1)
  assert.equal([a, b].find((r) => !r.ok).code, 'panel_send_possible_duplicate')
  assert.equal(ctx.deliveries.length, 1)
  assert.equal(ctx.db.mensajes.length, 1)
})

await test('fallo al guardar: no se envía', async () => {
  const ctx = createDb()
  ctx.db.failures.insert = true
  const result = await run(ctx, send('Hola'))
  assert.equal(result.code, 'message_insert_failed')
  assert.equal(ctx.deliveries.length, 0)
})

await test('fallos de lectura del servidor fallan cerrados sin enviar ni dejar filas', async () => {
  for (const name of ['membership', 'accessState', 'integration', 'botConfig', 'cliente', 'count']) {
    const ctx = createDb()
    ctx.db.failures[name] = true
    const result = await run(ctx, send('Hola'))
    assert.equal(result.ok, false, name)
    assert.equal(result.status, 502, name)
    assert.equal(ctx.deliveries.length, 0, name)
    assert.equal(ctx.db.mensajes.length, 0, name)
  }
})

await test('límite de envíos por negocio (propuesta: 20 por minuto)', async () => {
  const ctx = createDb()
  for (let i = 0; i < PANEL_SEND_RATE_LIMIT; i += 1) {
    ctx.db.mensajes.push({ id: 1000 + i, barberia_id: TENANT, cliente_id: 100, de: 'clinica', texto: `previo ${i}`, estado_envio: 'enviado', created_at: new Date(NOW.getTime() - 10_000).toISOString() })
  }
  // Mensajes de otro negocio no cuentan.
  ctx.db.mensajes.push({ id: 2000, barberia_id: OTHER_TENANT, de: 'clinica', created_at: NOW.toISOString() })
  ctx.db.nextId = 3000
  const result = await run(ctx, send('Hola'))
  assert.equal(result.status, 429)
  assert.equal(result.code, 'send_rate_limited')
  assert.equal(ctx.deliveries.length, 0)
  assert.equal(ctx.db.mensajes.filter((m) => m.barberia_id === TENANT).length, PANEL_SEND_RATE_LIMIT, 'el intento frenado no deja fila')
  // Fuera de la ventana vuelve a permitir.
  ctx.db.mensajes.forEach((m) => { m.created_at = '2026-10-05T14:58:00.000Z' })
  assert.equal((await run(ctx, send('Hola'))).ok, true)
})

await test('límite con concurrencia: 25 envíos simultáneos dejan pasar exactamente 20', async () => {
  const ctx = createDb()
  const all = await Promise.all(Array.from({ length: 25 }, (_, i) => run(ctx, send(`m${i}`), i % 2 ? 'recep-7' : 'owner-7')))
  assert.equal(all.filter((r) => r.ok).length, PANEL_SEND_RATE_LIMIT)
  assert.equal(all.filter((r) => r.code === 'send_rate_limited').length, 5)
  assert.equal(ctx.deliveries.length, PANEL_SEND_RATE_LIMIT)
  assert.equal(ctx.db.mensajes.length, PANEL_SEND_RATE_LIMIT, 'los rechazados no dejan filas')
  // Los admitidos son los primeros por orden de guardado.
  assert.deepEqual(ctx.db.mensajes.map((m) => m.id), Array.from({ length: 20 }, (_, i) => i + 1))
  const other = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 103, texto: 'otro' })
  assert.equal(other.code, 'send_rate_limited', 'el límite es por negocio, no por cliente')
})

await test('dos operadores envían textos distintos a la vez: dos mensajes del mismo cliente', async () => {
  const ctx = createDb()
  const [a, b] = await Promise.all([
    run(ctx, send('Hola de Ana'), 'owner-7'),
    run(ctx, send('Hola de recepción'), 'recep-7'),
  ])
  assert.equal(a.ok && b.ok, true)
  assert.deepEqual([...new Set(ctx.db.mensajes.map((m) => m.cliente_id))], [100])
})

await test('validaciones de entrada', async () => {
  const ctx = createDb()
  assert.equal((await run(ctx, { action: 'borrar', tenant_id: TENANT, cliente_id: 100 })).code, 'invalid_action')
  assert.equal((await run(ctx, send('   '))).code, 'invalid_text')
  assert.equal((await run(ctx, send('x'.repeat(4097)))).code, 'invalid_text')
  assert.equal((await run(ctx, { action: 'preflight', tenant_id: 'abc', cliente_id: 100 })).code, 'invalid_target')
  assert.equal((await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: -1 })).code, 'invalid_target')
  const internal = panelSendErrorBody(Object.assign(new Error('detalle interno con secreto'), { status: 500 }))
  assert.equal(internal.body.error.message, 'No se pudo enviar el mensaje.')
  assert.equal(internal.body.contract, PANEL_SEND_CONTRACT)
})

const KEY_A = '11111111-1111-4111-8111-111111111111'
const KEY_B = '22222222-2222-4222-8222-222222222222'
const atomicDb = (overrides = {}) => createDb({ atomic: true, ...overrides })

await test('atómico: reserva con identificador, pausa del bot en la base antes del envío', async () => {
  const ctx = atomicDb()
  let pausedBeforeDelivery = null
  const deliver = ctx.deliver
  ctx.deliver = async (payload) => { pausedBeforeDelivery = ctx.db.config.some((c) => c.barberia_id === TENANT && c.valor === 'false'); return deliver(payload) }
  const result = await run(ctx, send('Hola', { client_message_id: KEY_A }))
  assert.equal(result.ok, true)
  assert.equal(pausedBeforeDelivery, true, 'P4: el bot ya estaba pausado cuando se llamó a n8n')
  assert.equal(result.value.bot_paused, true, 'el panel no necesita pausarlo después')
  assert.equal(ctx.db.mensajes[0].client_message_id, KEY_A)
  assert.equal(ctx.deliveries[0].client_message_id, KEY_A)
  assert.equal(result.value.estado_envio, 'recibido_n8n')
})

await test('atómico: respuesta perdida y reintento con el mismo identificador = repetición, sin reenvío', async () => {
  const ctx = atomicDb()
  assert.equal((await run(ctx, send('Hola', { client_message_id: KEY_A }))).ok, true)
  const replay = await run(ctx, send('Hola', { client_message_id: KEY_A }))
  assert.equal(replay.ok, true)
  assert.equal(replay.value.replay, true)
  assert.equal(replay.value.sent, true)
  assert.equal(replay.value.estado_envio, 'recibido_n8n')
  assert.equal(ctx.deliveries.length, 1, 'la repetición no llega a n8n')
  assert.equal(ctx.db.mensajes.length, 1)
  const conflict = await run(ctx, send('Otro texto', { client_message_id: KEY_A }))
  assert.equal(conflict.code, 'idempotency_conflict')
})

await test('atómico: rechazo confirmado deja la fila "fallido" y el mismo identificador reintenta sobre ella', async () => {
  const ctx = atomicDb({ outcome: 'rejected' })
  const rejected = await run(ctx, send('Hola', { client_message_id: KEY_A }))
  assert.equal(rejected.code, 'panel_send_rejected')
  assert.equal(rejected.botPaused, true, 'la reserva ya pausó el bot y no se revierte ante el rechazo')
  assert.equal(ctx.db.mensajes[0].estado_envio, 'fallido')
  ctx.db.outcome = 'received'
  const retry = await run(ctx, send('Hola', { client_message_id: KEY_A }))
  assert.equal(retry.ok, true)
  assert.equal(ctx.db.mensajes.length, 1, 'misma fila')
  assert.equal(ctx.db.mensajes[0].estado_envio, 'recibido_n8n')
  assert.equal(ctx.deliveries.length, 2)
})

await test('atómico: incierto no se reenvía sin confirmación; con confirmación usa la misma fila', async () => {
  const ctx = atomicDb({ outcome: 'throw' })
  const first = await run(ctx, send('Hola', { client_message_id: KEY_A }))
  assert.equal(first.value.uncertain, true)
  assert.equal(ctx.db.mensajes[0].estado_envio, 'incierto')
  ctx.db.outcome = 'received'
  const replay = await run(ctx, send('Hola', { client_message_id: KEY_A }))
  assert.equal(replay.value.replay, true)
  assert.equal(replay.value.uncertain, true)
  assert.equal(ctx.deliveries.length, 1)
  const otherKey = await run(ctx, send('Hola', { client_message_id: KEY_B }))
  assert.equal(otherKey.code, 'panel_send_possible_duplicate', 'otro identificador, mismo texto')
  const confirmed = await run(ctx, send('Hola', { client_message_id: KEY_A, confirm_resend: true }))
  assert.equal(confirmed.ok, true)
  assert.equal(ctx.db.mensajes.length, 1)
  assert.equal(ctx.deliveries.length, 2)
})

await test('evidencia: recepción de n8n, aceptación de Evolution y nunca "entregado" sin evidencia', async () => {
  assert.deepEqual(classifyWebhookResponse(200, null), { outcome: 'received', providerMessageId: null })
  assert.deepEqual(classifyWebhookResponse(200, { message: 'Workflow was started' }), { outcome: 'received', providerMessageId: null })
  assert.deepEqual(classifyWebhookResponse(200, { result: 'accepted', message_id: 'EVO-9' }), { outcome: 'accepted', providerMessageId: 'EVO-9' })
  assert.deepEqual(classifyWebhookResponse(500, { result: 'accepted' }), { outcome: 'uncertain', providerMessageId: null }, 'aceptado con 5xx no es evidencia')
  assert.deepEqual(classifyWebhookResponse(422, { result: 'rejected' }), { outcome: 'rejected', providerMessageId: null })
  assert.deepEqual(classifyWebhookResponse(200, { result: 'rejected' }), { outcome: 'rejected', providerMessageId: null })
  assert.deepEqual(classifyWebhookResponse(502, { result: 'uncertain' }), { outcome: 'uncertain', providerMessageId: null })
  assert.deepEqual(classifyWebhookResponse(200, { result: 'delivered' }), { outcome: 'received', providerMessageId: null }, 'un resultado desconocido no sube de nivel')
  const ctx = atomicDb({ outcome: 'accepted' })
  const result = await run(ctx, send('Hola', { client_message_id: KEY_A }))
  assert.equal(result.value.estado_envio, 'aceptado')
  assert.equal(ctx.db.mensajes[0].whatsapp_id, 'EVO-1')
  for (const outcome of ['received', 'accepted', 'rejected', 'uncertain', 'throw']) {
    const each = atomicDb({ outcome })
    await run(each, send('Hola', { client_message_id: KEY_A }))
    assert.notEqual(each.db.mensajes[0].estado_envio, 'entregado', outcome)
  }
})

await test('atómico: cliente de otro negocio y teléfono inválido según la base', async () => {
  const ctx = atomicDb()
  // El handler ya filtra por tenant; si la reserva igual lo reportara, se respeta.
  ctx.store.cliente = async () => ({ id: 100, barberia_id: TENANT, nombre: 'Ana', telefono: '5491122334455' })
  ctx.db.clientes = ctx.db.clientes.filter((c) => c.id !== 100)
  assert.equal((await run(ctx, send('Hola', { client_message_id: KEY_A }))).code, 'customer_not_found')
  assert.equal(ctx.deliveries.length, 0)
})

await test('atómico: identificador inválido y fallo de la reserva no envían', async () => {
  const ctx = atomicDb()
  assert.equal((await run(ctx, send('Hola', { client_message_id: 'no-es-uuid' }))).code, 'invalid_client_message_id')
  ctx.db.failures.reserve = true
  assert.equal((await run(ctx, send('Hola', { client_message_id: KEY_A }))).code, 'message_insert_failed')
  assert.equal(ctx.deliveries.length, 0)
})

await test('atómico: límite configurable aplicado por la reserva', async () => {
  const ctx = atomicDb()
  const settings = panelSendSettings({ WHATSAPP_PANEL_SEND_INSTANCE: 'miwsp', WHATSAPP_PANEL_SEND_RATE_LIMIT: '2' })
  const results = []
  for (let i = 0; i < 3; i += 1) results.push(await run(ctx, send(`m${i}`, { client_message_id: `33333333-3333-4333-8333-00000000000${i}` }), 'owner-7', settings))
  assert.deepEqual(results.map((r) => r.ok || r.code), [true, true, 'send_rate_limited'])
})

await test('configuración: valores propuestos por defecto, inválidos fallan cerrado', async () => {
  assert.deepEqual(PANEL_SEND_PROPOSED_SETTINGS, { rateLimit: 20, rateWindowSeconds: 60, duplicateWindowSeconds: 300, stalePendingSeconds: 120 })
  const defaults = panelSendSettings({ WHATSAPP_PANEL_SEND_INSTANCE: 'miwsp' })
  assert.equal(defaults.valid, true)
  assert.equal(defaults.routing, 'fixed', 'sin variable se mantiene el remitente fijo (plantilla actual)')
  assert.equal(defaults.rateLimit, 20)
  const custom = panelSendSettings({ WHATSAPP_PANEL_SEND_RATE_LIMIT: '5', WHATSAPP_PANEL_SEND_DUPLICATE_WINDOW_SECONDS: '0', WHATSAPP_PANEL_SEND_ROUTING: 'instance' })
  assert.equal(custom.rateLimit, 5)
  assert.equal(custom.duplicateWindowSeconds, 0)
  for (const env of [{ WHATSAPP_PANEL_SEND_RATE_LIMIT: '0' }, { WHATSAPP_PANEL_SEND_RATE_LIMIT: 'veinte' }, { WHATSAPP_PANEL_SEND_STALE_PENDING_SECONDS: '5' }, { WHATSAPP_PANEL_SEND_ROUTING: 'body' }]) {
    const settings = panelSendSettings({ WHATSAPP_PANEL_SEND_INSTANCE: 'miwsp', ...env })
    assert.equal(settings.valid, false, JSON.stringify(env))
    const ctx = createDb()
    const result = await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, 'owner-7', settings)
    assert.equal(result.code, 'panel_send_not_configured', JSON.stringify(env))
  }
})

await test('enrutamiento por instancia: cada negocio sale por su instancia, nunca por la del body', async () => {
  const ctx = atomicDb()
  const result = await run(ctx, { action: 'send', tenant_id: OTHER_TENANT, cliente_id: 900, texto: 'Hola', instance: 'miwsp', client_message_id: KEY_A }, 'owner-9', ROUTED)
  assert.equal(result.ok, true)
  assert.equal(ctx.deliveries[0].instance, 'austral-qa-tenant-9')
  assert.equal(ctx.deliveries[0].barberia_id, OTHER_TENANT)
  ctx.db.integraciones[OTHER_TENANT] = { estado: 'conectado', external_instance_id: '' }
  assert.equal((await run(ctx, { action: 'preflight', tenant_id: OTHER_TENANT, cliente_id: 900 }, 'owner-9', ROUTED)).code, 'panel_send_sender_mismatch')
  ctx.db.integraciones[OTHER_TENANT] = { estado: 'conectado', external_instance_id: '../miwsp' }
  assert.equal((await run(ctx, { action: 'preflight', tenant_id: OTHER_TENANT, cliente_id: 900 }, 'owner-9', ROUTED)).code, 'panel_send_sender_mismatch', 'nombre de instancia con caracteres no permitidos')
})

await test('panel: Iniciar chat no escribe ni envía; el envío pasa sólo por el servidor', async () => {
  const app = readFileSync('src/App.jsx', 'utf8')
  const start = app.indexOf('const iniciarChatCliente = async (clienteId) => {')
  const end = app.indexOf('const updateTurnoEstado', start)
  assert.ok(start > 0 && end > start, 'App debe definir iniciarChatCliente')
  const iniciar = app.slice(start, end)
  assert.match(iniciar, /asegurarHiloCliente\(prev, cliente\)/, 'abre o crea el hilo de forma idempotente')
  assert.match(iniciar, /claveHiloCliente\(clienteId\)/, 'usa la clave determinística del cliente')
  assert.match(iniciar, /verificarChatCliente\(/, 'valida en el servidor sin enviar')
  assert.doesNotMatch(iniciar, /\.insert\(|\.upsert\(|enviarMensajePanel/, 'abrir el chat no escribe ni envía')
  const envio = readFileSync('src/lib/envioPanel.js', 'utf8')
  assert.match(envio, /action: 'send', tenant_id: tenantId, cliente_id: clienteId, texto/)
  assert.match(envio, /action: 'preflight', tenant_id: tenantId, cliente_id: clienteId/)
  assert.doesNotMatch(envio, /telefono:/, 'el navegador no envía teléfono')
  const clientes = readFileSync('src/components/Clientes.jsx', 'utf8')
  assert.match(clientes, /onStartChat/, 'la ficha ofrece iniciar el chat')
})

console.log(`WhatsApp panel send checks passed (${results.length})`)
