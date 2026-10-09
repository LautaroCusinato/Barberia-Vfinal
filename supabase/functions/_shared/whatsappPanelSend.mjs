/**
 * Envío manual desde el panel (tarea 38). Módulo puro: la Edge Function
 * `whatsapp-panel-send` le pasa la sesión ya autenticada, el body, los
 * accesos a datos, el reenvío a n8n y la configuración del servidor; las
 * pruebas lo ejercitan con una base en memoria (y las RPC, en PostgreSQL local:
 * scripts/sql/whatsapp-panel-send/run.sh).
 *
 * Autoridad: el tenant sólo se acepta si el usuario es miembro con rol de
 * envío; plan, integración, instancia remitente, pausa y teléfono canónico se
 * resuelven en el servidor. Del navegador sólo se toman el cliente, el texto y
 * el identificador del envío (`client_message_id`).
 *
 * Contratos (`contract` en las respuestas):
 *   * 2 (`action: 'preflight' | 'send'`): la reserva atómica
 *     (`reservar_envio_panel`) guarda el mensaje con su identificador, aplica
 *     idempotencia, texto repetido y límite bajo un lock por negocio, y pausa
 *     el bot antes del envío. Sin la migración, se usa el camino por tablas de
 *     7fba130 (no atómico; el panel pausa el bot como antes).
 *   * sin `action` (panel anterior a la tarea 38): el navegador ya guardó la
 *     fila; el servidor valida y envía sin insertar otra.
 *
 * Evidencia del envío (`estado_envio`), sin inventar entregas:
 *   * recibido_n8n: n8n confirmó la recepción (plantilla que responde al
 *     recibir). No prueba que Evolution lo haya aceptado.
 *   * aceptado: la plantilla nueva respondió después de Evolution con
 *     `result: 'accepted'` (y el id del mensaje en Evolution).
 *   * entregado: reservado; sólo con evidencia de entrega del proveedor. Este
 *     módulo nunca lo escribe.
 *   * fallido: rechazo confirmado (4xx o `result: 'rejected'`).
 *   * incierto: 5xx, 408, timeout, error de red o `result: 'uncertain'`.
 */
import { evaluateBotPause } from './whatsappBotPause.mjs'
import { canonicalArgentineMobile } from './whatsappCustomer.mjs'

