// Contrato común para los adaptadores de billing. Este módulo se ejecuta en
// backend/worker, nunca en el bundle Vite del navegador.

export const BILLING_STATES = Object.freeze([
  'trialing', 'active', 'past_due', 'grace_period', 'suspended',
  'canceled', 'incomplete', 'payment_review', 'refunded', 'paused', 'expired',
])

export const BILLING_PROVIDERS = Object.freeze(['mercadopago', 'paypal'])

export class BillingNotConfiguredError extends Error {
  constructor(provider, missing) {
    super(`${provider} sandbox no está configurado: faltan variables privadas.`)
    this.name = 'BillingNotConfiguredError'
    this.provider = provider
    this.missing = missing
  }
}

export class BillingProviderError extends Error {
  constructor(provider, message, status = 502) {
    super(message)
    this.name = 'BillingProviderError'
    this.provider = provider
    this.status = status
  }
}

export function requireEnv(env, provider, names) {
  const missing = names.filter((name) => !String(env?.[name] || '').trim())
  if (missing.length) throw new BillingNotConfiguredError(provider, missing)
}

export function normalizeProviderStatus(provider, status) {
  const value = String(status || '').toLowerCase()
  if (provider === 'mercadopago') {
    return ({ authorized: 'active', active: 'active', approved: 'active', pending: 'payment_review', paused: 'paused', cancelled: 'canceled', canceled: 'canceled', rejected: 'past_due', overdue: 'past_due' })[value] || 'payment_review'
  }
  return ({ active: 'active', approved: 'active', suspended: 'suspended', cancelled: 'canceled', canceled: 'canceled', approval_pending: 'incomplete', failed: 'past_due', expired: 'expired' })[value] || 'payment_review'
}

export function assertAdapter(adapter) {
  const methods = ['createCustomer', 'createCheckout', 'getSubscription', 'cancelSubscription', 'reactivateSubscription', 'verifyWebhook']
  for (const method of methods) {
    if (typeof adapter?.[method] !== 'function') throw new TypeError(`Adaptador incompleto: falta ${method}`)
  }
  return adapter
}
