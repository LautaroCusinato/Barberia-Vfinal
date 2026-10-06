// Compatibilidad del envío del panel (revisión de la tarea 38): frontend viejo
// o nuevo contra función vieja o nueva, con una base compartida en memoria. La
// función nueva es el handler real; la vieja simula la versión de c082d3c.
import { describe, expect, it } from 'vitest'
import { handlePanelSend, panelSendErrorBody, panelSendSettings } from '../../supabase/functions/_shared/whatsappPanelSend.mjs'
import { AVISO_DESCONOCIDO, AVISO_YA_ENVIADO, claveDeEnvio, enviarMensajePanel, olvidarClaveDeEnvio, verificarChatCliente } from './envioPanel.js'

const TENANT = 7
const NOW = new Date('2026-10-05T15:00:00.000Z')

const SETTINGS = panelSendSettings({ WHATSAPP_PANEL_SEND_INSTANCE: 'miwsp' })

// `atomic`: emula reservar_envio_panel (idempotencia por identificador, texto
// repetido e inserción en un paso). La atomicidad real se prueba en PostgreSQL.
function crearEntorno({ atomic = false } = {}) {
  const db = { mensajes: [], nextId: 1, entregas: [], resultado: 'received' }
  const store = {
    async membership() { return { role: 'owner' } },
    async accessState() { return 'active' },
    async integration() { return { estado: 'conectado', external_instance_id: 'miwsp' } },
    async botConfig() { return [] },
    async cliente(tenantId, clienteId) { return clienteId === 100 ? { id: 100, barberia_id: TENANT, nombre: 'Ana Pérez', telefono: '5491122334455' } : null },
    async countRecentPanelSends(tenantId, since) { return db.mensajes.filter((m) => m.de === 'clinica' && m.created_at >= since).length },
    async countEarlierSameText({ clienteId, texto, since, beforeId, states }) { return db.mensajes.filter((m) => m.cliente_id === clienteId && m.de === 'clinica' && m.texto === texto && states.includes(m.estado_envio) && m.created_at >= since && m.id < beforeId).length },
    async countPanelSendsThrough(tenantId, since, throughId) { return db.mensajes.filter((m) => m.de === 'clinica' && m.created_at >= since && m.id <= throughId).length },
    async insertMensaje(row) { const saved = { id: db.nextId++, created_at: NOW.toISOString(), ...row }; db.mensajes.push(saved); return { ...saved } },
    async deleteMensaje(tenantId, id) { db.mensajes = db.mensajes.filter((m) => m.id !== id) },
    async updateMensaje(tenantId, id, patch) { const row = db.mensajes.find((m) => m.id === id); Object.assign(row, patch); return { ...row } },
    async reserve({ clienteId, clientMessageId, texto, hora, confirmResend }) {
      if (!atomic) return null
      const existing = db.mensajes.find((m) => m.client_message_id === clientMessageId)
      if (existing) {
        if (existing.texto !== texto || existing.cliente_id !== clienteId) return { status: 'idempotency_conflict' }
        if (!(existing.estado_envio === 'fallido' || (existing.estado_envio === 'incierto' && confirmResend))) return { status: 'replay', mensaje: { ...existing } }
        existing.estado_envio = 'pendiente'
        return { status: 'reserved', mensaje: { ...existing } }
      }
      if (!confirmResend && db.mensajes.some((m) => m.cliente_id === clienteId && m.texto === texto && m.estado_envio !== 'fallido')) return { status: 'possible_duplicate' }
      const row = { id: db.nextId++, created_at: NOW.toISOString(), barberia_id: TENANT, cliente_id: clienteId, paciente: 'Ana Pérez', texto, de: 'clinica', hora, telefono: '5491122334455', estado_envio: 'pendiente', client_message_id: clientMessageId }
      db.mensajes.push(row)
      return { status: 'reserved', mensaje: { ...row } }
    },
    async complete(tenantId, id, estado) {
      const row = db.mensajes.find((m) => m.id === id && ['pendiente', 'incierto'].includes(m.estado_envio))
      if (!row) return null
      row.estado_envio = estado
      return { ...row }
    },
  }
  const deliver = async (payload) => {
    db.entregas.push(payload)
    if (db.resultado === 'throw') throw new Error('timeout')
    return db.resultado
  }
  const respuestaError = (status, body) => ({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } })

  // Función nueva (handler real).
  const funcionNueva = async (body) => {
    try {
      return { data: await handlePanelSend({ user: { id: 'u' }, body, store, deliver, settings: SETTINGS, now: NOW }), error: null }
    } catch (error) {
      const { status, body: errorBody } = panelSendErrorBody(error)
      return respuestaError(status, errorBody)
    }
  }
  // Función anterior a la tarea 38: ignora `action`, nunca inserta, sólo envía.
  const funcionVieja = async (body) => {
    const texto = typeof body.texto === 'string' ? body.texto.trim() : ''
    if (!texto) return respuestaError(422, { error: { code: 'invalid_text', message: 'El mensaje está vacío o es demasiado largo.' } })
    db.entregas.push({ telefono: '5491122334455', texto, barberia_id: body.tenant_id })
    if (db.resultado !== 'received') return respuestaError(502, { error: { code: 'panel_send_upstream_failed', message: 'El mensaje no se pudo enviar por WhatsApp.' } })
    return { data: { sent: true }, error: null }
  }
  // Inserción desde el navegador (flujo viejo).
  const insertarDesdeNavegador = (texto) => async () => {
    const saved = { id: db.nextId++, created_at: NOW.toISOString(), barberia_id: TENANT, cliente_id: 100, de: 'clinica', texto, estado_envio: 'enviado' }
    db.mensajes.push(saved)
    return { data: { ...saved }, error: null }
  }
  // Frontend viejo (c082d3c): inserta y después llama sin action.
  const frontendViejo = async (invoke, texto) => {
    await insertarDesdeNavegador(texto)()
    return invoke({ tenant_id: TENANT, cliente_id: 100, texto })
  }
  const frontendNuevo = (invoke, texto, extra = {}) => enviarMensajePanel({ invoke, insertarLegacy: insertarDesdeNavegador(texto), tenantId: TENANT, clienteId: 100, texto, hora: '12:00', ...extra })
  return { db, funcionNueva, funcionVieja, frontendViejo, frontendNuevo }
}

