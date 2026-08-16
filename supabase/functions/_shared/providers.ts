export type ProviderCode = 'mercadopago' | 'paypal'
export type ProviderCapability = 'checkout' | 'plan_sync' | 'status' | 'webhook' | 'all'
export type MercadoPagoEnvironment = 'sandbox' | 'production'

const PRODUCTION_API_BASE_URL = 'https://api.mercadopago.com'

export class ProviderNotConfigured extends Error {
  status = 503
  code = 'provider_not_configured'
  constructor(provider: string, missing: string[]) { super(`${provider} sandbox no está configurado.`); this.provider = provider; this.missing = missing }
  provider: string
  missing: string[]
}

export class ProviderError extends Error {
  constructor(message: string, public status = 502, public code = 'provider_error', public providerCode: string | null = null, public providerDetail: string | null = null, public providerPayload: unknown = null) { super(message) }
}

function requireEnv(provider: string, names: string[]) {
  const missing = names.filter((name) => !String(Deno.env.get(name) || '').trim())
  if (missing.length) throw new ProviderNotConfigured(provider, missing)
}

function mercadoPagoEnvironment(override?: MercadoPagoEnvironment) {
  const environment = String(override || Deno.env.get('MERCADOPAGO_ENVIRONMENT') || '').trim().toLowerCase()
  if (!environment) throw new ProviderError('El entorno de Mercado Pago no está configurado.', 409, 'invalid_provider_environment')
  if (environment !== 'sandbox' && environment !== 'production') throw new ProviderError('El entorno de Mercado Pago no es válido.', 409, 'invalid_provider_environment')
  return environment as MercadoPagoEnvironment
}

function mercadoPagoSecretName(environment: MercadoPagoEnvironment, kind: 'token' | 'webhook') {
  if (environment === 'sandbox') return kind === 'token' ? 'MERCADOPAGO_SANDBOX_ACCESS_TOKEN' : 'MERCADOPAGO_SANDBOX_WEBHOOK_SECRET'
  return kind === 'token' ? 'MERCADOPAGO_ACCESS_TOKEN' : 'MERCADOPAGO_WEBHOOK_SECRET'
}

function mercadoPagoSecret(environment: MercadoPagoEnvironment, kind: 'token' | 'webhook') {
  const scoped = String(Deno.env.get(mercadoPagoSecretName(environment, kind)) || '').trim()
  // Backwards-compatible only for an explicitly sandbox project. Production
  // never falls back to a sandbox secret name.
  if (scoped) return scoped
  if (environment === 'sandbox' && String(Deno.env.get('MERCADOPAGO_ENVIRONMENT') || '').trim().toLowerCase() === 'sandbox') {
    const legacyName = kind === 'token' ? 'MERCADOPAGO_ACCESS_TOKEN' : 'MERCADOPAGO_WEBHOOK_SECRET'
    return String(Deno.env.get(legacyName) || '').trim()
  }
  return ''
}

/**
 * The sandbox is intentionally bound to one Mercado Pago TEST seller.  A
 * credential prefix is not an identity signal: depending on the product,
 * Mercado Pago can issue APP_USR credentials for a TEST seller as well.
 */
export const EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID = 3595396521
export const EXPECTED_MERCADO_PAGO_SANDBOX_APPLICATION_ID = 3172086171935346

/**
 * Production is deliberately opt-in at several independent boundaries. The
 * default state (and every deployed environment in this repository) is
 * blocked. The returned object contains only booleans and configuration
 * names; it never exposes a secret or a token.
 */
