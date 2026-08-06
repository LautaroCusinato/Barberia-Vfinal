import { BillingProviderError, assertAdapter, normalizeProviderStatus, requireEnv } from '../contract.mjs'

const REQUIRED = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID']

async function jsonResponse(response, provider) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new BillingProviderError(provider, body?.message || `Respuesta HTTP ${response.status}`, response.status)
  return body
}

export function createPayPalAdapter(env = {}, fetchImpl = globalThis.fetch) {
  const apiBase = String(env.PAYPAL_API_BASE_URL || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '')
  const configured = () => requireEnv(env, 'PayPal', REQUIRED)
  const token = async () => {
    configured()
    const basic = globalThis.btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`)
    const response = await fetchImpl(`${apiBase}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
    const body = await jsonResponse(response, 'PayPal')
    return body.access_token
  }
  const request = async (path, options = {}) => {
    const accessToken = await token()
    const response = await fetchImpl(`${apiBase}${path}`, { ...options, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) } })
    return jsonResponse(response, 'PayPal')
  }

  return assertAdapter({
    provider: 'paypal',
    environment: 'sandbox',
    async createCustomer(input) { return { email: input.email, external_reference: input.tenantId } },
    async createCheckout(input) {
      return request('/v2/checkout/orders', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ intent: 'CAPTURE', purchase_units: [{ reference_id: input.tenantId, amount: { currency_code: input.currency, value: Number(input.amount).toFixed(2) } }], application_context: { return_url: input.returnUrls?.success, cancel_url: input.returnUrls?.cancel } }) })
    },
    async getSubscription(externalId) { return request(`/v1/billing/subscriptions/${encodeURIComponent(externalId)}`) },
    async cancelSubscription(externalId) { return request(`/v1/billing/subscriptions/${encodeURIComponent(externalId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Canceled by account owner' }) }) },
    async reactivateSubscription(externalId) { return request(`/v1/billing/subscriptions/${encodeURIComponent(externalId)}/activate`, { method: 'POST', body: JSON.stringify({ reason: 'Reactivated by account owner' }) }) },
    normalizeStatus(status) { return normalizeProviderStatus('paypal', status) },
    async verifyWebhook({ payload, headers: incoming = {} }) {
      configured()
      const required = ['paypal-transmission-id', 'paypal-transmission-time', 'paypal-cert-url', 'paypal-auth-algo', 'paypal-transmission-sig']
      if (required.some((key) => !incoming[key])) return false
      const accessToken = await token()
      const response = await fetchImpl(`${apiBase}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_algo: incoming['paypal-auth-algo'], cert_url: incoming['paypal-cert-url'], transmission_id: incoming['paypal-transmission-id'], transmission_sig: incoming['paypal-transmission-sig'], transmission_time: incoming['paypal-transmission-time'], webhook_event: payload, webhook_id: env.PAYPAL_WEBHOOK_ID }) })
      const body = await jsonResponse(response, 'PayPal')
      return body.verification_status === 'SUCCESS'
    },
  })
}
