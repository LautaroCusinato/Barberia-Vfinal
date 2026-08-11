import { timingSafeEqual } from 'node:crypto'

export const WEBHOOK_HEADER_NAME = 'x-austral-webhook-secret'
const MAX_SECRET_BYTES = 256

/**
 * Compare two non-empty strings without using a short-circuit string equality.
 * A fixed-size buffer keeps the comparison work independent from the input
 * lengths. Length equality is checked only after the constant-time operation.
 */
export const constantTimeEqual = (actual, expected) => {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false

  const actualBytes = Buffer.from(actual, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  const actualPadded = Buffer.alloc(MAX_SECRET_BYTES)
  const expectedPadded = Buffer.alloc(MAX_SECRET_BYTES)

  actualBytes.copy(actualPadded, 0, 0, MAX_SECRET_BYTES)
  expectedBytes.copy(expectedPadded, 0, 0, MAX_SECRET_BYTES)

  const equalBytes = timingSafeEqual(actualPadded, expectedPadded)
  return equalBytes && actualBytes.length === expectedBytes.length && actualBytes.length > 0
}

/**
 * Authenticate an Evolution webhook before parsing tenant, AI or backend data.
 * The result is deliberately sanitized and contains no secret material.
 */
export const authorizeWebhookSecret = ({ headerValue, expectedSecret } = {}) => {
  if (typeof expectedSecret !== 'string' || expectedSecret.trim().length === 0) {
    return { ok: false, status: 401, reason: 'secret_unconfigured' }
  }

  if (typeof headerValue !== 'string' || headerValue.trim().length === 0) {
    return { ok: false, status: 401, reason: 'secret_missing' }
  }

  if (!constantTimeEqual(headerValue, expectedSecret)) {
    return { ok: false, status: 401, reason: 'secret_invalid' }
  }

  return { ok: true, status: 200, reason: 'authorized' }
}

export const expectedWebhookSecretFromEnv = (env = process.env) => env.EVOLUTION_WEBHOOK_SECRET ?? ''