export function mercadoPagoProductionReadiness(input: { tenantId?: number | null; externalPlanId?: string | null } = {}) {
  const environment = String(Deno.env.get('MERCADOPAGO_ENVIRONMENT') || '').trim().toLowerCase()
  const projectEnvironment = String(Deno.env.get('BILLING_ENVIRONMENT') || '').trim().toLowerCase()
  const apiBase = String(Deno.env.get('MERCADOPAGO_API_BASE_URL') || '').trim().replace(/\/$/, '')
  const pilotTenantId = Number(Deno.env.get('BILLING_PRODUCTION_PILOT_TENANT_ID'))
  const allowlisted = String(Deno.env.get('BILLING_PRODUCTION_ALLOWED_TENANT_IDS') || '').split(',').map((value) => Number(value.trim())).filter((value) => Number.isSafeInteger(value) && value > 0)
  const expectedPlan = String(Deno.env.get('MERCADOPAGO_PRODUCTION_PLAN_ID') || Deno.env.get('BILLING_EXTERNAL_PLAN_ID') || '').trim()
  const requestedPlan = String(input.externalPlanId || '').trim()
  const missing: string[] = []
  for (const name of ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'MERCADOPAGO_PRODUCTION_SELLER_ID', 'MERCADOPAGO_PRODUCTION_APPLICATION_ID', 'MERCADOPAGO_PRODUCTION_PLAN_ID']) {
    if (!String(Deno.env.get(name) || '').trim()) missing.push(name)
  }
  if (environment !== 'production') missing.push('MERCADOPAGO_ENVIRONMENT=production')
  if (projectEnvironment !== 'production') missing.push('BILLING_ENVIRONMENT=production')
  if (apiBase !== PRODUCTION_API_BASE_URL) missing.push('MERCADOPAGO_API_BASE_URL')
  if (Deno.env.get('BILLING_PRODUCTION_ENABLED') !== '1') missing.push('BILLING_PRODUCTION_ENABLED=1')
  if (Deno.env.get('BILLING_PRODUCTION_READINESS') !== 'ready') missing.push('BILLING_PRODUCTION_READINESS=ready')
  if (Deno.env.get('BILLING_PRODUCTION_CHECKOUT_CONFIRMATION') !== 'I_UNDERSTAND_REAL_CHARGES') missing.push('BILLING_PRODUCTION_CHECKOUT_CONFIRMATION')
  if (Deno.env.get('MERCADOPAGO_PUBLIC_KEY_CONFIGURED') !== '1') missing.push('MERCADOPAGO_PUBLIC_KEY_CONFIGURED=1')
  if (Deno.env.get('BILLING_PRODUCTION_BACKUP_VERIFIED') !== '1') missing.push('BILLING_PRODUCTION_BACKUP_VERIFIED=1')
  if (Deno.env.get('BILLING_PRODUCTION_ALERTING_VERIFIED') !== '1') missing.push('BILLING_PRODUCTION_ALERTING_VERIFIED=1')
  if (!Number.isSafeInteger(pilotTenantId) || pilotTenantId <= 0) missing.push('BILLING_PRODUCTION_PILOT_TENANT_ID')
  if (allowlisted.length !== 1 || allowlisted[0] !== pilotTenantId) missing.push('BILLING_PRODUCTION_ALLOWED_TENANT_IDS')
  if (input.tenantId != null && input.tenantId !== pilotTenantId) missing.push('tenant_not_in_production_allowlist')
  if (input.externalPlanId != null && (!requestedPlan || !expectedPlan || requestedPlan !== expectedPlan)) missing.push('production_plan_mapping')
  return {
    ready: missing.length === 0,
    environment,
    projectEnvironment,
    apiBaseConfigured: apiBase === PRODUCTION_API_BASE_URL,
    pilotTenantId: Number.isSafeInteger(pilotTenantId) && pilotTenantId > 0 ? pilotTenantId : null,
    allowlistedTenantCount: allowlisted.length,
    planConfigured: Boolean(expectedPlan),
    requestedPlanMatches: input.externalPlanId == null ? Boolean(expectedPlan) : Boolean(requestedPlan && expectedPlan && requestedPlan === expectedPlan),
    missing,
  }
}

function requireMercadoPagoProduction(input: { tenantId: number; externalPlanId: string }) {
  const readiness = mercadoPagoProductionReadiness(input)
  if (!readiness.ready) throw new ProviderError('El checkout productivo de Mercado Pago está bloqueado hasta completar el readiness.', 409, 'production_checkout_blocked', null, null, { missing: readiness.missing })
  return readiness
}

export function mercadoPagoCredentialStatus(environment?: MercadoPagoEnvironment) {
  const resolved = mercadoPagoEnvironment(environment)
  const token = mercadoPagoSecret(resolved, 'token')
  const kind = token.startsWith('TEST-') ? 'test' : token ? 'unverified' : 'missing'
  // `sandbox` is deliberately false until /users/me has confirmed the
  // allow-listed TEST seller.  This prevents a configured but unverified
  // APP_USR token from being treated as safe by status consumers.
  return { configured: Boolean(token), kind, sandbox: false }
}

