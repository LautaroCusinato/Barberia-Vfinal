import { classifyBillingFailure } from './runtimeStability.js'

// Presentación de Facturación. Nada de este módulo decide acceso, precios ni
// estados: sólo traduce lo que devuelve billing-api a textos y tonos de UI.

const SESSION_CODES = new Set(['auth_required', 'invalid_session', 'session_expired'])
const FORBIDDEN_CODES = new Set(['owner_required', 'platform_admin_required', 'forbidden'])

/**
 * Clasifica un fallo al consultar Facturación para elegir el mensaje y la
 * acción de recuperación. La ausencia de suscripción conserva la regla de
 * `classifyBillingFailure`: es un estado comercial, no un error técnico.
 */
export function classifyBillingLoadFailure(error) {
  if (classifyBillingFailure(error).kind === 'subscription_missing') return 'subscription_missing'
  const status = Number(error?.status)
  const code = String(error?.code || '')
  if (SESSION_CODES.has(code) || status === 401) return 'session'
  if (FORBIDDEN_CODES.has(code) || status === 403) return 'forbidden'
  if (code === 'tenant_selection_required') return 'tenant_selection'
  // fetch rechaza con TypeError cuando no hay red o la función no responde.
  if (error instanceof TypeError || code === 'network_error') return 'network'
  return 'technical'
}

export const LOAD_FAILURE_COPY = Object.freeze({
  session: {
    title: 'Tu sesión expiró',
    description: 'Volvé a iniciar sesión para ver la facturación de tu negocio.',
  },
  forbidden: {
    title: 'No tenés permiso para ver la facturación',
    description: 'Sólo la persona dueña del negocio puede ver el plan y los pagos. Pedile que revise esta sección.',
  },
  tenant_selection: {
    title: 'Tu usuario administra más de un negocio',
    description: 'No pudimos saber de qué negocio mostrar la facturación. Escribinos al equipo de Austral para resolverlo.',
  },
  network: {
    title: 'No pudimos conectarnos',
    description: 'Revisá tu conexión a internet e intentá nuevamente.',
  },
  technical: {
    title: 'No pudimos consultar la facturación',
    description: 'El servicio no respondió. Intentá nuevamente en unos segundos.',
  },
})

/** Fallos en los que reintentar no cambia el resultado sin otra acción. */
export function failureAllowsRetry(kind) {
  return kind === 'network' || kind === 'technical'
}

const STATUS_TONES = {
  trialing: 'info',
  active: 'success',
  past_due: 'warning',
  grace_period: 'warning',
  payment_review: 'warning',
  incomplete: 'warning',
  suspended: 'danger',
  canceled: 'danger',
  refunded: 'danger',
  expired: 'danger',
  paused: 'neutral',
}

export function billingStatusTone(estado) {
  return STATUS_TONES[estado] || 'neutral'
}

const PAYMENT_TONES = {
  approved: 'success', authorized: 'success', paid: 'success', completed: 'success', accredited: 'success',
  pending: 'warning', in_process: 'warning', in_mediation: 'warning', open: 'warning', draft: 'neutral',
  rejected: 'danger', cancelled: 'danger', canceled: 'danger', refunded: 'neutral', charged_back: 'danger',
  void: 'neutral', failed: 'danger', expired: 'danger',
}

export function paymentStatusTone(value) {
  return PAYMENT_TONES[String(value || '').toLowerCase()] || 'neutral'
}

/** Fecha legible; devuelve '—' ante valores vacíos o inválidos en vez de lanzar. */
export function formatBillingDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium' }).format(date)
}

export function formatBillingTime(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(date)
}
