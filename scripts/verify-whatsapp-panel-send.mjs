// Tarea 38: envío manual del panel y "Iniciar chat" desde la ficha del cliente.
// Ejercita el handler real de whatsapp-panel-send con una base en memoria y un
// webhook simulado. No usa red, Supabase ni WhatsApp.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PANEL_SEND_RATE_LIMIT,
  handlePanelSend,
  integrationBlock,
  panelSendErrorBody,
} from '../supabase/functions/_shared/whatsappPanelSend.mjs'

const TENANT = 7
const OTHER_TENANT = 9
const NOW = new Date('2026-10-05T15:00:00.000Z')

function createDb(overrides = {}) {
  const db = {
    members: [
      { barberia_id: TENANT, user_id: 'owner-7', role: 'owner' },
      { barberia_id: TENANT, user_id: 'recep-7', role: 'recepcionista' },
      { barberia_id: TENANT, user_id: 'lector-7', role: 'readonly' },
      { barberia_id: OTHER_TENANT, user_id: 'owner-9', role: 'owner' },
    ],
    access: { [TENANT]: 'active', [OTHER_TENANT]: 'active' },
    integraciones: { [TENANT]: { estado: 'conectado' }, [OTHER_TENANT]: { estado: 'conectado' } },
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
    ...overrides,
  }
  const maybeFail = (name) => { if (db.failures[name]) throw new Error(`${name} failed`) }
  const store = {
    async membership(tenantId, userId) { maybeFail('membership'); return db.members.find((m) => m.barberia_id === tenantId && m.user_id === userId) || null },
    async accessState(tenantId) { maybeFail('accessState'); return db.access[tenantId] ?? 'none' },
    async integration(tenantId) { maybeFail('integration'); return db.integraciones[tenantId] || null },
    async botConfig(tenantId) { maybeFail('botConfig'); return db.config.filter((row) => row.barberia_id === tenantId) },
    async cliente(tenantId, clienteId) { maybeFail('cliente'); return db.clientes.find((c) => c.id === clienteId && c.barberia_id === tenantId) || null },
    async countRecentPanelSends(tenantId, since) { maybeFail('count'); return db.mensajes.filter((m) => m.barberia_id === tenantId && m.de === 'clinica' && m.created_at >= since).length },
    async insertMensaje(row) { maybeFail('insert'); const saved = { id: db.nextId++, created_at: NOW.toISOString(), ...row }; db.mensajes.push(saved); return { ...saved } },
    async deleteMensaje(tenantId, id) { maybeFail('delete'); db.mensajes = db.mensajes.filter((m) => !(m.id === id && m.barberia_id === tenantId)) },
    async markMensajeSent(tenantId, id) { const row = db.mensajes.find((m) => m.id === id && m.barberia_id === tenantId); Object.assign(row, { enviado_wsp: true, estado_envio: 'enviado' }); return { ...row } },
  }
  const deliveries = []
  const deliver = async (payload) => { deliveries.push(payload); if (db.failures.deliver === 'throw') throw new Error('timeout'); return !db.failures.deliver }
  return { db, store, deliver, deliveries }
}

async function run(ctx, body, userId = 'owner-7') {
  try {
    return { ok: true, value: await handlePanelSend({ user: { id: userId }, body, store: ctx.store, deliver: ctx.deliver, now: NOW }) }
  } catch (error) {
    const { status, body: errorBody } = panelSendErrorBody(error)
    return { ok: false, status, code: errorBody.error.code, message: errorBody.error.message }
  }
}

const results = []
async function test(name, fn) {
  await fn()
  results.push(name)
}

await test('cliente existente sin conversación: preflight listo, sin escribir ni enviar', async () => {
  const ctx = createDb()
  const result = await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { ready: true, cliente_id: 100, bot_active: true })
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
  const result = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: '  Hola Ana  ', hora: '12:00', telefono: '5490000000000', barberia_id: OTHER_TENANT })
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
  assert.deepEqual(ctx.deliveries, [{ telefono: '5491122334455', texto: 'Hola Ana', barberia_id: TENANT }], 'el body no puede elegir teléfono ni negocio')
  assert.equal(result.value.sent, true)
  assert.equal(result.value.mensaje.id, row.id)
  assert.equal(result.value.mensaje.cliente_id, 100)
})