function configuredMercadoPagoAccessToken({ allowProduction = false, environment }: { allowProduction?: boolean; environment?: MercadoPagoEnvironment } = {}) {
  const resolved = mercadoPagoEnvironment(environment)
  if (!allowProduction && resolved === 'production') throw new ProviderError('Mercado Pago de producción está deshabilitado para este flujo.', 409, 'production_provider_disabled')
  const status = mercadoPagoCredentialStatus(resolved)
  if (!status.configured) throw new ProviderNotConfigured('Mercado Pago', [mercadoPagoSecretName(resolved, 'token')])
  return mercadoPagoSecret(resolved, 'token')
}

function mercadoPagoAccessToken() {
  return configuredMercadoPagoAccessToken({ environment: 'sandbox' })
}

async function mercadoPagoWebhookIdentity(environmentOverride?: MercadoPagoEnvironment) {
  const environment = mercadoPagoEnvironment(environmentOverride)
  if (environment === 'sandbox') return mercadoPagoSandboxIdentity()
  const readiness = mercadoPagoProductionReadiness()
  if (!readiness.ready) throw new ProviderError('El webhook productivo de Mercado Pago permanece bloqueado.', 409, 'production_webhook_blocked')
  const currentUser = await mercadoPagoCurrentUser({ allowProduction: true, environment: 'production' })
  if (currentUser.id !== Number(Deno.env.get('MERCADOPAGO_PRODUCTION_SELLER_ID'))) throw new ProviderError('La credencial no pertenece al vendedor productivo autorizado.', 409, 'production_seller_mismatch')
  return currentUser
}

function sanitizeProviderPayload(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/(?:TEST|APP_USR)-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500)
  if (Array.isArray(value)) return value.slice(0, 50).map(sanitizeProviderPayload)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, item]) => {
    const normalized = key.toLowerCase()
    return [key, /(token|secret|password|authorization|card|cvv|security_code)/.test(normalized) ? '[redacted]' : sanitizeProviderPayload(item)]
  }))
  return value
}

function requiredEnv(provider: ProviderCode, capability: ProviderCapability = 'all', environment?: MercadoPagoEnvironment) {
  if (provider === 'mercadopago') {
    // El token alcanza para crear/sincronizar checkout y consultar estados.
    // La firma sólo es necesaria cuando se expone el webhook.
    return capability === 'webhook' || capability === 'all'
      ? [mercadoPagoSecretName(environment || mercadoPagoEnvironment(), 'token'), mercadoPagoSecretName(environment || mercadoPagoEnvironment(), 'webhook')]
      : [mercadoPagoSecretName(environment || mercadoPagoEnvironment(), 'token')]
  }
  return ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID']
}

async function responseJson(response: Response, provider: string) {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const cause = Array.isArray(body?.cause) ? body.cause[0] : null
    const providerCode = String(body?.error || body?.code || cause?.code || '').trim().slice(0, 120) || null
    const providerDetail = String(body?.message || '').replace(/(?:TEST|APP_USR)-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 180) || null
    throw new ProviderError(body?.message || `Respuesta ${response.status} de ${provider}.`, response.status, 'provider_error', providerCode, providerDetail, sanitizeProviderPayload(body))
  }
  return body
}

function mpStatus(status: string) {
  return ({ authorized: 'active', active: 'active', approved: 'active', pending: 'payment_review', paused: 'paused', cancelled: 'canceled', canceled: 'canceled', rejected: 'past_due', overdue: 'past_due' } as Record<string, string>)[String(status || '').toLowerCase()] || 'payment_review'
}

function paypalStatus(status: string) {
  return ({ active: 'active', approved: 'active', suspended: 'suspended', cancelled: 'canceled', canceled: 'canceled', approval_pending: 'incomplete', failed: 'past_due', expired: 'expired' } as Record<string, string>)[String(status || '').toLowerCase()] || 'payment_review'
}

export function providerConfigured(provider: ProviderCode, capability: ProviderCapability = 'all', environment?: MercadoPagoEnvironment) {
  if (provider === 'mercadopago') {
    const resolved = mercadoPagoEnvironment(environment)
    const tokenName = mercadoPagoSecretName(resolved, 'token')
    const webhookName = mercadoPagoSecretName(resolved, 'webhook')
    const names = capability === 'webhook' || capability === 'all' ? [tokenName, webhookName] : [tokenName]
    const configured = names.every((name) => Boolean(mercadoPagoSecret(resolved, name === tokenName ? 'token' : 'webhook')))
    return { configured, missing: configured ? [] : names.filter((name) => !mercadoPagoSecret(resolved, name === tokenName ? 'token' : 'webhook')) }
  }
  const required = requiredEnv(provider, capability, environment)
  return { configured: required.every((name) => Boolean(String(Deno.env.get(name) || '').trim())), missing: required.filter((name) => !String(Deno.env.get(name) || '').trim()) }
}

