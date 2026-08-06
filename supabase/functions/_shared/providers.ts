export type ProviderCode = 'mercadopago' | 'paypal'

export class ProviderNotConfigured extends Error {
  status = 503
  code = 'provider_not_configured'
  constructor(provider: string, missing: string[]) { super(`${provider} sandbox no está configurado.`); this.provider = provider; this.missing = missing }
  provider: string
  missing: string[]
}

export class ProviderError extends Error {
  constructor(message: string, public status = 502, public code = 'provider_error') { super(message) }
}

function requireEnv(provider: string, names: string[]) {
  const missing = names.filter((name) => !String(Deno.env.get(name) || '').trim())
  if (missing.length) throw new ProviderNotConfigured(provider, missing)
}

async function responseJson(response: Response, provider: string) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new ProviderError(body?.message || `Respuesta ${response.status} de ${provider}.`, response.status)
  return body
}

function mpStatus(status: string) {
  return ({ authorized: 'active', active: 'active', approved: 'active', pending: 'payment_review', paused: 'paused', cancelled: 'canceled', canceled: 'canceled', rejected: 'past_due', overdue: 'past_due' } as Record<string, string>)[String(status || '').toLowerCase()] || 'payment_review'
}

function paypalStatus(status: string) {
  return ({ active: 'active', approved: 'active', suspended: 'suspended', cancelled: 'canceled', canceled: 'canceled', approval_pending: 'incomplete', failed: 'past_due', expired: 'expired' } as Record<string, string>)[String(status || '').toLowerCase()] || 'payment_review'
}

export function providerConfigured(provider: ProviderCode) {
  const required = provider === 'mercadopago' ? ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'] : ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID']
  return { configured: required.every((name) => Boolean(String(Deno.env.get(name) || '').trim())), missing: required.filter((name) => !String(Deno.env.get(name) || '').trim()) }
}

export async function mercadoPago(input: { externalPlanId?: string | null; email?: string | null; tenantReference: string; planName: string; amount: number; currency: string; successUrl: string; cancelUrl: string; webhookUrl: string }) {
  requireEnv('Mercado Pago', ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'])
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const headers = { Authorization: `Bearer ${Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' }
  const body = input.externalPlanId ? { preapproval_plan_id: input.externalPlanId, reason: input.planName, external_reference: input.tenantReference, payer_email: input.email || undefined, back_url: input.successUrl, status: 'pending' } : { external_reference: input.tenantReference, items: [{ title: input.planName, quantity: 1, unit_price: input.amount, currency_id: input.currency }], back_urls: { success: input.successUrl, failure: input.cancelUrl, pending: input.successUrl }, auto_return: 'approved', notification_url: input.webhookUrl }
  const path = input.externalPlanId ? '/preapproval' : '/checkout/preferences'
  const bodyJson = await responseJson(await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), 'Mercado Pago')
  return { externalId: bodyJson.id || null, checkoutUrl: bodyJson.init_point || bodyJson.sandbox_init_point || null, kind: input.externalPlanId ? 'subscription' : 'preference' }
}

export async function syncMercadoPagoPlan(input: { name: string; description?: string | null; amount: number; currency: string; periodicity: string }) {
  requireEnv('Mercado Pago', ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'])
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const response = await fetch(`${base}/preapproval_plan`, { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: input.name, external_reference: `plan-${input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, auto_recurring: { frequency: input.periodicity === 'yearly' ? 12 : 1, frequency_type: 'months', transaction_amount: input.amount, currency_id: input.currency } }) })
  const body = await responseJson(response, 'Mercado Pago')
  return { externalPlanId: body.id || null, externalProductId: null }
}

export async function paypal(input: { externalPlanId?: string | null; tenantReference: string; amount: number; currency: string; successUrl: string; cancelUrl: string }) {
  requireEnv('PayPal', ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'])
  const base = (Deno.env.get('PAYPAL_API_BASE_URL') || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '')
  const basic = btoa(`${Deno.env.get('PAYPAL_CLIENT_ID')}:${Deno.env.get('PAYPAL_CLIENT_SECRET')}`)
  const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  const tokenBody = await responseJson(tokenResponse, 'PayPal')
  const headers = { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }
  const body = input.externalPlanId ? { plan_id: input.externalPlanId, custom_id: input.tenantReference, application_context: { return_url: input.successUrl, cancel_url: input.cancelUrl, user_action: 'SUBSCRIBE_NOW' } } : { intent: 'CAPTURE', purchase_units: [{ reference_id: input.tenantReference, amount: { currency_code: input.currency, value: input.amount.toFixed(2) } }], application_context: { return_url: input.successUrl, cancel_url: input.cancelUrl } }
  const path = input.externalPlanId ? '/v1/billing/subscriptions' : '/v2/checkout/orders'
  const bodyJson = await responseJson(await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), 'PayPal')
  const approve = bodyJson.links?.find((link: { rel?: string }) => link.rel === 'approve')?.href || null
  return { externalId: bodyJson.id || null, checkoutUrl: approve, kind: input.externalPlanId ? 'subscription' : 'order' }
}

