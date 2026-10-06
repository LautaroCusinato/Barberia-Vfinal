// Envío manual desde el panel (tarea 38) contra la Edge Function
// whatsapp-panel-send. El módulo no conoce Supabase: recibe `invoke` (llama a
// la función con un body) e `insertarLegacy` (guarda la fila desde el navegador,
// sólo para la función anterior a la tarea 38).
//
// Contratos:
//   * 2: la función guarda el mensaje con su cliente_id, lo envía y responde
//     enviado / incierto / error con código. Es el camino normal.
//   * 'legacy': función anterior (no conoce `action`). Se usa el flujo viejo:
//     el navegador guarda la fila y la función sólo envía. Así, publicar el
//     frontend antes que la función no pierde ni duplica mensajes.
//
// Resultados de enviarMensajePanel:
//   * enviado: n8n lo aceptó (`mensaje` es la fila guardada).
//   * incierto: pudo haber salido; la fila queda visible como "Sin confirmar".
//   * rechazado: confirmado que no salió; el borrador se conserva. Con
//     `intentado` (WhatsApp lo rechazó) el bot queda pausado igual.
//   * posible_duplicado: el mismo texto se envió o quedó incierto hace poco;
//     sólo se reenvía con confirmación explícita.
//   * desconocido: se perdió la respuesta; no se sabe si salió. El borrador se
//     conserva y el reintento usa el mismo identificador de envío: el servidor
//     responde con el estado registrado en lugar de enviar otra vez.
//
// `clientMessageId` identifica el envío (uno por borrador). Con la migración
// 20261005120000 el servidor lo usa para que reintentar nunca duplique.
import { leerErrorFuncion } from './conversaciones.js'

export const CONTRATO_ENVIO = 2

const SIN_VERIFICAR = 'No pudimos verificar si se puede escribir a este cliente. Podés redactar el mensaje e intentar enviarlo.'
const SIN_SERVIDOR = 'No pudimos comunicarnos con el servidor. El mensaje no se envió y el borrador quedó guardado.'
export const AVISO_INCIERTO = 'WhatsApp no confirmó el envío: puede haber llegado. Revisá WhatsApp antes de reenviarlo.'
// Confirmación manual de un reenvío: nunca se reenvía solo, y quien confirma
// tiene que saber que el anterior pudo haber llegado.
export const AVISO_CONFIRMAR_REENVIO = 'Este mismo mensaje se envió o quedó sin confirmar hace poco y podría haber llegado. Revisá WhatsApp antes de reenviarlo: si lo reenviás, el cliente puede recibirlo dos veces.'
export const AVISO_YA_ENVIADO = 'Este mensaje ya se había enviado: no se volvió a enviar.'
export const AVISO_DESCONOCIDO = 'No sabemos si el mensaje se envió (se perdió la respuesta). Revisá el hilo y WhatsApp antes de reintentar: si reenviás el mismo texto te vamos a pedir confirmación.'

/**
 * Identificador de envío por cliente y texto: reintentar el mismo borrador
 * reutiliza el mismo identificador; cambiar el texto usa uno nuevo.
 */
export function claveDeEnvio(claves, clienteId, texto) {
  const clave = JSON.stringify([clienteId, texto])
  if (!claves.has(clave)) {
    const id = globalThis.crypto?.randomUUID?.()
    if (!id) return null
    claves.set(clave, id)
  }
  return claves.get(clave)
}

export function olvidarClaveDeEnvio(claves, clienteId, texto) {
  claves.delete(JSON.stringify([clienteId, texto]))
}

/**
 * Valida sin enviar (Iniciar chat). Devuelve el estado para el compositor y
 * el contrato detectado de la función.
 */
export async function verificarChatCliente({ invoke, tenantId, clienteId }) {
  let respuesta
  try {
    respuesta = await invoke({ action: 'preflight', tenant_id: tenantId, cliente_id: clienteId })
  } catch {
    return { estado: 'bloqueado', mensaje: SIN_VERIFICAR, contrato: null }
  }
  const { data, error } = respuesta || {}
  if (!error) {
    if (data?.contract === CONTRATO_ENVIO && data?.ready) return { estado: 'listo', mensaje: '', contrato: CONTRATO_ENVIO }
    return { estado: 'bloqueado', mensaje: SIN_VERIFICAR, contrato: null }
  }
  const detalle = await leerErrorFuncion(error, SIN_VERIFICAR)
  if (detalle.contract === CONTRATO_ENVIO) return { estado: 'bloqueado', mensaje: detalle.message, contrato: CONTRATO_ENVIO }
  // La función anterior valida primero el texto: un preflight sin texto le
  // devuelve invalid_text sin haber enviado nada. No valida antes de enviar.
  if (detalle.code === 'invalid_text') return { estado: 'listo', mensaje: '', contrato: 'legacy' }
  return { estado: 'bloqueado', mensaje: detalle.respondio ? detalle.message : SIN_VERIFICAR, contrato: null }
}

async function enviarLegacy({ invoke, insertarLegacy, tenantId, clienteId, texto }) {
  let fila
  try {
    const { data, error } = await insertarLegacy()
    if (error || !data) return { resultado: 'rechazado', aviso: 'No se pudo guardar el mensaje. El borrador quedó guardado.', contrato: 'legacy' }
    fila = data
  } catch {
    return { resultado: 'rechazado', aviso: 'No se pudo guardar el mensaje. El borrador quedó guardado.', contrato: 'legacy' }
  }
  // Mismo contrato que antes de la tarea 38: sin `action`, la función sólo envía.
  try {
    const { error } = await invoke({ tenant_id: tenantId, cliente_id: clienteId, texto })
    if (!error) return { resultado: 'enviado', mensaje: fila, contrato: 'legacy' }
  } catch {
    // Igual que un error: la fila ya está guardada y no se sabe si salió.
  }
  return { resultado: 'incierto', mensaje: fila, aviso: 'El mensaje quedó guardado pero no pudimos confirmar el envío por WhatsApp. Revisá WhatsApp antes de reenviarlo.', contrato: 'legacy' }
}

