const INVALID_LINK_PATTERN = /otp|expired|expir|invalid|inv[aá]lid|access_denied|already.?used|reus|token/i
const RATE_LIMIT_PATTERN = /rate.?limit|too many|demasiad|frecuencia|espera/i

export function sanitizeAuthError(error, fallback = 'No pudimos completar la operación. Intentá nuevamente.') {
  const raw = `${error?.code || ''} ${error?.message || ''}`.trim()
  if (!raw) return fallback
  if (RATE_LIMIT_PATTERN.test(raw)) return 'Esperá unos minutos antes de volver a solicitarlo.'
  if (INVALID_LINK_PATTERN.test(raw)) return 'Este enlace de confirmación ya no es válido.'
  if (/already|confirmad/i.test(raw)) return 'Tu email ya estaba confirmado.'
  return fallback
}

export function authErrorKind(error) {
  const raw = `${error?.code || ''} ${error?.message || ''}`
  if (RATE_LIMIT_PATTERN.test(raw)) return 'rate_limit'
  if (INVALID_LINK_PATTERN.test(raw)) return 'invalid_link'
  if (/already|confirmad/i.test(raw)) return 'already_confirmed'
  return 'generic'
}