describe('compatibilidad frontend/función', () => {
  it('frontend nuevo + función nueva: una fila, un envío', async () => {
    const e = crearEntorno()
    const r = await e.frontendNuevo(e.funcionNueva, 'Hola')
    expect(r).toMatchObject({ resultado: 'enviado', contrato: 2 })
    expect(r.mensaje).toMatchObject({ cliente_id: 100, estado_envio: 'recibido_n8n' })
    expect(e.db.mensajes).toHaveLength(1)
    expect(e.db.entregas).toHaveLength(1)
  })

  it('frontend nuevo + función vieja: detecta el contrato viejo y no pierde ni duplica', async () => {
    const e = crearEntorno()
    const r = await e.frontendNuevo(e.funcionVieja, 'Hola')
    expect(r).toMatchObject({ resultado: 'enviado', contrato: 'legacy' })
    expect(e.db.mensajes).toHaveLength(1)
    expect(e.db.entregas).toHaveLength(1)
    // Con el contrato ya detectado, el siguiente va directo.
    const r2 = await e.frontendNuevo(e.funcionVieja, 'Otro', { contrato: 'legacy' })
    expect(r2.resultado).toBe('enviado')
    expect(e.db.mensajes).toHaveLength(2)
    expect(e.db.entregas).toHaveLength(2)
  })

  it('frontend viejo + función nueva: la función no inserta otra fila', async () => {
    const e = crearEntorno()
    const { data, error } = await e.frontendViejo(e.funcionNueva, 'Hola')
    expect(error).toBeNull()
    expect(data.sent).toBe(true)
    expect(e.db.mensajes).toHaveLength(1)
    expect(e.db.entregas).toHaveLength(1)
  })

  it('frontend viejo + función vieja (línea de base): una fila, un envío', async () => {
    const e = crearEntorno()
    await e.frontendViejo(e.funcionVieja, 'Hola')
    expect(e.db.mensajes).toHaveLength(1)
    expect(e.db.entregas).toHaveLength(1)
  })

  it('contrato 2 detectado y la función vuelve a la vieja (rollback): guarda la fila después del envío', async () => {
    const e = crearEntorno()
    const r = await e.frontendNuevo(e.funcionVieja, 'Hola', { contrato: 2 })
    expect(r).toMatchObject({ resultado: 'enviado', contrato: 'legacy' })
    expect(e.db.mensajes).toHaveLength(1)
    expect(e.db.entregas).toHaveLength(1)
  })

  it('verificar contra la función vieja no envía nada', async () => {
    const e = crearEntorno()
    await expect(verificarChatCliente({ invoke: e.funcionVieja, tenantId: TENANT, clienteId: 100 })).resolves.toEqual({ estado: 'listo', mensaje: '', contrato: 'legacy' })
    expect(e.db.entregas).toHaveLength(0)
    await expect(verificarChatCliente({ invoke: e.funcionNueva, tenantId: TENANT, clienteId: 100 })).resolves.toEqual({ estado: 'listo', mensaje: '', contrato: 2 })
  })
})