export async function enviarMensajePanel({ invoke, insertarLegacy, contrato = null, tenantId, clienteId, texto, hora, confirmarReenvio = false, clientMessageId = null }) {
  let actual = contrato
  if (actual == null) {
    // Contrato desconocido (primer envío de la sesión): se pregunta sin enviar.
    const verificacion = await verificarChatCliente({ invoke, tenantId, clienteId })
    actual = verificacion.contrato
    if (actual == null) return { resultado: 'rechazado', aviso: verificacion.mensaje === SIN_VERIFICAR ? SIN_SERVIDOR : verificacion.mensaje, contrato: null }
    if (verificacion.estado === 'bloqueado') return { resultado: 'rechazado', aviso: verificacion.mensaje, contrato: actual }
  }
  if (actual === 'legacy') return enviarLegacy({ invoke, insertarLegacy, tenantId, clienteId, texto })

  let respuesta
  try {
    respuesta = await invoke({ action: 'send', tenant_id: tenantId, cliente_id: clienteId, texto, hora, ...(clientMessageId ? { client_message_id: clientMessageId } : {}), ...(confirmarReenvio ? { confirm_resend: true } : {}) })
  } catch {
    return { resultado: 'desconocido', aviso: AVISO_DESCONOCIDO, contrato: actual, intentado: true, botPausado: false }
  }
  const { data, error } = respuesta || {}
  if (!error) {
    if (data?.sent === true && data?.contract !== CONTRATO_ENVIO) {
      // La función volvió a la versión anterior (p. ej. un rollback): envió
      // pero no guardó la fila. Se guarda como en el flujo viejo.
      try {
        const { data: fila, error: errorFila } = await insertarLegacy()
        if (!errorFila && fila) return { resultado: 'enviado', mensaje: fila, contrato: 'legacy' }
      } catch {
        // Sigue abajo.
      }
      return { resultado: 'incierto', mensaje: null, aviso: 'El mensaje se envió pero no se pudo guardar en el panel.', contrato: 'legacy' }
    }
    // Repetición: el mismo identificador ya estaba registrado; no se reenvió.
    if (data?.replay === true) {
      if (data.sent === true) return { resultado: 'enviado', mensaje: data.mensaje ?? null, aviso: AVISO_YA_ENVIADO, contrato: CONTRATO_ENVIO, botPausado: false }
      // Quedó sin confirmar: el servidor sólo lo reenvía con confirmación
      // explícita sobre el mismo registro. Se conserva el borrador y se ofrece
      // "Enviar de todos modos" (si no, ese texto no podría reenviarse nunca).
      if (data.estado_envio === 'incierto' && !confirmarReenvio) return { resultado: 'posible_duplicado', aviso: AVISO_CONFIRMAR_REENVIO, contrato: CONTRATO_ENVIO }
      // `pendiente`: otro intento todavía está en curso; no se ofrece reenviar.
      return { resultado: 'incierto', mensaje: data.mensaje ?? null, aviso: AVISO_INCIERTO, contrato: CONTRATO_ENVIO, botPausado: false }
    }
    const botPausado = data?.bot_paused === true
    if (data?.sent === true) return { resultado: 'enviado', mensaje: data.mensaje ?? null, contrato: CONTRATO_ENVIO, botPausado }
    if (data?.uncertain === true) return { resultado: 'incierto', mensaje: data.mensaje ?? null, aviso: AVISO_INCIERTO, contrato: CONTRATO_ENVIO, botPausado }
    return { resultado: 'desconocido', aviso: AVISO_DESCONOCIDO, contrato: actual, intentado: true, botPausado: false }
  }
  const detalle = await leerErrorFuncion(error, AVISO_DESCONOCIDO)
  // Sin error propio de la función (red, gateway, timeout) o error interno
  // inesperado: no se puede afirmar que no salió.
  if (!detalle.respondio || detalle.code === 'panel_send_error' || detalle.code === 'panel_send_uncertain') {
    return { resultado: 'desconocido', aviso: detalle.respondio ? AVISO_DESCONOCIDO : detalle.message, contrato: actual, intentado: true, botPausado: false }
  }
  if (detalle.code === 'panel_send_possible_duplicate') return { resultado: 'posible_duplicado', aviso: AVISO_CONFIRMAR_REENVIO, contrato: CONTRATO_ENVIO }
  // Rechazo del proveedor después de intentar el envío: el operador ya tomó la
  // conversación, así que el bot queda pausado igual (el servidor informa si
  // ya lo hizo). Un bloqueo previo (límite, teléfono, conexión) no pausa.
  if (detalle.code === 'panel_send_rejected') return { resultado: 'rechazado', aviso: detalle.message, contrato: CONTRATO_ENVIO, intentado: true, botPausado: detalle.botPausado === true }
  // El identificador quedó asociado a otro texto: el próximo intento usa uno nuevo.
  if (detalle.code === 'idempotency_conflict') return { resultado: 'rechazado', aviso: detalle.message, contrato: CONTRATO_ENVIO, reiniciarClave: true }
  return { resultado: 'rechazado', aviso: detalle.message, contrato: detalle.contract === CONTRATO_ENVIO ? CONTRATO_ENVIO : actual }
}