await test('cliente con conversación existente: el mensaje se agrega al mismo cliente', async () => {
  const ctx = createDb()
  ctx.db.mensajes.push({ id: 50, barberia_id: TENANT, cliente_id: 100, de: 'paciente', texto: 'Hola', created_at: '2026-10-01T10:00:00.000Z' })
  const result = await run(ctx, { tenant_id: TENANT, cliente_id: 100, texto: 'Respuesta' })
  assert.equal(result.ok, true, 'sin action se mantiene el envío (compatibilidad)')
  assert.deepEqual(ctx.db.mensajes.map((m) => m.cliente_id), [100, 100])
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
  const foreignClient = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 900, texto: 'Hola' }, 'owner-7')
  assert.equal(foreignClient.status, 404)
  assert.equal(foreignClient.code, 'customer_not_found')
  const preflightForeign = await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 900 }, 'owner-7')
  assert.equal(preflightForeign.code, 'customer_not_found')
  assert.equal(ctx.db.mensajes.length, 0)
  assert.equal(ctx.deliveries.length, 0)
})

await test('rol de sólo lectura y sesión ausente', async () => {
  const ctx = createDb()
  const readonly = await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, 'lector-7')
  assert.equal(readonly.status, 403)
  assert.equal(readonly.code, 'send_role_required')
  const anonymous = await handlePanelSend({ user: null, body: { action: 'preflight', tenant_id: TENANT, cliente_id: 100 }, store: ctx.store, deliver: ctx.deliver }).catch((error) => error)
  assert.equal(anonymous.status, 401)
})

await test('plan sin entitlement', async () => {
  for (const state of ['expired', 'suspended', 'none']) {
    const ctx = createDb()
    ctx.db.access[TENANT] = state
    const result = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'Hola' })
    assert.equal(result.status, 402)
    assert.equal(result.code, 'subscription_inactive')
    assert.equal(ctx.deliveries.length, 0)
  }
})

await test('integración desconectada, pausada o ausente', async () => {
  const cases = [[null, 'whatsapp_not_configured'], [{ estado: 'desactivado' }, 'whatsapp_paused'], [{ estado: 'pendiente' }, 'whatsapp_disconnected'], [{ estado: 'error' }, 'whatsapp_disconnected']]
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

await test('bot en pausa manual: se puede responder; configuración ambigua falla cerrada', async () => {
  const paused = createDb({ config: [{ barberia_id: TENANT, clave: 'bot_activo', valor: 'false' }] })
  const ok = await run(paused, { action: 'preflight', tenant_id: TENANT, cliente_id: 100 })
  assert.equal(ok.value.bot_active, false)
  const ambiguous = createDb({ config: [{ barberia_id: TENANT, clave: 'bot_activo', valor: 'true' }, { barberia_id: TENANT, clave: 'bot_activo', valor: 'false' }] })
  const result = await run(ambiguous, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'Hola' })
  assert.equal(result.code, 'bot_pause_lookup_failed')
  assert.equal(ambiguous.deliveries.length, 0)
})

await test('error de envío: la fila se retira y el panel conserva el borrador', async () => {
  for (const mode of [true, 'throw']) {
    const ctx = createDb()
    ctx.db.failures.deliver = mode
    const result = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'Hola' })
    assert.equal(result.status, 502)
    assert.equal(result.code, 'panel_send_upstream_failed')
    assert.match(result.message, /borrador/)
    assert.equal(ctx.deliveries.length, 1)
    assert.equal(ctx.db.mensajes.length, 0, 'no queda un mensaje que el cliente nunca recibió')
  }
})

await test('fallo al guardar: no se envía', async () => {
  const ctx = createDb()
  ctx.db.failures.insert = true
  const result = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'Hola' })
  assert.equal(result.code, 'message_insert_failed')
  assert.equal(ctx.deliveries.length, 0)
})

await test('fallos de lectura del servidor fallan cerrados sin enviar', async () => {
  for (const name of ['membership', 'accessState', 'integration', 'botConfig', 'cliente', 'count']) {
    const ctx = createDb()
    ctx.db.failures[name] = true
    const result = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'Hola' })
    assert.equal(result.ok, false, name)
    assert.equal(result.status, 502, name)
    assert.equal(ctx.deliveries.length, 0, name)
  }
})