describe('resultado incierto y reintentos', () => {
  it('timeout de n8n: queda "incierto", el reintento idéntico pide confirmación y sólo se reenvía si se confirma', async () => {
    const e = crearEntorno()
    e.db.resultado = 'throw'
    const r = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2 })
    expect(r.resultado).toBe('incierto')
    expect(r.mensaje.estado_envio).toBe('incierto')
    expect(e.db.mensajes).toHaveLength(1)
    e.db.resultado = 'received'
    const retry = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2 })
    expect(retry.resultado).toBe('posible_duplicado')
    expect(e.db.entregas).toHaveLength(1)
    const confirmado = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, confirmarReenvio: true })
    expect(confirmado.resultado).toBe('enviado')
    expect(e.db.entregas).toHaveLength(2)
  })

  it('respuesta perdida entre la función y el panel: resultado desconocido y el reintento no sale solo', async () => {
    const e = crearEntorno()
    const perdida = async (body) => { await e.funcionNueva(body); throw new Error('Failed to fetch') }
    const r = await e.frontendNuevo(perdida, 'Hola', { contrato: 2 })
    expect(r).toMatchObject({ resultado: 'desconocido', aviso: AVISO_DESCONOCIDO })
    expect(e.db.entregas).toHaveLength(1)
    const retry = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2 })
    expect(retry.resultado).toBe('posible_duplicado')
    expect(e.db.entregas).toHaveLength(1)
  })

  it('gateway sin JSON (504) se trata como desconocido, no como rechazo', async () => {
    const e = crearEntorno()
    const gateway = async () => ({ data: null, error: { context: new Response('<html>Gateway Timeout</html>', { status: 504 }) } })
    const r = await e.frontendNuevo(gateway, 'Hola', { contrato: 2 })
    expect(r.resultado).toBe('desconocido')
  })

  it('rechazo confirmado: rechazado, sin fila, y el reintento es directo', async () => {
    const e = crearEntorno()
    e.db.resultado = 'rejected'
    const r = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2 })
    expect(r.resultado).toBe('rechazado')
    expect(r.aviso).toMatch(/no salió/)
    expect(e.db.mensajes).toHaveLength(0)
    e.db.resultado = 'received'
    expect((await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2 })).resultado).toBe('enviado')
  })

  it('sin servidor al detectar el contrato: no envía', async () => {
    const e = crearEntorno()
    const caida = async () => { throw new Error('Failed to fetch') }
    const r = await e.frontendNuevo(caida, 'Hola')
    expect(r.resultado).toBe('rechazado')
    expect(r.aviso).toMatch(/no se envió/)
    expect(e.db.entregas).toHaveLength(0)
  })
})