export async function mercadoPago(input: { externalPlanId?: string | null; email?: string | null; tenantReference: string; planName: string; amount: number; currency: string; successUrl: string; cancelUrl: string; webhookUrl: string; idempotencyKey?: string }) {
  await mercadoPagoSandboxIdentity()
  const token = mercadoPagoAccessToken()
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(input.idempotencyKey ? { 'X-Idempotency-Key': input.idempotencyKey } : {}) }
  // A subscription associated with a plan must be created with a
  // card_token_id. The hosted plan checkout is the safe sandbox entry point:
  // Mercado Pago collects/tokenizes the buyer's test card and then emits the
  // verified preapproval webhook. Never fabricate a card token server-side.
  if (input.externalPlanId) {
    const plan = await responseJson(await fetch(`${base}/preapproval_plan/${encodeURIComponent(input.externalPlanId)}`, { headers }), 'Mercado Pago')
    return { externalId: null, checkoutUrl: plan.sandbox_init_point || plan.init_point || null, kind: 'subscription_plan' }
  }
  const body = input.externalPlanId ? { preapproval_plan_id: input.externalPlanId, reason: input.planName, external_reference: input.tenantReference, payer_email: input.email || undefined, back_url: input.successUrl, status: 'pending' } : { external_reference: input.tenantReference, items: [{ title: input.planName, quantity: 1, unit_price: input.amount, currency_id: input.currency }], back_urls: { success: input.successUrl, failure: input.cancelUrl, pending: input.successUrl }, auto_return: 'approved', notification_url: input.webhookUrl }
  const path = input.externalPlanId ? '/preapproval' : '/checkout/preferences'
  const bodyJson = await responseJson(await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), 'Mercado Pago')
  return { externalId: bodyJson.id || null, checkoutUrl: bodyJson.init_point || bodyJson.sandbox_init_point || null, kind: input.externalPlanId ? 'subscription' : 'preference' }
}

/**
 * Official associated-plan production flow. The browser supplies only a
 * one-time card_token_id generated by Mercado Pago.js/Card Payment Brick; the
 * Access Token and all commercial values remain server-side. This function is
 * unreachable until mercadoPagoProductionReadiness() is fully satisfied.
 */
export async function mercadoPagoProductionSubscription(input: { tenantId: number; externalPlanId: string; cardTokenId: string; payerEmail: string; externalReference: string; backUrl: string; idempotencyKey: string }) {
  requireMercadoPagoProduction({ tenantId: input.tenantId, externalPlanId: input.externalPlanId })
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(input.cardTokenId)) throw new ProviderError('El token de tarjeta no es válido.', 422, 'invalid_card_token')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payerEmail)) throw new ProviderError('No se pudo resolver el email de facturación.', 422, 'billing_email_invalid')
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(input.idempotencyKey)) throw new ProviderError('Clave de idempotencia inválida.', 422, 'invalid_idempotency_key')
  const token = String(Deno.env.get('MERCADOPAGO_ACCESS_TOKEN'))
  const base = PRODUCTION_API_BASE_URL
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': input.idempotencyKey }
  const currentUser = await responseJson(await fetch(`${base}/users/me`, { headers }), 'Mercado Pago')
  const expectedSellerId = Number(Deno.env.get('MERCADOPAGO_PRODUCTION_SELLER_ID'))
  if (Number(currentUser?.id) !== expectedSellerId) throw new ProviderError('La credencial no pertenece al vendedor productivo autorizado.', 409, 'production_seller_mismatch')
  const plan = await responseJson(await fetch(`${base}/preapproval_plan/${encodeURIComponent(input.externalPlanId)}`, { headers }), 'Mercado Pago')
  const expectedApplicationId = Number(Deno.env.get('MERCADOPAGO_PRODUCTION_APPLICATION_ID'))
  if (Number(plan?.collector_id) !== expectedSellerId || Number(plan?.application_id) !== expectedApplicationId || Number(plan?.auto_recurring?.transaction_amount) !== 30000 || String(plan?.auto_recurring?.currency_id || '').toUpperCase() !== 'ARS' || Number(plan?.auto_recurring?.frequency) !== 1 || String(plan?.auto_recurring?.frequency_type || '').toLowerCase() !== 'months') {
    throw new ProviderError('El plan productivo no coincide con el contrato Starter autorizado.', 409, 'production_plan_mismatch')
  }
  const body = {
    preapproval_plan_id: input.externalPlanId,
    card_token_id: input.cardTokenId,
    payer_email: input.payerEmail,
    external_reference: input.externalReference,
    back_url: input.backUrl,
    status: 'authorized',
  }
  const response = await fetch(`${base}/preapproval`, { method: 'POST', headers, body: JSON.stringify(body) })
  const result = await responseJson(response, 'Mercado Pago')
  return { externalId: String(result.id || '') || null, checkoutUrl: result.init_point || null, kind: 'subscription' as const, status: String(result.status || 'authorized').toLowerCase() }
}

