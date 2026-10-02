const SALES_NUMBER = String(import.meta.env?.VITE_SALES_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '')

export function normalizeCommercialBillingMode(value) {
  return String(value || 'manual').trim().toLowerCase() === 'automatic' ? 'automatic' : 'manual'
}

// Launch mode is intentionally manual and reversible. Automatic billing
// remains implemented server-side for a later approved phase, but is not
// exposed by the current commercial experience.
export const COMMERCIAL_BILLING_MODE = normalizeCommercialBillingMode(import.meta.env?.VITE_COMMERCIAL_BILLING_MODE)
export const COMMERCIAL_TRIAL_DAYS = 15
// Keep the legacy code for the existing subscription/RPC contract while
// exposing a single, product-level commercial name to customers.
export const COMMERCIAL_PLAN_CODE = 'starter'
export const COMMERCIAL_PLAN_NAME = 'Austral'
export const COMMERCIAL_MONTHLY_PRICE = 50000
export const TRIAL_CONTINUATION_MESSAGE = 'Hola! Terminé mi prueba de 15 días de Austral y quiero seguir usando el software. ¿Cómo puedo continuar?'

// Catálogo comercial vigente mientras Mercado Pago permanece pausado. Este
// archivo es la única fuente de precios para superficies públicas y fallback;
// no habilita checkout ni sustituye el catálogo/guard del backend.
export const COMMERCIAL_CATALOG = Object.freeze([
  Object.freeze({ codigo: COMMERCIAL_PLAN_CODE, nombre: COMMERCIAL_PLAN_NAME, descripcion: 'Agenda, clientes y reservas online para ordenar la operación.', precio_mensual: COMMERCIAL_MONTHLY_PRICE, moneda: 'ARS', periodicidad: 'monthly', trial_dias: COMMERCIAL_TRIAL_DAYS, funcionalidades: ['Agenda y reservas públicas', 'Clientes, servicios y horarios', `Prueba gratuita de ${COMMERCIAL_TRIAL_DAYS} días`] }),
])

export function getSalesWhatsAppMessage(plan = null) {
  const selected = plan ? catalogPlan(plan.codigo) : COMMERCIAL_CATALOG[0]
  return `Hola! Quiero conocer ${selected.nombre}: ${selected.trial_dias} días gratis y luego $${Number(selected.precio_mensual).toLocaleString('es-AR')} mensuales.`
}

export function getSalesWhatsAppHref(plan = null) {
  if (!SALES_NUMBER) return ''
  return `https://wa.me/${SALES_NUMBER}?text=${encodeURIComponent(getSalesWhatsAppMessage(plan))}`
}

export function getTrialContinuationWhatsAppMessage() {
  return TRIAL_CONTINUATION_MESSAGE
}

export function buildWhatsAppHref(number, message) {
  const sanitizedNumber = String(number || '').replace(/[^0-9]/g, '')
  if (!sanitizedNumber || !message) return ''
  return `https://wa.me/${sanitizedNumber}?text=${encodeURIComponent(message)}`
}

export function getTrialContinuationWhatsAppHref() {
  return buildWhatsAppHref(SALES_NUMBER, TRIAL_CONTINUATION_MESSAGE)
}

export function catalogPlan(code) {
  return COMMERCIAL_CATALOG.find((plan) => plan.codigo === code) || COMMERCIAL_CATALOG[0]
}