export async function syncPayPalPlan(input: { name: string; description?: string | null; amount: number; currency: string; periodicity: string; externalProductId?: string | null }) {
  requireEnv('PayPal', ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'])
  const base = (Deno.env.get('PAYPAL_API_BASE_URL') || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '')
  const basic = btoa(`${Deno.env.get('PAYPAL_CLIENT_ID')}:${Deno.env.get('PAYPAL_CLIENT_SECRET')}`)
  const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  const tokenBody = await responseJson(tokenResponse, 'PayPal')
  const headers = { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' }
  let productId = input.externalProductId || null
  if (!productId) {
    const product = await responseJson(await fetch(`${base}/v1/catalogs/products`, { method: 'POST', headers, body: JSON.stringify({ name: input.name, description: input.description || input.name, type: 'SERVICE', category: 'SOFTWARE' }) }), 'PayPal')
    productId = product.id || null
  }
  const interval = input.periodicity === 'yearly' ? 'YEAR' : 'MONTH'
  const plan = await responseJson(await fetch(`${base}/v1/billing/plans`, { method: 'POST', headers, body: JSON.stringify({ product_id: productId, name: input.name, description: input.description || input.name, status: 'ACTIVE', billing_cycles: [{ frequency: { interval_unit: interval, interval_count: 1 }, tenure_type: 'REGULAR', sequence: 1, total_cycles: 0, pricing_scheme: { fixed_price: { value: input.amount.toFixed(2), currency_code: input.currency } } }], payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 2 } }) }), 'PayPal')
  return { externalPlanId: plan.id || null, externalProductId: productId }
}

export async function verifyMercadoPago(payload: Record<string, unknown>, headers: Headers) {
  requireEnv('Mercado Pago', ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'])
  const signature = headers.get('x-signature') || ''
  const requestId = headers.get('x-request-id') || ''
  const notificationId = String((payload.data as Record<string, unknown> | undefined)?.id || payload.id || '')
  const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=').map((value) => value.trim())))
  if (!signature || !requestId || !notificationId || !parts.ts || !parts.v1) return false
  const manifest = `id:${notificationId};request-id:${requestId};ts:${parts.ts};`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const digest = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(manifest)))).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return digest === parts.v1
}

export async function mercadoPagoResource(payload: Record<string, unknown>) {
  requireEnv('Mercado Pago', ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'])
  const id = String((payload.data as Record<string, unknown> | undefined)?.id || payload.id || '')
  if (!id) throw new ProviderError('Evento Mercado Pago sin recurso.', 422, 'resource_id_missing')
  const event = String(payload.type || payload.topic || '').toLowerCase()
  const resource = event.includes('payment') || event === 'payment' ? 'payments' : 'preapproval'
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const response = await fetch(`${base}/v1/${resource}/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')}` } })
  const body = await responseJson(response, 'Mercado Pago')
  return { id, status: body.status, normalizedStatus: mpStatus(body.status), amount: Number(body.transaction_amount || body.auto_recurring?.transaction_amount || 0) || null, currency: body.currency_id || body.auto_recurring?.currency_id || null, externalReference: body.external_reference || null, resource: body }
}

/** Consulta explícita de un recurso ya vinculado. Nunca acepta credenciales ni
 * IDs provistos por el navegador como fuente de verdad: el caller resuelve el
 * ID desde la base y sólo pasa el tipo de recurso. */