export async function syncMercadoPagoPlan(input: { name: string; description?: string | null; amount: number; currency: string; periodicity: string; externalReference: string; backUrl: string; idempotencyKey: string }) {
  await mercadoPagoSandboxIdentity()
  const token = mercadoPagoAccessToken()
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const response = await fetch(`${base}/preapproval_plan`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': input.idempotencyKey }, body: JSON.stringify({ reason: input.name, external_reference: input.externalReference, back_url: input.backUrl, auto_recurring: { frequency: input.periodicity === 'yearly' ? 12 : 1, frequency_type: 'months', transaction_amount: input.amount, currency_id: input.currency } }) })
  const body = await responseJson(response, 'Mercado Pago')
  return { externalPlanId: body.id || null, externalProductId: null }
}

/** Read-only ownership/configuration check for the isolated sandbox plan. */
export async function mercadoPagoPlanDetails(externalPlanId: string) {
  await mercadoPagoSandboxIdentity()
  const token = mercadoPagoAccessToken()
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const body = await responseJson(await fetch(`${base}/preapproval_plan/${encodeURIComponent(externalPlanId)}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }), 'Mercado Pago')
  return {
    id: String(body.id || externalPlanId),
    applicationId: Number(body.application_id) || null,
    collectorId: Number(body.collector_id) || null,
    status: String(body.status || '').toLowerCase() || null,
    amount: Number(body.auto_recurring?.transaction_amount) || null,
    currency: String(body.auto_recurring?.currency_id || '').toUpperCase() || null,
    frequency: Number(body.auto_recurring?.frequency) || null,
    frequencyType: String(body.auto_recurring?.frequency_type || '').toLowerCase() || null,
    raw: sanitizeProviderPayload(body),
  }
}

/** Read-only identity check for the currently configured sandbox credential. */
export async function mercadoPagoCurrentUser(options: { allowProduction?: boolean; environment?: MercadoPagoEnvironment } = {}) {
  const token = configuredMercadoPagoAccessToken(options)
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const body = await responseJson(await fetch(`${base}/users/me`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }), 'Mercado Pago')
  return {
    id: Number(body.id) || null,
    nickname: String(body.nickname || '').trim() || null,
    countryId: String(body.country_id || '').trim().toUpperCase() || null,
    siteId: String(body.site_id || '').trim().toUpperCase() || null,
  }
}

/**
 * Read-only production identity diagnostic. This deliberately validates only
 * the provider configuration and /users/me; it never evaluates checkout
 * readiness and never creates or updates a billing resource.
 */
export async function mercadoPagoProductionIdentity() {
  const environment = String(Deno.env.get('MERCADOPAGO_ENVIRONMENT') || '').trim().toLowerCase()
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || '').replace(/\/$/, '')
  if (environment !== 'production') throw new ProviderError('El entorno productivo no está configurado.', 409, 'production_environment_not_configured')
  if (base !== PRODUCTION_API_BASE_URL) throw new ProviderError('La API productiva de Mercado Pago no está configurada.', 409, 'production_api_base_not_configured')
  const currentUser = await mercadoPagoCurrentUser({ allowProduction: true, environment: 'production' })
  if (!currentUser.id) throw new ProviderError('Mercado Pago no devolvió una identidad de vendedor.', 502, 'production_identity_missing')
  const expectedSellerId = Number(Deno.env.get('MERCADOPAGO_PRODUCTION_SELLER_ID'))
  return {
    sellerId: currentUser.id,
    collectorId: currentUser.id,
    siteId: currentUser.siteId,
    countryId: currentUser.countryId,
    sellerVerified: Number.isSafeInteger(expectedSellerId) && expectedSellerId > 0 && expectedSellerId === currentUser.id,
    expectedSellerConfigured: Number.isSafeInteger(expectedSellerId) && expectedSellerId > 0,
  }
}

const PRODUCTION_STARTER_CONTRACT = Object.freeze({
  reason: 'Austral Starter',
  externalReference: 'austral:starter:production:AR:30000',
  amount: 30000,
  currency: 'ARS',
  frequency: 1,
  frequencyType: 'months',
})

function productionPlanFromProvider(body: Record<string, unknown>, fallbackId = '') {
  const recurring = body.auto_recurring && typeof body.auto_recurring === 'object'
    ? body.auto_recurring as Record<string, unknown>
    : {}
  return {
    id: String(body.id || fallbackId).trim() || null,
    reason: String(body.reason || body.name || '').trim() || null,
    collectorId: Number(body.collector_id) || null,
    applicationId: Number(body.application_id) || null,
    status: String(body.status || '').trim().toLowerCase() || null,
    externalReference: String(body.external_reference || '').trim() || null,
    amount: Number(recurring.transaction_amount) || null,
    currency: String(recurring.currency_id || '').trim().toUpperCase() || null,
    frequency: Number(recurring.frequency) || null,
    frequencyType: String(recurring.frequency_type || '').trim().toLowerCase() || null,
  }
}

function productionPlanMatchesContract(plan: ReturnType<typeof productionPlanFromProvider>) {
  const expectedApplicationId = Number(Deno.env.get('MERCADOPAGO_PRODUCTION_APPLICATION_ID'))
  return plan.collectorId === 1334909095
    && plan.amount === PRODUCTION_STARTER_CONTRACT.amount
    && plan.currency === PRODUCTION_STARTER_CONTRACT.currency
    && plan.frequency === PRODUCTION_STARTER_CONTRACT.frequency
    && plan.frequencyType === PRODUCTION_STARTER_CONTRACT.frequencyType
    && Number.isSafeInteger(expectedApplicationId)
    && expectedApplicationId > 0
    && plan.applicationId === expectedApplicationId
}

/** Read-only production plan search. No plan or database writes occur here. */
export async function mercadoPagoProductionPlanSearch() {
  const identity = await mercadoPagoProductionIdentity()
  const token = configuredMercadoPagoAccessToken({ allowProduction: true })
  const base = PRODUCTION_API_BASE_URL
  const params = new URLSearchParams({ q: PRODUCTION_STARTER_CONTRACT.reason, limit: '50' })
  const body = await responseJson(await fetch(`${base}/preapproval_plan/search?${params.toString()}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }), 'Mercado Pago')
  const results = Array.isArray(body.results) ? body.results : []
  const candidates = results.slice(0, 50).map((item: Record<string, unknown>) => productionPlanFromProvider(item)).filter((item) => item.id)
  return {
    identity,
    candidates,
    compatible: candidates.filter(productionPlanMatchesContract),
    contract: PRODUCTION_STARTER_CONTRACT,
  }
}

