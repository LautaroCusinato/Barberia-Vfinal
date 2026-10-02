import { describe, expect, it } from 'vitest'
import { authErrorKind, sanitizeAuthError } from './authErrors.js'

const FALLBACK = 'No pudimos completar la operación. Intentá nuevamente.'

describe('sanitizeAuthError', () => {
  it('usa el fallback sin error', () => {
    expect(sanitizeAuthError(null)).toBe(FALLBACK)
    expect(sanitizeAuthError({})).toBe(FALLBACK)
    expect(sanitizeAuthError(undefined, 'Otro texto')).toBe('Otro texto')
  })

  it.each([
    [{ code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' }, 'Esperá unos minutos antes de volver a solicitarlo.'],
    [{ message: 'Too many requests' }, 'Esperá unos minutos antes de volver a solicitarlo.'],
    [{ code: 'otp_expired', message: 'Email link is invalid or has expired' }, 'Este enlace de confirmación ya no es válido.'],
    [{ message: 'Token has already been used' }, 'Este enlace de confirmación ya no es válido.'],
    [{ code: 'access_denied' }, 'Este enlace de confirmación ya no es válido.'],
    [{ message: 'Email already confirmed' }, 'Tu email ya estaba confirmado.'],
  ])('traduce %j', (error, expected) => {
    expect(sanitizeAuthError(error)).toBe(expected)
  })

  it('el rate limit tiene prioridad sobre un token inválido', () => {
    expect(sanitizeAuthError({ code: 'over_request_rate_limit', message: 'token' })).toBe('Esperá unos minutos antes de volver a solicitarlo.')
  })

  it('nunca muestra el mensaje técnico crudo', () => {
    const tecnico = { message: 'duplicate key value violates unique constraint "users_pkey"' }
    expect(sanitizeAuthError(tecnico)).toBe(FALLBACK)
  })
})

describe('authErrorKind', () => {
  it('clasifica el error para la UI', () => {
    expect(authErrorKind({ message: 'rate limit' })).toBe('rate_limit')
    expect(authErrorKind({ code: 'otp_expired' })).toBe('invalid_link')
    expect(authErrorKind({ message: 'Email already confirmed' })).toBe('already_confirmed')
    expect(authErrorKind({ message: 'Network down' })).toBe('generic')
    expect(authErrorKind(null)).toBe('generic')
  })
})
