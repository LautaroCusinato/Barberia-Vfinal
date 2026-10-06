// Tarea 38: envío manual del panel y "Iniciar chat" desde la ficha del cliente.
// Ejercita el handler real de whatsapp-panel-send con una base en memoria y un
// webhook simulado. No usa red, Supabase ni WhatsApp. Cada acceso a la base
// cede el turno (setImmediate) para que las carreras sean reproducibles.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PANEL_SEND_CONTRACT,
  PANEL_SEND_RATE_LIMIT,
  classifyWebhookStatus,
  handlePanelSend,
  integrationBlock,
  panelSendErrorBody,
  senderBlock,
} from '../supabase/functions/_shared/whatsappPanelSend.mjs'

const TENANT = 7
const OTHER_TENANT = 9
const SENDER = 'miwsp'
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
    outcome: 'accepted',
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
  }
  const deliveries = []
  const deliver = async (payload) => {
    deliveries.push(payload)
    await tick()
    if (db.outcome === 'throw') throw new Error('timeout')
    return db.outcome
  }
  return { db, store, deliver, deliveries }
}

async function run(ctx, body, userId = 'owner-7', senderInstance = SENDER) {
  try {
    return { ok: true, value: await handlePanelSend({ user: { id: userId }, body, store: ctx.store, deliver: ctx.deliver, senderInstance, now: NOW }) }
  } catch (error) {
    const { status, body: errorBody } = panelSendErrorBody(error)
    return { ok: false, status, code: errorBody.error.code, message: errorBody.error.message, contract: errorBody.contract }
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
  assert.equal(row.estado_envio, 'enviado')
  assert.deepEqual(ctx.deliveries, [{ telefono: '5491122334455', texto: 'Hola Ana', barberia_id: TENANT, instance: 'miwsp' }], 'el body no puede elegir teléfono, negocio ni instancia')
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
  const unconfigured = await run(ctx, send('Hola'), 'owner-7', '')
  assert.equal(unconfigured.status, 503)
  assert.equal(unconfigured.code, 'panel_send_not_configured')
  assert.equal(ctx.deliveries.length, 0)
  assert.equal(ctx.db.mensajes.length, 0)
  assert.equal(senderBlock({ external_instance_id: ' MIWSP ' }, 'miwsp'), null)
})

await test('rol de sólo lectura y sesión ausente', async () => {
  const ctx = createDb()
  const readonly = await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, 'lector-7')
  assert.equal(readonly.status, 403)
  assert.equal(readonly.code, 'send_role_required')
  const anonymous = await handlePanelSend({ user: null, body: { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, store: ctx.store, deliver: ctx.deliver, senderInstance: SENDER }).catch((error) => error)
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
  assert.equal(ctx.db.mensajes.length, 0, 'no queda un mensaje que el cliente nunca recibió')
  ctx.db.outcome = 'accepted'
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
    ctx.db.outcome = 'accepted'
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