/** Verify one production plan through the provider's authoritative GET. */
export async function mercadoPagoProductionPlanDetails(externalPlanId: string) {
  const token = configuredMercadoPagoAccessToken({ allowProduction: true })
  const base = PRODUCTION_API_BASE_URL
  const body = await responseJson(await fetch(`${base}/preapproval_plan/${encodeURIComponent(externalPlanId)}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }), 'Mercado Pago')
  const plan = productionPlanFromProvider(body, externalPlanId)
  if (!productionPlanMatchesContract(plan)) throw new ProviderError('El plan productivo no coincide con el contrato Starter autorizado.', 409, 'production_plan_mismatch')
  return plan
}

/** Create exactly one production plan after the caller has exhausted search. */
export async function mercadoPagoCreateProductionPlan() {
  const token = configuredMercadoPagoAccessToken({ allowProduction: true })
  const body = await responseJson(await fetch(`${PRODUCTION_API_BASE_URL}/preapproval_plan`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': PRODUCTION_STARTER_CONTRACT.externalReference,
    },
    body: JSON.stringify({
      reason: PRODUCTION_STARTER_CONTRACT.reason,
      external_reference: PRODUCTION_STARTER_CONTRACT.externalReference,
      back_url: 'https://barberia.cuchitron.lat/facturacion?billing=pending',
      auto_recurring: {
        frequency: PRODUCTION_STARTER_CONTRACT.frequency,
        frequency_type: PRODUCTION_STARTER_CONTRACT.frequencyType,
        transaction_amount: PRODUCTION_STARTER_CONTRACT.amount,
        currency_id: PRODUCTION_STARTER_CONTRACT.currency,
      },
    }),
  }), 'Mercado Pago')
  return mercadoPagoProductionPlanDetails(String(body.id || ''))
}

/** Read-only search used by the isolated sandbox diagnostic. */
export async function mercadoPagoPreapprovalSearch(planId?: string | null) {
  // The caller performs /users/me immediately before the plan lookup and
  // passes only the fixed sandbox plan. Avoid a second identity request here
  // so a transient provider read cannot mask the subscription search result.
  const token = mercadoPagoAccessToken()
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  // The subscriptions search endpoint only accepts its documented filters
  // (including pagination). Mercado Pago rejects the generic `sort`/`criteria`
  // pair with HTTP 400, so ordering is intentionally left to the provider.
  const params = new URLSearchParams({ limit: '50' })
  if (planId) params.set('preapproval_plan_id', planId)
  const body = await responseJson(await fetch(`${base}/preapproval/search?${params.toString()}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }), 'Mercado Pago')
  const results = Array.isArray(body.results) ? body.results : []
  return {
    paging: body.paging && typeof body.paging === 'object' ? { total: Number(body.paging.total) || 0, limit: Number(body.paging.limit) || 0, offset: Number(body.paging.offset) || 0 } : null,
    results: results.slice(0, 50).map((item: Record<string, unknown>) => ({
      id: String(item.id || '') || null,
      payerId: Number(item.payer_id) || null,
      collectorId: Number(item.collector_id) || null,
      planId: String(item.preapproval_plan_id || '') || null,
      status: String(item.status || '').toLowerCase() || null,
      applicationId: Number(item.application_id) || null,
      externalReference: String(item.external_reference || '') || null,
      dateCreated: String(item.date_created || '') || null,
      lastModified: String(item.last_modified || '') || null,
    })),
  }
}

