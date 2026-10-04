/**
 * Ruta QA Evolution -> Supabase -> n8n para la prueba integral (tarea 36).
 * El webhook de Supabase procesa y persiste el mensaje; después avisa a un
 * workflow n8n QA, que envía la respuesta, guarda la reserva confirmada y
 * manda la confirmación por WhatsApp llamando a las funciones existentes.
 *
 * La ruta sólo se activa para una lista explícita de tenants QA y durante una
 * ventana corta (WHATSAPP_QA_BOOKING_ROUTE_EXPIRES_AT). Sin configuración
 * válida no se reenvía nada.
 */
export const QA_BOOKING_ROUTE_URL = 'https://n8n.cuchitron.lat/webhook/austral-qa-booking-route'
export const QA_BOOKING_ROUTE_TENANTS_ENV = 'WHATSAPP_QA_BOOKING_ROUTE_TENANT_IDS'
export const QA_BOOKING_ROUTE_EXPIRES_ENV = 'WHATSAPP_QA_BOOKING_ROUTE_EXPIRES_AT'
export const QA_BOOKING_ROUTE_MAX_WINDOW_MS = 4 * 60 * 60 * 1000
export const PROTECTED_WHATSAPP_INSTANCE = 'miwsp'

const textFrom = (value) => String(value ?? '').trim()

export function parseTenantIdList(value) {
  const ids = textFrom(value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{1,12}$/.test(item))
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  return Object.freeze([...new Set(ids)])
}

export function qaInstanceForTenant(tenantId) {
  const id = Number(tenantId)
  return Number.isSafeInteger(id) && id > 0 ? `austral-qa-tenant-${id}` : null
}

/** Ventana ISO exacta, futura y de como máximo 4 h. */
export function isQaBookingRouteWindowOpen(expiresAt, now = Date.now()) {
  const value = textFrom(expiresAt)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false
  const remaining = Date.parse(value) - Number(now)
  return Number.isFinite(remaining) && remaining > 0 && remaining <= QA_BOOKING_ROUTE_MAX_WINDOW_MS
}

export function isQaBookingRouteEnabled({ tenantId, instance, tenantList, expiresAt, now = Date.now() } = {}) {
  const id = Number(tenantId)
  const allowed = parseTenantIdList(tenantList)
  if (!allowed.includes(id)) return false
  if (textFrom(instance) !== qaInstanceForTenant(id) || textFrom(instance) === PROTECTED_WHATSAPP_INSTANCE) return false
  return isQaBookingRouteWindowOpen(expiresAt, now)
}

export function buildQaBookingRouteBody({ eventId, tenantId, integrationId, instance, readyForBookingMutation } = {}) {
  return {
    event_id: textFrom(eventId).slice(0, 200),
    tenant_id: Number(tenantId),
    integration_id: Number(integrationId),
    instance: textFrom(instance),
    ready_for_booking_mutation: readyForBookingMutation === true,
  }
}