describe('identificador de envío (reserva atómica)', () => {
  it('mismo borrador = mismo identificador; otro texto u otro cliente = otro', () => {
    const claves = new Map()
    const a = claveDeEnvio(claves, 100, 'Hola')
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(claveDeEnvio(claves, 100, 'Hola')).toBe(a)
    expect(claveDeEnvio(claves, 100, 'Hola!')).not.toBe(a)
    expect(claveDeEnvio(claves, 101, 'Hola')).not.toBe(a)
    olvidarClaveDeEnvio(claves, 100, 'Hola')
    expect(claveDeEnvio(claves, 100, 'Hola')).not.toBe(a)
  })

  it('respuesta perdida: el reintento con el mismo identificador devuelve el estado registrado sin reenviar', async () => {
    const e = crearEntorno({ atomic: true })
    const clave = '11111111-1111-4111-8111-111111111111'
    const perdida = async (body) => { await e.funcionNueva(body); throw new Error('Failed to fetch') }
    expect((await e.frontendNuevo(perdida, 'Hola', { contrato: 2, clientMessageId: clave })).resultado).toBe('desconocido')
    const retry = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, clientMessageId: clave })
    expect(retry).toMatchObject({ resultado: 'enviado', aviso: AVISO_YA_ENVIADO })
    expect(retry.mensaje.estado_envio).toBe('recibido_n8n')
    expect(e.db.entregas).toHaveLength(1)
    expect(e.db.mensajes).toHaveLength(1)
  })

  it('incierto con el mismo identificador: el reintento pide confirmación; con confirmación, mismo registro', async () => {
    const e = crearEntorno({ atomic: true })
    const clave = '22222222-2222-4222-8222-222222222222'
    e.db.resultado = 'throw'
    expect((await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, clientMessageId: clave })).resultado).toBe('incierto')
    e.db.resultado = 'received'
    // Revisión independiente: antes devolvía 'incierto' (repetición) y el panel
    // limpiaba el borrador sin ofrecer "Enviar de todos modos": el operador no
    // podía reenviar nunca ese texto a ese cliente en la sesión.
    const retry = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, clientMessageId: clave })
    expect(retry.resultado).toBe('posible_duplicado')
    expect(retry.aviso).toMatch(/sin confirmar/i)
    expect(e.db.entregas).toHaveLength(1)
    const confirmado = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, clientMessageId: clave, confirmarReenvio: true })
    expect(confirmado.resultado).toBe('enviado')
    expect(e.db.mensajes).toHaveLength(1)
    expect(e.db.entregas).toHaveLength(2)
  })

  it('recorrido del operador con las claves por borrador: incierto → reescribe el texto → confirma → un registro, dos intentos', async () => {
    const e = crearEntorno({ atomic: true })
    const claves = new Map()
    const enviar = (extra = {}) => e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, clientMessageId: claveDeEnvio(claves, 100, 'Hola'), ...extra })
    e.db.resultado = 'throw'
    expect((await enviar()).resultado).toBe('incierto')
    e.db.resultado = 'received'
    // El panel conserva el borrador y ofrece "Enviar de todos modos" (confirmable).
    expect((await enviar()).resultado).toBe('posible_duplicado')
    expect(e.db.entregas).toHaveLength(1)
    const confirmado = await enviar({ confirmarReenvio: true })
    expect(confirmado.resultado).toBe('enviado')
    expect(e.db.mensajes).toHaveLength(1)
    expect(e.db.entregas).toHaveLength(2)
  })

  it('una repetición todavía pendiente no se ofrece para reenviar', async () => {
    const e = crearEntorno({ atomic: true })
    const clave = '44444444-4444-4444-8444-444444444444'
    e.db.mensajes.push({ id: 90, created_at: NOW.toISOString(), barberia_id: TENANT, cliente_id: 100, texto: 'Hola', de: 'clinica', estado_envio: 'pendiente', client_message_id: clave })
    const r = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, clientMessageId: clave })
    expect(r.resultado).toBe('incierto')
    expect(e.db.entregas).toHaveLength(0)
  })

  it('la reserva atómica informa que el bot ya quedó pausado', async () => {
    const e = crearEntorno({ atomic: true })
    const r = await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, clientMessageId: '33333333-3333-4333-8333-333333333333' })
    expect(r).toMatchObject({ resultado: 'enviado', botPausado: true })
    const sinMigracion = crearEntorno()
    expect((await sinMigracion.frontendNuevo(sinMigracion.funcionNueva, 'Hola', { contrato: 2 })).botPausado).toBe(false)
  })

  it('conflicto de identificador pide uno nuevo', async () => {
    const e = crearEntorno({ atomic: true })
    const clave = '44444444-4444-4444-8444-444444444444'
    await e.frontendNuevo(e.funcionNueva, 'Hola', { contrato: 2, clientMessageId: clave })
    const r = await e.frontendNuevo(e.funcionNueva, 'Otro', { contrato: 2, clientMessageId: clave })
    expect(r).toMatchObject({ resultado: 'rechazado', reiniciarClave: true })
  })
})