/** Read-only detail lookup for a preapproval returned by the seller search. */
export async function mercadoPagoPreapprovalDetails(preapprovalId: string) {
  const token = mercadoPagoAccessToken()
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const body = await responseJson(await fetch(`${base}/preapproval/${encodeURIComponent(preapprovalId)}`, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }), 'Mercado Pago')
  return {
    id: String(body.id || preapprovalId) || null,
    payerId: Number(body.payer_id) || null,
    collectorId: Number(body.collector_id) || null,
    planId: String(body.preapproval_plan_id || '') || null,
    status: String(body.status || '').toLowerCase() || null,
    applicationId: Number(body.application_id) || null,
    externalReference: String(body.external_reference || '') || null,
    dateCreated: String(body.date_created || '') || null,
    lastModified: String(body.last_modified || '') || null,
    nextPaymentDate: String(body.next_payment_date || '') || null,
    amount: Number(body.auto_recurring?.transaction_amount) || null,
    currency: String(body.auto_recurring?.currency_id || '').toUpperCase() || null,
    frequency: Number(body.auto_recurring?.frequency) || null,
    frequencyType: String(body.auto_recurring?.frequency_type || '').toLowerCase() || null,
    raw: sanitizeProviderPayload(body),
  }
}

/**
 * Validate the configured credential against Mercado Pago itself.  No token
 * value is ever returned, logged, or included in an error.  The exact seller
 * allow-list is only active while the environment is explicitly sandbox.
 */
export async function mercadoPagoSandboxIdentity() {
  const currentUser = await mercadoPagoCurrentUser({ environment: 'sandbox' })
  if (currentUser.id !== EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID) {
    throw new ProviderError('La credencial de Mercado Pago no pertenece al vendedor sandbox autorizado.', 409, 'sandbox_seller_mismatch')
  }
  return currentUser
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

function hexToBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  return bytes
}

