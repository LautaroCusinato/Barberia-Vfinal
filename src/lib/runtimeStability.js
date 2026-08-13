const REVALIDATION_INTERVAL_MS = 30_000

export function isSubscriptionMissingError(error) {
  return error?.code === 'subscription_missing'
    || (Number(error?.status) === 409 && /no tiene una suscripci[oó]n|no hay una suscripci[oó]n/i.test(String(error?.message || '')))
}

export function classifyBillingFailure(error) {
  if (isSubscriptionMissingError(error)) return { kind: 'subscription_missing', technical: false }
  return { kind: 'technical_error', technical: true }
}

export function shouldRevalidateInBackground({ now = Date.now(), lastRevalidatedAt = 0 } = {}) {
  return now - Number(lastRevalidatedAt || 0) >= REVALIDATION_INTERVAL_MS
}

export const RUNTIME_REVALIDATION_INTERVAL_MS = REVALIDATION_INTERVAL_MS
