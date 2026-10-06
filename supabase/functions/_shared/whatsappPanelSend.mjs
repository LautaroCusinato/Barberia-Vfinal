/**
 * Envío manual desde el panel (tarea 38). Módulo puro: la Edge Function
 * `whatsapp-panel-send` le pasa la sesión ya autenticada, el body, los
 * accesos a datos y el reenvío a n8n; las pruebas lo ejercitan con una base
 * en memoria.
 *
 * Todo lo que decide a quién y desde qué negocio se envía sale del servidor:
 *   * el tenant sólo se acepta si el usuario es miembro con rol de envío;
 *   * el plan, la integración WhatsApp, su instancia y la configuración de
 *     pausa se leen del tenant;
 *   * el teléfono es el canónico de la ficha del cliente (nunca del body);
 *   * el límite de envíos y los reintentos dudosos se controlan en la base.
 *
 * Contratos (`contract` en las respuestas):
 *   * 2 (`action: 'preflight' | 'send'`): el servidor guarda el mensaje con su
 *     cliente_id, lo envía y registra el resultado.
 *   * sin `action` (panel anterior a la tarea 38): el navegador ya guardó la
 *     fila; el servidor valida y envía sin insertar otra (no duplica).
 *
 * Resultado del reenvío a n8n (`deliver`):
 *   * `accepted`: n8n lo recibió. Con el webhook actual (responde al recibir)
 *     NO confirma que Evolution lo haya entregado.
 *   * `rejected`: respuesta 4xx; n8n no lo procesó. Se retira la fila y el
 *     panel conserva el borrador: reintentar es seguro.
 *   * `uncertain`: 5xx, 408, timeout o error de red; pudo haber salido. La
 *     fila queda como `incierto` y un reintento idéntico pide confirmación.
 */
import { evaluateBotPause } from './whatsappBotPause.mjs'
import { canonicalArgentineMobile } from './whatsappCustomer.mjs'

export const PANEL_SEND_CONTRACT = 2
export const PANEL_SEND_ROLES = new Set(['owner', 'admin', 'recepcionista', 'barbero', 'empleado'])
export const PANEL_SEND_OPERATIONAL_STATES = new Set(['active', 'trialing', 'past_due'])
export const PANEL_SEND_MAX_TEXT_LENGTH = 4096
// Propuesta pendiente de aprobación del dueño (ver tarea 38).
export const PANEL_SEND_RATE_WINDOW_MS = 60_000
export const PANEL_SEND_RATE_LIMIT = 20
// Un mismo texto al mismo cliente dentro de esta ventana, mientras el anterior
// está pendiente, incierto o enviado, requiere confirmación explícita.
export const PANEL_SEND_DUPLICATE_WINDOW_MS = 5 * 60_000
export const PANEL_SEND_DUPLICATE_STATES = ['pendiente', 'incierto', 'enviado']

const ACTIONS = new Set(['preflight', 'send'])

export class PanelSendError extends Error {
  constructor(message, status, code, extra = undefined) {
    super(message)
    this.status = status
    this.code = code
    this.extra = extra
  }
}

const fail = (message, status, code, extra) => { throw new PanelSendError(message, status, code, extra) }

