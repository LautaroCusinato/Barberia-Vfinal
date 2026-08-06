import { BillingProviderError, assertAdapter, normalizeProviderStatus, requireEnv } from '../contract.mjs'

const REQUIRED = ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET']

async function jsonResponse(response, provider) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new BillingProviderError(provider, body?.message || `Respuesta HTTP ${response.status}`, response.status)
  return body
}

export function createMercadoPagoAdapter(env = {}, fetchImpl = globalThis.fetch) {
  const apiBase = String(env.MERCADOPAGO_API_BASE_URL || 'https://api.mercadopago.com').replace(/\/$/, '')
  const headers = () => ({ Authorization: `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`, 'Content-Type': 'application/json' })
  const configured = () => requireEnv(env, 'Mercado Pago', REQUIRED)
  const request = async (path, options = {}) => {
    configured()
    if (typeof fetchImpl !== 'function') throw new BillingProviderError('Mercado Pago', 'fetch no está disponible', 500)
    return jsonResponse(await fetchImpl(`${apiBase}${path}`, { ...options, headers: { ...headers(), ...(options.headers || {}) } }), 'Mercado Pago')
  }

  return assertAdapter({
    provider: 'mercadopago',
    environment: 'sandbox',
    async createCustomer(input) {
      return request('/v1/customers', { method: 'POST', body: JSON.stringify({ email: input.email, description: input.description || undefined, external_reference: input.tenantId }) })
    },
    async createCheckout(input) {
      // Mercado Pago Preferences son un checkout de una sola compra. Para
      // suscripciones recurrentes el backend debe reemplazar este método por
      // Preapproval y conservar el mismo contrato interno.
      return request('/checkout/preferences', { method: 'POST', body: JSON.stringify({ external_reference: input.tenantId, items: [{ title: input.planName, quantity: 1, unit_price: Number(input.amount), currency_id: input.currency }], back_urls: input.returnUrls, auto_return: 'approved', notification_url: input.webhookUrl }) })
    },
    async getSubscription(externalId) { return request(`/preapproval/${encodeURIComponent(externalId)}`) },
    async cancelSubscription(externalId) { return request(`/preapproval/${encodeURIComponent(externalId)}`, { method: 'PUT', body: JSON.stringify({ status: 'cancelled' }) }) },
    async reactivateSubscription(externalId) { return request(`/preapproval/${encodeURIComponent(externalId)}`, { method: 'PUT', body: JSON.stringify({ status: 'authorized' }) }) },
    normalizeStatus(status) { return normalizeProviderStatus('mercadopago', status) },
    async verifyWebhook({ payload, headers: incoming = {} }) {
      configured()
      const signature = incoming['x-signature']
      const requestId = incoming['x-request-id'] || ''
      const notificationId = payload?.data?.id || payload?.id || ''
      if (!signature || !requestId || !notificationId) return false
      const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=').map((value) => value.trim())))
      if (!parts.ts || !parts.v1) return false
      // Firma oficial de Mercado Pago: id + request-id + timestamp.
      const manifest = `id:${notificationId};request-id:${requestId};ts:${parts.ts};`
      const data = new TextEncoder().encode(manifest)
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.MERCADOPAGO_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const digest = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, data))).map((byte) => byte.toString(16).padStart(2, '0')).join('')
      return digest === parts.v1
    },
  })
}
