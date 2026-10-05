/**
 * Envío manual desde el panel (tarea 38). Módulo puro: la Edge Function
 * `whatsapp-panel-send` le pasa la sesión ya autenticada, el body y los
 * accesos a datos; las pruebas lo ejercitan con una base en memoria.
 *
 * Todo lo que decide a quién y desde qué negocio se envía sale del servidor:
 *   * el tenant sólo se acepta si el usuario es miembro con rol de envío;
 *   * el plan, la integración WhatsApp y la configuración de pausa se leen
 *     del tenant;
 *   * el teléfono es el canónico de la ficha del cliente (nunca del body);
 *   * el límite de envíos se cuenta en la base, no en el navegador.
 *
 * `preflight` valida sin escribir ni enviar (lo usa "Iniciar chat").
 * `send` guarda el mensaje con su `cliente_id`, lo envía y, si el envío
 * falla, borra la fila para que el panel conserve el borrador sin dejar un
 * mensaje que el cliente nunca recibió.
 */
import { evaluateBotPause } from './whatsappBotPause.mjs'
import { canonicalArgentineMobile } from './whatsappCustomer.mjs'

export const PANEL_SEND_ROLES = new Set(['owner', 'admin', 'recepcionista', 'barbero', 'empleado'])
export const PANEL_SEND_OPERATIONAL_STATES = new Set(['active', 'trialing', 'past_due'])
export const PANEL_SEND_MAX_TEXT_LENGTH = 4096
export const PANEL_SEND_RATE_WINDOW_MS = 60_000
export const PANEL_SEND_RATE_LIMIT = 20

const ACTIONS = new Set(['preflight', 'send'])

export class PanelSendError extends Error {
  constructor(message, status, code) {
    super(message)
    this.status = status
    this.code = code
  }
}

const fail = (message, status, code) => { throw new PanelSendError(message, status, code) }

function positiveInteger(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
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
 * Valida tenant, rol, plan, integración, pausa y ficha del cliente.
 * Devuelve el contexto resuelto en el servidor o lanza PanelSendError.
 */
export async function resolvePanelSendContext({ user, body, store }) {
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

  // La pausa por atención humana no impide responder a mano (para eso existe),
  // pero una configuración ambigua o de otro negocio se trata como falla.
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

  return { tenantId, clienteId, role: String(membership.role), telefono, nombre: String(cliente.nombre || '').trim() || 'Cliente', botActive: pause.botActive }
}

/**
 * Atiende una solicitud ya autenticada. `store` encapsula la base (service
 * role) y `deliver` el reenvío a n8n con el secreto del servidor.
 */
export async function handlePanelSend({ user, body, store, deliver, now = new Date(), timeZone = null }) {
  const action = body?.action == null ? 'send' : String(body.action)
  if (!ACTIONS.has(action)) fail('Acción inválida.', 422, 'invalid_action')

  // El texto se valida antes de consultar nada: no cuesta lecturas.
  const texto = typeof body?.texto === 'string' ? body.texto.trim() : ''
  if (action === 'send' && (!texto || texto.length > PANEL_SEND_MAX_TEXT_LENGTH)) fail('El mensaje está vacío o es demasiado largo.', 422, 'invalid_text')

  const context = await resolvePanelSendContext({ user, body, store })
  if (action === 'preflight') {
    return { ready: true, cliente_id: context.clienteId, bot_active: context.botActive }
  }

  const since = new Date(now.getTime() - PANEL_SEND_RATE_WINDOW_MS).toISOString()
  const recent = await store.countRecentPanelSends(context.tenantId, since).catch(() => fail('No se pudo verificar el límite de envíos.', 502, 'rate_limit_lookup_failed'))
  if (Number(recent) >= PANEL_SEND_RATE_LIMIT) fail('Se enviaron demasiados mensajes en el último minuto. Esperá un momento e intentá de nuevo.', 429, 'send_rate_limited')

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

  let delivered = false
  try {
    delivered = await deliver({ telefono: context.telefono, texto, barberia_id: context.tenantId })
  } catch {
    delivered = false
  }
  if (!delivered) {
    // El cliente no lo recibió: se retira la fila para que el borrador quede
    // en el panel y un reintento no muestre el mensaje dos veces.
    await store.deleteMensaje(context.tenantId, saved.id).catch(() => null)
    fail('El mensaje no se pudo enviar por WhatsApp. El borrador quedó guardado para reintentar.', 502, 'panel_send_upstream_failed')
  }

  const sent = await store.markMensajeSent(context.tenantId, saved.id).catch(() => null)
  return { sent: true, bot_active: context.botActive, mensaje: { ...saved, ...(sent || { enviado_wsp: true, estado_envio: 'enviado' }) } }
}

/** Respuesta de error sin detalles internos. */
export function panelSendErrorBody(error) {
  if (error instanceof PanelSendError) return { status: error.status, body: { error: { code: error.code, message: error.message } } }
  const status = Number(error?.status) || 500
  const code = String(error?.code || 'panel_send_error').replace(/[^a-z0-9_:-]/gi, '').slice(0, 80)
  const message = status >= 500 ? 'No se pudo enviar el mensaje.' : String(error?.message || 'Solicitud inválida.').slice(0, 240)
  return { status, body: { error: { code, message } } }
}