await test('límite de envíos del tenant contado en el servidor', async () => {
  const ctx = createDb()
  for (let i = 0; i < PANEL_SEND_RATE_LIMIT; i += 1) {
    ctx.db.mensajes.push({ id: 1000 + i, barberia_id: TENANT, cliente_id: 100, de: 'clinica', created_at: new Date(NOW.getTime() - 10_000).toISOString() })
  }
  // Mensajes viejos, del cliente o de otro negocio no cuentan.
  ctx.db.mensajes.push({ id: 2000, barberia_id: OTHER_TENANT, de: 'clinica', created_at: NOW.toISOString() })
  const result = await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'Hola' })
  assert.equal(result.status, 429)
  assert.equal(result.code, 'send_rate_limited')
  assert.equal(ctx.deliveries.length, 0)
  const other = await run(ctx, { action: 'send', tenant_id: OTHER_TENANT, cliente_id: 900, texto: 'Hola' }, 'owner-9')
  assert.equal(other.ok, true, 'el límite es por negocio')
})

await test('dos operadores envían a la vez: dos mensajes del mismo cliente, sin hilo nuevo', async () => {
  const ctx = createDb()
  const [a, b] = await Promise.all([
    run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'Hola de Ana' }, 'owner-7'),
    run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'Hola de recepción' }, 'recep-7'),
  ])
  assert.equal(a.ok && b.ok, true)
  assert.deepEqual([...new Set(ctx.db.mensajes.map((m) => m.cliente_id))], [100])
})

await test('validaciones de entrada', async () => {
  const ctx = createDb()
  assert.equal((await run(ctx, { action: 'borrar', tenant_id: TENANT, cliente_id: 100 })).code, 'invalid_action')
  assert.equal((await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: '   ' })).code, 'invalid_text')
  assert.equal((await run(ctx, { action: 'send', tenant_id: TENANT, cliente_id: 100, texto: 'x'.repeat(4097) })).code, 'invalid_text')
  assert.equal((await run(ctx, { action: 'preflight', tenant_id: 'abc', cliente_id: 100 })).code, 'invalid_target')
  assert.equal((await run(ctx, { action: 'preflight', tenant_id: TENANT, cliente_id: -1 })).code, 'invalid_target')
  const internal = panelSendErrorBody(Object.assign(new Error('detalle interno con secreto'), { status: 500 }))
  assert.equal(internal.body.error.message, 'No se pudo enviar el mensaje.')
})

await test('panel: Iniciar chat no escribe ni envía; el envío pasa sólo por el servidor', async () => {
  const app = readFileSync('src/App.jsx', 'utf8')
  const start = app.indexOf('const iniciarChatCliente = async (clienteId) => {')
  const end = app.indexOf('const updateTurnoEstado', start)
  assert.ok(start > 0 && end > start, 'App debe definir iniciarChatCliente')
  const iniciar = app.slice(start, end)
  assert.match(iniciar, /asegurarHiloCliente\(prev, cliente\)/, 'abre o crea el hilo de forma idempotente')
  assert.match(iniciar, /claveHiloCliente\(clienteId\)/, 'usa la clave determinística del cliente')
  assert.match(iniciar, /action: 'preflight'/, 'valida en el servidor sin enviar')
  assert.doesNotMatch(iniciar, /\.insert\(|\.upsert\(|action: 'send'/, 'abrir el chat no escribe ni envía')
  const sendStart = app.indexOf('const sendMensaje = async')
  const send = app.slice(sendStart, app.indexOf('const addServicio', sendStart))
  assert.doesNotMatch(send, /from\('mensajes'\)\.insert/, 'el mensaje lo guarda el servidor con el cliente_id resuelto')
  assert.match(send, /action: 'send', tenant_id: barberiaId, cliente_id: clienteId, texto/)
  assert.doesNotMatch(send, /telefono:/, 'el navegador no envía teléfono')
  const clientes = readFileSync('src/components/Clientes.jsx', 'utf8')
  assert.match(clientes, /onStartChat/, 'la ficha ofrece iniciar el chat')
})

console.log(`WhatsApp panel send checks passed (${results.length})`)