export async function verifyMercadoPago(payload: Record<string, unknown>, headers: Headers, dataIdFromUrl = '', environmentOverride?: MercadoPagoEnvironment) {
  const environment = mercadoPagoEnvironment(environmentOverride)
  const webhookSecret = mercadoPagoSecret(environment, 'webhook')
  if (!webhookSecret) throw new ProviderNotConfigured('Mercado Pago', [mercadoPagoSecretName(environment, 'webhook')])
  const signature = headers.get('x-signature') || ''
  const requestId = headers.get('x-request-id') || ''
  // Mercado Pago documents `data.id` in the query string as the canonical
  // identifier for HMAC. Keep the body fallback for older sandbox fixtures.
  const notificationId = String(dataIdFromUrl || (payload.data as Record<string, unknown> | undefined)?.id || payload.id || '')
  const parts = Object.fromEntries(signature.split(',').map((part) => part.split('=').map((value) => value.trim())))
  const expectedSignature = hexToBytes(String(parts.v1 || ''))
  if (!signature || !requestId || !notificationId || !parts.ts || !expectedSignature) return false
  const manifest = `id:${notificationId};request-id:${requestId};ts:${parts.ts};`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(webhookSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const valid = await crypto.subtle.verify('HMAC', key, expectedSignature, new TextEncoder().encode(manifest))
  // Sólo una firma válida puede disparar una consulta al proveedor. Esto
  // evita que requests falsificados conviertan /users/me en un amplificador.
  // Compatibility marker: await mercadoPagoWebhookIdentity() remains the
  // legacy call shape; the runtime call below always carries the resolved env.
  if (!valid) return false
  await mercadoPagoWebhookIdentity(environment)
  return true
}

export async function mercadoPagoResource(payload: Record<string, unknown>, dataIdFromUrl = '', environmentOverride?: MercadoPagoEnvironment) {
  const environment = mercadoPagoEnvironment(environmentOverride)
  await mercadoPagoWebhookIdentity(environment)
  const token = configuredMercadoPagoAccessToken({ allowProduction: true, environment })
  const id = String(dataIdFromUrl || (payload.data as Record<string, unknown> | undefined)?.id || payload.id || '')
  if (!id) throw new ProviderError('Evento Mercado Pago sin recurso.', 422, 'resource_id_missing')
  const event = String(payload.type || payload.topic || payload.action || '').toLowerCase()
  const resource = event.includes('subscription_authorized_payment')
    ? 'authorized_payments'
    : event.includes('subscription_preapproval_plan')
      ? 'preapproval_plan'
      : event.includes('payment') || event === 'payment'
        ? 'payments'
        : 'preapproval'
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  // Mercado Pago's Webhooks reference maps plan notifications to the search
  // endpoint. A plan event is audit-only, but it still needs a provider-side
  // read before it is ignored. Subscription notifications have a known ID and
  // use the documented detail endpoint; payments use their versioned endpoint.
  const resourcePath = resource === 'payments'
    ? `/v1/payments/${encodeURIComponent(id)}`
    : resource === 'authorized_payments'
      ? `/authorized_payments/${encodeURIComponent(id)}`
      : resource === 'preapproval_plan'
        ? `/preapproval_plan/search?q=${encodeURIComponent(id)}`
        : `/preapproval/${encodeURIComponent(id)}`
  const response = await fetch(`${base}${resourcePath}`, { headers: { Authorization: `Bearer ${token}` } })
  const responseBody = await responseJson(response, 'Mercado Pago')
  const body = resource === 'preapproval_plan'
    ? (Array.isArray(responseBody.results) ? responseBody.results.find((item: Record<string, unknown>) => String(item.id || '') === id) : null)
    : responseBody
  if (!body) throw new ProviderError('Mercado Pago no devolvió el plan notificado.', 404, 'subscription_plan_not_found')
  const resourceType = resource === 'payments' || resource === 'authorized_payments' ? 'payment' : resource === 'preapproval_plan' ? 'preapproval_plan' : 'preapproval'
  return { id, status: body.status, normalizedStatus: mpStatus(body.status), amount: Number(body.transaction_amount || body.auto_recurring?.transaction_amount || body.amount || 0) || null, currency: body.currency_id || body.auto_recurring?.currency_id || body.currency || null, externalReference: body.external_reference || null, resourceType, resource: body }
}

/** Consulta explícita de un recurso ya vinculado. Nunca acepta credenciales ni
 * IDs provistos por el navegador como fuente de verdad: el caller resuelve el
 * ID desde la base y sólo pasa el tipo de recurso. */
export async function mercadoPagoExternalStatus(input: { externalId: string; kind: 'checkout' | 'subscription' }) {
  await mercadoPagoSandboxIdentity()
  const token = mercadoPagoAccessToken()
  const base = (Deno.env.get('MERCADOPAGO_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '')
  const resource = input.kind === 'subscription' ? 'preapproval' : 'checkout/preferences'
  const resourcePath = input.kind === 'subscription' ? `/${resource}` : `/v1/${resource}`
  const response = await fetch(`${base}${resourcePath}/${encodeURIComponent(input.externalId)}`, { headers: { Authorization: `Bearer ${token}` } })
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