export const PANEL_SEND_CONTRACT = 2
export const PANEL_SEND_ROLES = new Set(['owner', 'admin', 'recepcionista', 'barbero', 'empleado'])
export const PANEL_SEND_OPERATIONAL_STATES = new Set(['active', 'trialing', 'past_due'])
export const PANEL_SEND_MAX_TEXT_LENGTH = 4096
// Valores PROPUESTOS, pendientes de decisión del dueño. Se configuran con
// variables del servidor (ver panelSendSettings); no son reglas comerciales.
export const PANEL_SEND_PROPOSED_SETTINGS = Object.freeze({
  rateLimit: 20,
  rateWindowSeconds: 60,
  duplicateWindowSeconds: 300,
  stalePendingSeconds: 120,
})
export const PANEL_SEND_DUPLICATE_STATES = ['enviado', 'pendiente', 'recibido_n8n', 'aceptado', 'entregado', 'incierto']
const SENT_STATES = new Set(['enviado', 'recibido_n8n', 'aceptado', 'entregado'])
const OUTCOME_STATE = { accepted: 'aceptado', received: 'recibido_n8n', rejected: 'fallido', uncertain: 'incierto' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const ACTIONS = new Set(['preflight', 'send'])

export class PanelSendError extends Error {
  constructor(message, status, code, extra = null) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

const fail = (message, status, code, extra = null) => { throw new PanelSendError(message, status, code, extra) }

function positiveInteger(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const normalizedInstance = (value) => String(value ?? '').trim().toLowerCase()

/**
 * Configuración del servidor. Las variables ausentes toman los valores
 * propuestos; un valor presente pero inválido deja el envío sin configurar
 * (falla cerrada) en lugar de usar un límite inesperado.
 */
export function panelSendSettings(env = {}) {
  const read = (name, fallback, min, max) => {
    const raw = env[name]
    if (raw == null || String(raw).trim() === '') return fallback
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < min || value > max) return null
    return value
  }
  const routingRaw = String(env.WHATSAPP_PANEL_SEND_ROUTING ?? '').trim().toLowerCase() || 'fixed'
  const settings = {
    routing: ['fixed', 'instance'].includes(routingRaw) ? routingRaw : null,
    senderInstance: normalizedInstance(env.WHATSAPP_PANEL_SEND_INSTANCE),
    rateLimit: read('WHATSAPP_PANEL_SEND_RATE_LIMIT', PANEL_SEND_PROPOSED_SETTINGS.rateLimit, 1, 1000),
    rateWindowSeconds: read('WHATSAPP_PANEL_SEND_RATE_WINDOW_SECONDS', PANEL_SEND_PROPOSED_SETTINGS.rateWindowSeconds, 1, 86_400),
    duplicateWindowSeconds: read('WHATSAPP_PANEL_SEND_DUPLICATE_WINDOW_SECONDS', PANEL_SEND_PROPOSED_SETTINGS.duplicateWindowSeconds, 0, 86_400),
    stalePendingSeconds: read('WHATSAPP_PANEL_SEND_STALE_PENDING_SECONDS', PANEL_SEND_PROPOSED_SETTINGS.stalePendingSeconds, 30, 86_400),
  }
  settings.valid = Object.values(settings).every((value) => value !== null)
  return settings
}

/** Hora visible (HH:MM) del mensaje; es sólo presentación, nunca identidad. */
function displayHour(value, now, timeZone) {
  if (typeof value === 'string' && /^[0-2]\d:[0-5]\d$/.test(value)) return value
  try {
    return new Intl.DateTimeFormat('es-AR', { timeZone: timeZone || 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  } catch {
    return null
  }
}

/** Clasificación sólo por código HTTP (plantillas que no informan `result`). */
export function classifyWebhookStatus(status) {
  const code = Number(status)
  if (code >= 200 && code < 300) return 'accepted'
  if (code >= 400 && code < 500 && code !== 408) return 'rejected'
  return 'uncertain'
}

/**
 * Clasifica la respuesta del webhook. La plantilla nueva informa `result`
 * después de consultar a Evolution; la anterior responde al recibir, así que
 * un 2xx sin `result` sólo prueba la recepción en n8n.
 */
export function classifyWebhookResponse(status, payload) {
  const result = payload && typeof payload === 'object' ? payload.result : null
  const code = Number(status)
  if (result === 'accepted' && code >= 200 && code < 300) {
    const id = typeof payload.message_id === 'string' ? payload.message_id.trim().slice(0, 200) : ''
    return { outcome: 'accepted', providerMessageId: id || null }
  }
  if (result === 'rejected') return { outcome: 'rejected', providerMessageId: null }
  if (result === 'uncertain') return { outcome: 'uncertain', providerMessageId: null }
  const byStatus = classifyWebhookStatus(code)
  return { outcome: byStatus === 'accepted' ? 'received' : byStatus, providerMessageId: null }
}

/**
 * Estado de la integración Evolution del tenant. Sólo `conectado` permite
 * enviar; `desactivado` es una conexión pausada por el negocio o la plataforma.
 */
export function integrationBlock(integration) {
  if (!integration) return { code: 'whatsapp_not_configured', message: 'WhatsApp no está conectado para este negocio. Conectalo desde Configuración.' }
  const estado = String(integration.estado || '').toLowerCase()
  if (estado === 'conectado') return null
  if (estado === 'desactivado') return { code: 'whatsapp_paused', message: 'WhatsApp está pausado para este negocio. Reactivalo desde Configuración para enviar mensajes.' }
  return { code: 'whatsapp_disconnected', message: 'WhatsApp está desconectado. Revisá la conexión en Configuración antes de enviar.' }
}

/**
 * Remitente. `fixed`: la plantilla anterior envía siempre por una instancia
 * (hoy `miwsp`) y sólo el negocio dueño de esa instancia puede usarla.
 * `instance`: la plantilla nueva envía por la instancia del negocio, que el
 * servidor resuelve y n8n vuelve a verificar contra Supabase.
 */
export function senderBlock(integration, settings) {
  const instance = normalizedInstance(integration?.external_instance_id)
  if (!settings?.valid) return { status: 503, code: 'panel_send_not_configured', message: 'El envío por WhatsApp desde el panel no está configurado.' }
  if (settings.routing === 'fixed') {
    if (!settings.senderInstance) return { status: 503, code: 'panel_send_not_configured', message: 'El envío por WhatsApp desde el panel no está configurado.' }
    if (instance !== settings.senderInstance) {
      return { status: 409, code: 'panel_send_sender_mismatch', message: 'Este negocio todavía no tiene habilitado el envío desde el panel con su propio número de WhatsApp.' }
    }
    return null
  }
  if (!/^[a-z0-9._-]{1,200}$/.test(instance)) {
    return { status: 409, code: 'panel_send_sender_mismatch', message: 'Este negocio todavía no tiene un número de WhatsApp habilitado para enviar desde el panel.' }
  }
  return null
}

/**
 * Valida tenant, rol, plan, integración, remitente, pausa y ficha del cliente.
 * Devuelve el contexto resuelto en el servidor o lanza PanelSendError.
 */
export async function resolvePanelSendContext({ user, body, store, settings }) {
  if (!user?.id) fail('Autenticación requerida.', 401, 'auth_required')
  const tenantId = positiveInteger(body?.tenant_id)
  const clienteId = positiveInteger(body?.cliente_id)
  if (!tenantId || !clienteId) fail('Faltan el negocio o el cliente.', 422, 'invalid_target')

  const membership = await store.membership(tenantId, user.id).catch(() => fail('No se pudo verificar el acceso.', 502, 'membership_lookup_failed'))
  if (!membership) fail('No tenés acceso a este negocio.', 403, 'tenant_membership_required')
  // Un miembro de sólo lectura no puede escribir mensajes (RLS) y tampoco
  // debe poder enviar WhatsApp desde el número del negocio.
  if (!PANEL_SEND_ROLES.has(String(membership.role))) fail('Tu rol no puede enviar mensajes.', 403, 'send_role_required')

  // Igual que las políticas de escritura: un tenant con el plan vencido o
  // suspendido no puede usar el número del negocio desde el panel.
  const accessState = await store.accessState(tenantId).catch(() => fail('No se pudo verificar el estado de la cuenta.', 502, 'access_state_failed'))
  if (!PANEL_SEND_OPERATIONAL_STATES.has(String(accessState))) fail('La cuenta no tiene un plan habilitado para enviar mensajes. Revisá Facturación.', 402, 'subscription_inactive')

  const integration = await store.integration(tenantId).catch(() => fail('No se pudo verificar la conexión de WhatsApp.', 502, 'integration_lookup_failed'))
  const blocked = integrationBlock(integration)
  if (blocked) fail(blocked.message, 409, blocked.code)
  const wrongSender = senderBlock(integration, settings)
  if (wrongSender) fail(wrongSender.message, wrongSender.status, wrongSender.code)

  // La pausa por atención humana no impide responder a mano: es justamente el
  // traspaso a una persona. Una configuración ambigua o de otro negocio sí se
  // trata como falla (no se sabe quién está atendiendo).
  let pause
  try {
    pause = evaluateBotPause(await store.botConfig(tenantId), tenantId)
  } catch {
    fail('No se pudo verificar la pausa del bot.', 502, 'bot_pause_lookup_failed')
  }

  const cliente = await store.cliente(tenantId, clienteId).catch(() => fail('No se pudo leer la ficha del cliente.', 502, 'customer_lookup_failed'))
  // Un cliente de otro negocio se ve igual que uno inexistente.
  if (!cliente || Number(cliente.barberia_id) !== tenantId || Number(cliente.id) !== clienteId) fail('El cliente no existe en este negocio.', 404, 'customer_not_found')
  if (!String(cliente.telefono || '').trim()) fail('Este cliente no tiene un teléfono cargado en su ficha.', 422, 'customer_phone_missing')
  const telefono = canonicalArgentineMobile(cliente.telefono)
  if (!telefono) fail('El teléfono de la ficha no es un celular válido para WhatsApp. Corregilo en la ficha del cliente.', 422, 'customer_phone_invalid')
  if (Array.isArray(settings.allowedRecipients) && !settings.allowedRecipients.includes(telefono)) fail('Esta prueba de WhatsApp sólo permite los teléfonos propios habilitados.', 403, 'qa_recipient_not_allowed')

  return { tenantId, clienteId, role: String(membership.role), telefono, nombre: String(cliente.nombre || '').trim() || 'Cliente', botActive: pause.botActive, instance: normalizedInstance(integration.external_instance_id) }
}

async function safeDeliver(deliver, payload) {
  try {
    const result = await deliver(payload)
    const outcome = typeof result === 'string' ? result : result?.outcome
    if (['accepted', 'received', 'rejected', 'uncertain'].includes(outcome)) return { outcome, providerMessageId: result?.providerMessageId ?? null }
  } catch {
    // Error de red o timeout después de que n8n pudo recibirlo.
  }
  return { outcome: 'uncertain', providerMessageId: null }
}

const rateLimited = () => fail('Se enviaron demasiados mensajes en el último minuto. Esperá un momento e intentá de nuevo.', 429, 'send_rate_limited')
const possibleDuplicate = () => fail('Este mismo mensaje se envió o quedó sin confirmar hace poco y podría haber llegado. Revisá WhatsApp antes de reenviarlo: si lo reenviás, el cliente puede recibirlo dos veces.', 409, 'panel_send_possible_duplicate')

/** Panel anterior a la tarea 38: la fila ya la guardó el navegador. */
async function handleLegacySend({ context, texto, store, deliver, now, settings }) {
  const since = new Date(now.getTime() - settings.rateWindowSeconds * 1000).toISOString()
  const recent = await store.countRecentPanelSends(context.tenantId, since).catch(() => fail('No se pudo verificar el límite de envíos.', 502, 'rate_limit_lookup_failed'))
  // Ese conteo ya incluye la fila que guardó el navegador.
  if (Number(recent) > settings.rateLimit) rateLimited()
  const { outcome } = await safeDeliver(deliver, { telefono: context.telefono, texto, barberia_id: context.tenantId, instance: context.instance })
  if (outcome === 'accepted' || outcome === 'received') return { sent: true, contract: PANEL_SEND_CONTRACT }
  if (outcome === 'rejected') fail('El mensaje no se pudo enviar por WhatsApp.', 502, 'panel_send_rejected')
  fail('No sabemos si el mensaje llegó. Revisá WhatsApp antes de reenviarlo.', 502, 'panel_send_uncertain')
}

/**
 * Reserva sin la migración (camino de 7fba130): guarda y después controla
 * por orden de id. No es atómica entre sesiones de la base y no tiene
 * identificador de envío; se conserva sólo para publicar la función antes que
 * la migración.
 */
async function reserveWithTables({ context, texto, body, store, now, settings, hora }) {
  const row = {
    barberia_id: context.tenantId,
    cliente_id: context.clienteId,
    paciente: context.nombre,
    texto,
    de: 'clinica',
    hora,
    leido: true,
    telefono: context.telefono,
    enviado_wsp: false,
    estado_envio: 'pendiente',
  }
  const saved = await store.insertMensaje(row).catch(() => fail('No se pudo guardar el mensaje.', 502, 'message_insert_failed'))
  if (!saved?.id) fail('No se pudo guardar el mensaje.', 502, 'message_insert_failed')
  const discard = () => store.deleteMensaje(context.tenantId, saved.id).catch(() => null)
  try {
    if (body?.confirm_resend !== true && settings.duplicateWindowSeconds > 0) {
      const since = new Date(now.getTime() - settings.duplicateWindowSeconds * 1000).toISOString()
      const earlier = await store.countEarlierSameText({ tenantId: context.tenantId, clienteId: context.clienteId, texto, since, beforeId: saved.id, states: PANEL_SEND_DUPLICATE_STATES })
      if (Number(earlier) > 0) {
        await discard()
        return { status: 'possible_duplicate' }
      }
    }
    const rateSince = new Date(now.getTime() - settings.rateWindowSeconds * 1000).toISOString()
    const rank = await store.countPanelSendsThrough(context.tenantId, rateSince, saved.id)
    if (Number(rank) > settings.rateLimit) {
      await discard()
      return { status: 'rate_limited' }
    }
  } catch {
    await discard()
    fail('No se pudo verificar el límite de envíos.', 502, 'rate_limit_lookup_failed')
  }
  return { status: 'reserved', mensaje: saved, atomic: false }
}

/** Respuesta para un envío ya registrado (mismo identificador). */
function replayResponse(mensaje) {
  const estado = String(mensaje?.estado_envio || '')
  return {
    replay: true,
    sent: SENT_STATES.has(estado),
    uncertain: !SENT_STATES.has(estado),
    estado_envio: estado,
    contract: PANEL_SEND_CONTRACT,
    mensaje,
  }
}

/**
 * Atiende una solicitud ya autenticada. `store` encapsula la base (service
 * role); `deliver` reenvía a n8n y devuelve { outcome, providerMessageId }.
 */
export async function handlePanelSend({ user, body, store, deliver, settings, now = new Date(), timeZone = null }) {
  const legacy = body?.action == null
  const action = legacy ? 'send' : String(body.action)
  if (!ACTIONS.has(action)) fail('Acción inválida.', 422, 'invalid_action')

  // El texto se valida antes de consultar nada: no cuesta lecturas.
  const texto = typeof body?.texto === 'string' ? body.texto.trim() : ''
  if (action === 'send' && (!texto || texto.length > PANEL_SEND_MAX_TEXT_LENGTH)) fail('El mensaje está vacío o es demasiado largo.', 422, 'invalid_text')
  const clientMessageId = body?.client_message_id == null ? null : String(body.client_message_id)
  if (clientMessageId !== null && !UUID.test(clientMessageId)) fail('El identificador del envío no es válido.', 422, 'invalid_client_message_id')

  const context = await resolvePanelSendContext({ user, body, store, settings })
  if (action === 'preflight') {
    return { ready: true, contract: PANEL_SEND_CONTRACT, cliente_id: context.clienteId, bot_active: context.botActive }
  }
  if (legacy) return handleLegacySend({ context, texto, store, deliver, now, settings })

  const hora = displayHour(body?.hora, now, timeZone)
  // Reserva atómica en la base. `null` = la migración todavía no está aplicada.
  let reservation = await store.reserve({
    tenantId: context.tenantId,
    clienteId: context.clienteId,
    clientMessageId: clientMessageId || globalThis.crypto.randomUUID(),
    texto,
    hora,
    confirmResend: body?.confirm_resend === true,
    expectedPhone: context.telefono,
    settings,
  }).catch(() => fail('No se pudo guardar el mensaje.', 502, 'message_insert_failed'))
  if (reservation == null) reservation = await reserveWithTables({ context, texto, body, store, now, settings, hora })

  switch (reservation.status) {
    case 'reserved': break
    case 'replay': return replayResponse(reservation.mensaje)
    case 'possible_duplicate': possibleDuplicate(); break
    case 'rate_limited': rateLimited(); break
    case 'customer_not_found': fail('El cliente no existe en este negocio.', 404, 'customer_not_found'); break
    case 'customer_phone_invalid': fail('El teléfono de la ficha no es un celular válido para WhatsApp. Corregilo en la ficha del cliente.', 422, 'customer_phone_invalid'); break
    case 'idempotency_conflict': fail('Ese identificador ya se usó para otro mensaje. Volvé a escribirlo.', 409, 'idempotency_conflict'); break
    case 'qa_recipient_not_allowed': fail('El teléfono cambió y no está entre los teléfonos propios habilitados para esta prueba.', 403, 'qa_recipient_not_allowed'); break
    case 'qa_manual_not_authorized': fail('Este negocio no está habilitado para la prueba manual de WhatsApp.', 403, 'qa_manual_not_authorized'); break
    case 'qa_manual_send_not_ready': fail('Falta preparar el guardado seguro de mensajes de esta prueba. El mensaje no salió.', 503, 'qa_manual_send_not_ready'); break
    default: fail('No se pudo guardar el mensaje.', 502, 'message_insert_failed')
  }
  const saved = reservation.mensaje
  const atomic = reservation.atomic !== false
  // El teléfono de la fila lo resolvió la base desde la ficha; se usa el mismo.
  const telefono = atomic ? String(saved.telefono || context.telefono) : context.telefono

  // La RPC releyó la ficha: un cambio concurrente puede devolver otro
  // teléfono. La restricción QA también se verifica sobre el destino final,
  // después de reservar y antes de cualquier llamada al proveedor.
  if ((Array.isArray(settings.allowedRecipients) && !settings.allowedRecipients.includes(telefono))
    || (settings.requireRecipientMatch === true && telefono !== context.telefono)) {
    const failed = atomic
      ? await store.complete(context.tenantId, saved.id, 'fallido', null).catch(() => null)
      : await store.updateMensaje(context.tenantId, saved.id, { estado_envio: 'fallido', enviado_wsp: false }).catch(() => null)
    if (!failed) fail('El destino cambió y se bloqueó el envío. No se llamó a WhatsApp; no se pudo actualizar su registro.', 502, 'qa_recipient_block_record_failed', { bot_paused: atomic })
    fail('El teléfono cambió durante el guardado y quedó fuera de los teléfonos propios permitidos. El mensaje no salió.', 403, 'qa_recipient_not_allowed', { bot_paused: atomic })
  }

  const { outcome, providerMessageId } = await safeDeliver(deliver, { telefono, texto, barberia_id: context.tenantId, instance: context.instance, client_message_id: saved.client_message_id ?? null })
  const estado = OUTCOME_STATE[outcome]

  if (outcome === 'rejected') {
    if (atomic) {
      // Confirmado: no salió. La fila queda `fallido` y el mismo identificador
      // puede reintentarse sobre ella.
      await store.complete(context.tenantId, saved.id, estado, null).catch(() => null)
    } else {
      const removed = await store.deleteMensaje(context.tenantId, saved.id).then(() => true, () => false)
      if (!removed) await store.updateMensaje(context.tenantId, saved.id, { estado_envio: 'fallido' }).catch(() => null)
    }
    // Se intentó enviar: el operador ya tomó la conversación y el bot queda
    // pausado aunque WhatsApp lo rechace (decisión del dueño, 05/10). Con la
    // reserva atómica la base ya lo pausó; si no, lo pausa el panel.
    fail('WhatsApp rechazó el envío. El mensaje no salió y el borrador quedó guardado para reintentar.', 502, 'panel_send_rejected', { bot_paused: atomic })
  }

  const patch = { estado_envio: estado, enviado_wsp: outcome !== 'uncertain', ...(providerMessageId ? { whatsapp_id: providerMessageId } : {}) }
  const completed = atomic
    ? await store.complete(context.tenantId, saved.id, estado, providerMessageId).catch(() => null)
    : await store.updateMensaje(context.tenantId, saved.id, patch).catch(() => null)
  const mensaje = { ...saved, ...(completed || patch) }
  return {
    sent: outcome !== 'uncertain',
    uncertain: outcome === 'uncertain',
    estado_envio: mensaje.estado_envio,
    contract: PANEL_SEND_CONTRACT,
    bot_active: context.botActive,
    // Con la reserva atómica la base ya pausó el bot antes del envío.
    bot_paused: atomic,
    mensaje,
  }
}

/** Respuesta de error sin detalles internos. */
export function panelSendErrorBody(error) {
  if (error instanceof PanelSendError) return { status: error.status, body: { error: { code: error.code, message: error.message }, contract: PANEL_SEND_CONTRACT, ...(error.extra || {}) } }
  const status = Number(error?.status) || 500
  const code = String(error?.code || 'panel_send_error').replace(/[^a-z0-9_:-]/gi, '').slice(0, 80)
  const message = status >= 500 ? 'No se pudo enviar el mensaje.' : String(error?.message || 'Solicitud inválida.').slice(0, 240)
  return { status, body: { error: { code, message }, contract: PANEL_SEND_CONTRACT } }
}