function positiveInteger(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const normalizedInstance = (value) => String(value ?? '').trim().toLowerCase()

/** Hora visible (HH:MM) del mensaje; es sólo presentación, nunca identidad. */
function displayHour(value, now, timeZone) {
  if (typeof value === 'string' && /^[0-2]\d:[0-5]\d$/.test(value)) return value
  try {
    return new Intl.DateTimeFormat('es-AR', { timeZone: timeZone || 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  } catch {
    return null
  }
}

/**
 * Clasifica la respuesta HTTP del webhook. Sólo un 4xx (salvo 408) prueba que
 * n8n no lo procesó; un 5xx puede venir de un proxy después de recibirlo.
 */
export function classifyWebhookStatus(status) {
  const code = Number(status)
  if (code >= 200 && code < 300) return 'accepted'
  if (code >= 400 && code < 500 && code !== 408) return 'rejected'
  return 'uncertain'
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
 * El webhook de n8n envía siempre por una instancia fija (hoy `miwsp`). Sólo el
 * negocio dueño de esa instancia puede usarlo: cualquier otro saldría desde un
 * número ajeno.
 */
export function senderBlock(integration, senderInstance) {
  const configured = normalizedInstance(senderInstance)
  if (!configured) return { status: 503, code: 'panel_send_not_configured', message: 'El envío por WhatsApp desde el panel no está configurado.' }
  if (normalizedInstance(integration?.external_instance_id) !== configured) {
    return { status: 409, code: 'panel_send_sender_mismatch', message: 'Este negocio todavía no tiene habilitado el envío desde el panel con su propio número de WhatsApp.' }
  }
  return null
}

/**
 * Valida tenant, rol, plan, integración, remitente, pausa y ficha del cliente.
 * Devuelve el contexto resuelto en el servidor o lanza PanelSendError.
 */
export async function resolvePanelSendContext({ user, body, store, senderInstance }) {
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
  const wrongSender = senderBlock(integration, senderInstance)
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

  return { tenantId, clienteId, role: String(membership.role), telefono, nombre: String(cliente.nombre || '').trim() || 'Cliente', botActive: pause.botActive, instance: normalizedInstance(integration.external_instance_id) }
}

async function safeDeliver(deliver, payload) {
  try {
    const outcome = await deliver(payload)
    return outcome === 'accepted' || outcome === 'rejected' ? outcome : 'uncertain'
  } catch {
    return 'uncertain'
  }
}

const rateLimited = () => fail('Se enviaron demasiados mensajes en el último minuto. Esperá un momento e intentá de nuevo.', 429, 'send_rate_limited')

/** Panel anterior a la tarea 38: la fila ya la guardó el navegador. */
async function handleLegacySend({ context, texto, store, deliver, now }) {
  const since = new Date(now.getTime() - PANEL_SEND_RATE_WINDOW_MS).toISOString()
  const recent = await store.countRecentPanelSends(context.tenantId, since).catch(() => fail('No se pudo verificar el límite de envíos.', 502, 'rate_limit_lookup_failed'))
  // Ese conteo ya incluye la fila que guardó el navegador.
  if (Number(recent) > PANEL_SEND_RATE_LIMIT) rateLimited()
  const outcome = await safeDeliver(deliver, { telefono: context.telefono, texto, barberia_id: context.tenantId, instance: context.instance })
  if (outcome === 'accepted') return { sent: true, contract: PANEL_SEND_CONTRACT }
  if (outcome === 'rejected') fail('El mensaje no se pudo enviar por WhatsApp.', 502, 'panel_send_rejected')
  fail('No sabemos si el mensaje llegó. Revisá WhatsApp antes de reenviarlo.', 502, 'panel_send_uncertain')
}

/**
 * Atiende una solicitud ya autenticada. `store` encapsula la base (service
 * role); `deliver` reenvía a n8n y devuelve accepted / rejected / uncertain.
 */
export async function handlePanelSend({ user, body, store, deliver, senderInstance, now = new Date(), timeZone = null }) {
  const legacy = body?.action == null
  const action = legacy ? 'send' : String(body.action)
  if (!ACTIONS.has(action)) fail('Acción inválida.', 422, 'invalid_action')

  // El texto se valida antes de consultar nada: no cuesta lecturas.
  const texto = typeof body?.texto === 'string' ? body.texto.trim() : ''
  if (action === 'send' && (!texto || texto.length > PANEL_SEND_MAX_TEXT_LENGTH)) fail('El mensaje está vacío o es demasiado largo.', 422, 'invalid_text')

  const context = await resolvePanelSendContext({ user, body, store, senderInstance })
  if (action === 'preflight') {
    return { ready: true, contract: PANEL_SEND_CONTRACT, cliente_id: context.clienteId, bot_active: context.botActive }
  }
  if (legacy) return handleLegacySend({ context, texto, store, deliver, now })

  const row = {
    barberia_id: context.tenantId,
    cliente_id: context.clienteId,
    paciente: context.nombre,
    texto,
    de: 'clinica',
    hora: displayHour(body?.hora, now, timeZone),
    leido: true,
    telefono: context.telefono,
    enviado_wsp: false,
    estado_envio: 'pendiente',
  }
  // Sin registro en el panel no se envía: el cliente recibiría un mensaje que
  // nadie del equipo puede ver.
  const saved = await store.insertMensaje(row).catch(() => fail('No se pudo guardar el mensaje.', 502, 'message_insert_failed'))
  if (!saved?.id) fail('No se pudo guardar el mensaje.', 502, 'message_insert_failed')
  const discard = () => store.deleteMensaje(context.tenantId, saved.id).catch(() => null)

  // Los controles que dependen de otros envíos se hacen después de guardar,
  // ordenados por id: dos solicitudes simultáneas no pueden pasar ambas.
  try {
    const duplicateSince = new Date(now.getTime() - PANEL_SEND_DUPLICATE_WINDOW_MS).toISOString()
    if (body?.confirm_resend !== true) {
      const earlier = await store.countEarlierSameText({ tenantId: context.tenantId, clienteId: context.clienteId, texto, since: duplicateSince, beforeId: saved.id, states: PANEL_SEND_DUPLICATE_STATES })
      if (Number(earlier) > 0) {
        await discard()
        fail('Este mismo mensaje se envió o quedó sin confirmar hace instantes. Revisá WhatsApp: si no llegó, confirmá el reenvío.', 409, 'panel_send_possible_duplicate')
      }
    }
    const rateSince = new Date(now.getTime() - PANEL_SEND_RATE_WINDOW_MS).toISOString()
    const rank = await store.countPanelSendsThrough(context.tenantId, rateSince, saved.id)
    if (Number(rank) > PANEL_SEND_RATE_LIMIT) {
      await discard()
      rateLimited()
    }
  } catch (error) {
    if (error instanceof PanelSendError) throw error
    await discard()
    fail('No se pudo verificar el límite de envíos.', 502, 'rate_limit_lookup_failed')
  }

  const outcome = await safeDeliver(deliver, { telefono: context.telefono, texto, barberia_id: context.tenantId, instance: context.instance })
  if (outcome === 'rejected') {
    // Confirmado: n8n no lo procesó. Se retira la fila (o, si no se puede, se
    // marca como fallida) y el panel conserva el borrador.
    const removed = await store.deleteMensaje(context.tenantId, saved.id).then(() => true, () => false)
    if (!removed) await store.updateMensaje(context.tenantId, saved.id, { estado_envio: 'fallido' }).catch(() => null)
    fail('WhatsApp rechazó el envío. El mensaje no salió y el borrador quedó guardado para reintentar.', 502, 'panel_send_rejected')
  }
  if (outcome === 'uncertain') {
    // Pudo haber salido: se conserva la evidencia y no se ofrece un reintento
    // que parezca seguro.
    const marked = await store.updateMensaje(context.tenantId, saved.id, { estado_envio: 'incierto' }).catch(() => null)
    return { sent: false, uncertain: true, contract: PANEL_SEND_CONTRACT, bot_active: context.botActive, mensaje: { ...saved, ...(marked || { estado_envio: 'incierto' }) } }
  }

  const sent = await store.updateMensaje(context.tenantId, saved.id, { enviado_wsp: true, estado_envio: 'enviado' }).catch(() => null)
  return { sent: true, contract: PANEL_SEND_CONTRACT, bot_active: context.botActive, mensaje: { ...saved, ...(sent || { enviado_wsp: true, estado_envio: 'enviado' }) } }
}

/** Respuesta de error sin detalles internos. */
export function panelSendErrorBody(error) {
  if (error instanceof PanelSendError) return { status: error.status, body: { error: { code: error.code, message: error.message }, contract: PANEL_SEND_CONTRACT } }
  const status = Number(error?.status) || 500
  const code = String(error?.code || 'panel_send_error').replace(/[^a-z0-9_:-]/gi, '').slice(0, 80)
  const message = status >= 500 ? 'No se pudo enviar el mensaje.' : String(error?.message || 'Solicitud inválida.').slice(0, 240)
  return { status, body: { error: { code, message }, contract: PANEL_SEND_CONTRACT } }
}
