/**
 * Identidad de cliente para reservas por WhatsApp (tarea 35). Módulo puro.
 *
 * Criterio: dentro de un negocio, el cliente es la fila de `clientes` con el
 * mismo teléfono canónico (549 + área + número, 13 dígitos), igual que la
 * reserva web (`crear_reserva_publica`) y la restricción única
 * (barberia_id, telefono). Negocios distintos nunca comparten la fila.
 */

const textFrom = (value) => String(value ?? '').trim()
const MAX_NAME_LENGTH = 60

/**
 * Teléfono canónico desde un número o JID de WhatsApp de un celular argentino.
 * Acepta `549XXXXXXXXXX` y el formato sin el 9 (`54XXXXXXXXXX`), que se
 * completa igual que hace el formulario web con su prefijo fijo "+54 9".
 * Un JID que no es de teléfono (`@lid`, grupos, broadcast) no es un teléfono:
 * devuelve null y el llamador decide sin inventar uno.
 */
export function canonicalArgentineMobile(value) {
  const raw = textFrom(value).toLowerCase()
  if (!raw) return null
  const withoutJid = raw.replace(/@s\.whatsapp\.net$/, '')
  if (withoutJid.includes('@')) return null
  const digits = withoutJid.replace(/\D/g, '')
  if (/^549[1-9]\d{9}$/.test(digits)) return digits
  if (/^54[1-9]\d{9}$/.test(digits)) return `549${digits.slice(2)}`
  return null
}

const NAME_PREFIX = /^(?:hola[\s,]+)?(?:soy|me llamo|mi nombre es|a nombre de|est[aá] a nombre de|ponelo a nombre de|anotalo a nombre de|es)\s+/i
const NOT_A_NAME = /\b(si|no|dale|ok|okay|confirmo|confirmar|turno|reserva|reservar|hora|horario|manana|hoy|link|enlace|web|chat|aca|precio|cuanto|servicio)\b/

function folded(value) {
  return textFrom(value).toLocaleLowerCase('es-AR').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Extrae un nombre plausible de la respuesta a "¿A nombre de quién dejo el
 * turno?". Es un dato que informa el cliente (no verificado): sólo se usa para
 * crear un cliente nuevo, nunca para reemplazar el nombre de uno existente.
 */
export function extractCustomerName(text) {
  const cleaned = textFrom(text)
    .replace(/[\r\n]+/g, ' ')
    .replace(NAME_PREFIX, '')
    .replace(/[.!¡¿?,;:]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length < 2 || cleaned.length > MAX_NAME_LENGTH) return null
  if (!/^[\p{L}][\p{L}' .-]*$/u.test(cleaned)) return null
  const words = cleaned.split(' ').filter(Boolean)
  if (words.length > 5) return null
  if (NOT_A_NAME.test(folded(cleaned))) return null
  return cleaned
}

export function isValidCustomerName(value) {
  const name = textFrom(value)
  return Boolean(name) && extractCustomerName(name) === name
}

/**
 * Decide con qué datos se reserva. `existing` es la fila del mismo negocio y
 * teléfono canónico (o null). Un cliente existente conserva su nombre y email:
 * lo escrito en el chat no los reemplaza. Un cliente nuevo necesita el nombre
 * que confirmó en la conversación; no hay nombre de reemplazo.
 */
export function resolveBookingCustomer({ existing = null, conversationName = null, preferConversationName = false } = {}) {
  const name = isValidCustomerName(conversationName) ? textFrom(conversationName) : null
  if (existing && typeof existing === 'object') {
    const storedName = textFrom(existing.nombre)
    if (storedName) return { status: 'existing', nombre: preferConversationName && name ? name : storedName, email: textFrom(existing.email) || null }
    if (!name) return { status: 'name_required', nombre: null, email: null }
    return { status: 'existing', nombre: name, email: textFrom(existing.email) || null }
  }
  if (!name) return { status: 'name_required', nombre: null, email: null }
  return { status: 'new', nombre: name, email: null }
}