export async function mercadoPagoExternalStatus(input: { externalId: string; kind: 'checkout' | 'subscription' }) {
  requireEnv('Mercado Pago', ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET'])
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const resource = input.kind === 'subscription' ? 'preapproval' : 'checkout/preferences'
  const response = await fetch(`${base}/v1/${resource}/${encodeURIComponent(input.externalId)}`, { headers: { Authorization: `Bearer ${Deno.env.get('MERCADOPAGO_ACCESS_TOKEN')}` } })
  const body = await responseJson(response, 'Mercado Pago')
  return {
    status: body.status,
    normalizedStatus: mpStatus(body.status),
    amount: Number(body.transaction_amount || body.auto_recurring?.transaction_amount || 0) || null,
    currency: body.currency_id || body.auto_recurring?.currency_id || null,
    externalReference: body.external_reference || null,
    updatedAt: body.last_modified || body.date_last_updated || body.date_created || null,
    cancelAtPeriodEnd: Boolean(body.status === 'cancelled' || body.status === 'canceled'),
    currentPeriodStart: body.date_created || null,
    currentPeriodEnd: body.next_payment_date || null,
  }
}

export async function verifyPayPal(payload: Record<string, unknown>, headers: Headers) {
  requireEnv('PayPal', ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'])
  const required = ['paypal-transmission-id', 'paypal-transmission-time', 'paypal-cert-url', 'paypal-auth-algo', 'paypal-transmission-sig']
  if (required.some((key) => !headers.get(key))) return false
  const base = (Deno.env.get('PAYPAL_API_BASE_URL') || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '')
  const basic = btoa(`${Deno.env.get('PAYPAL_CLIENT_ID')}:${Deno.env.get('PAYPAL_CLIENT_SECRET')}`)
  const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  const tokenBody = await responseJson(tokenResponse, 'PayPal')
  const response = await fetch(`${base}/v1/notifications/verify-webhook-signature`, { method: 'POST', headers: { Authorization: `Bearer ${tokenBody.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ auth_algo: headers.get('paypal-auth-algo'), cert_url: headers.get('paypal-cert-url'), transmission_id: headers.get('paypal-transmission-id'), transmission_sig: headers.get('paypal-transmission-sig'), transmission_time: headers.get('paypal-transmission-time'), webhook_event: payload, webhook_id: Deno.env.get('PAYPAL_WEBHOOK_ID') }) })
  const result = await responseJson(response, 'PayPal')
  return result.verification_status === 'SUCCESS'
}

export async function paypalResource(payload: Record<string, unknown>) {
  requireEnv('PayPal', ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'])
  const id = String((payload.resource as Record<string, unknown> | undefined)?.id || payload.id || '')
  if (!id) throw new ProviderError('Evento PayPal sin recurso.', 422, 'resource_id_missing')
  const event = String(payload.event_type || '').toUpperCase()
  const resourcePath = event.includes('SUBSCRIPTION') ? `/v1/billing/subscriptions/${encodeURIComponent(id)}` : `/v2/checkout/orders/${encodeURIComponent(id)}`
  const base = (Deno.env.get('PAYPAL_API_BASE_URL') || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '')
  const basic = btoa(`${Deno.env.get('PAYPAL_CLIENT_ID')}:${Deno.env.get('PAYPAL_CLIENT_SECRET')}`)
  const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  const tokenBody = await responseJson(tokenResponse, 'PayPal')
  const response = await fetch(`${base}${resourcePath}`, { headers: { Authorization: `Bearer ${tokenBody.access_token}` } })
  const body = await responseJson(response, 'PayPal')
  const unit = body.purchase_units?.[0]
  return { id, status: body.status, normalizedStatus: paypalStatus(body.status), amount: Number(unit?.amount?.value || 0) || null, currency: unit?.amount?.currency_code || null, externalReference: body.custom_id || unit?.reference_id || null, resource: body }
}

async function paypalAccessToken(base: string) {
  const basic = btoa(`${Deno.env.get('PAYPAL_CLIENT_ID')}:${Deno.env.get('PAYPAL_CLIENT_SECRET')}`)
  const tokenResponse = await fetch(`${base}/v1/oauth2/token`, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials' })
  const tokenBody = await responseJson(tokenResponse, 'PayPal')
  if (!tokenBody.access_token) throw new ProviderError('PayPal no devolvió un token de acceso.', 502, 'provider_token_missing')
  return String(tokenBody.access_token)
}

export async function paypalExternalStatus(input: { externalId: string; kind: 'checkout' | 'subscription' }) {
  requireEnv('PayPal', ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID'])
  const base = (Deno.env.get('PAYPAL_API_BASE_URL') || 'https://api-m.sandbox.paypal.com').replace(/\/$/, '')
  const token = await paypalAccessToken(base)
  const path = input.kind === 'subscription' ? `/v1/billing/subscriptions/${encodeURIComponent(input.externalId)}` : `/v2/checkout/orders/${encodeURIComponent(input.externalId)}`
  const body = await responseJson(await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } }), 'PayPal')
  const unit = body.purchase_units?.[0]
  const lastPayment = body.billing_info?.last_payment?.amount
  return {
    status: body.status,
    normalizedStatus: paypalStatus(body.status),
    amount: Number(unit?.amount?.value || lastPayment?.value || 0) || null,
    currency: unit?.amount?.currency_code || lastPayment?.currency_code || null,
    externalReference: body.custom_id || unit?.reference_id || null,
    updatedAt: body.update_time || body.create_time || null,
    cancelAtPeriodEnd: Boolean(body.status === 'SUSPENDED' || body.status === 'CANCELLED'),
    currentPeriodStart: body.billing_info?.last_payment?.time || null,
    currentPeriodEnd: body.billing_info?.next_billing_time || null,
  }
}

export function normalizeStatus(provider: ProviderCode, status: string) { return provider === 'mercadopago' ? mpStatus(status) : paypalStatus(status) }
