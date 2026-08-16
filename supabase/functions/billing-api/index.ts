import { adminClient, authenticate, ownerTenant, platformRole, requestClient } from '../_shared/supabase.ts'
import { corsHeaders, errorJson, json, readJson, requestId } from '../_shared/http.ts'
import { EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID, mercadoPago, mercadoPagoCreateProductionPlan, mercadoPagoCredentialStatus, mercadoPagoCurrentUser, mercadoPagoExternalStatus, mercadoPagoPlanDetails, mercadoPagoPreapprovalDetails, mercadoPagoPreapprovalSearch, mercadoPagoProductionIdentity, mercadoPagoProductionPlanDetails, mercadoPagoProductionPlanSearch, mercadoPagoProductionReadiness, mercadoPagoProductionSubscription, normalizeStatus, paypal, paypalExternalStatus, providerConfigured, syncMercadoPagoPlan, syncPayPalPlan } from '../_shared/providers.ts'

const PROVIDERS = new Set(['mercadopago', 'paypal'])
const SANDBOX_BILLING = Object.freeze({
  tenantId: 6,
  planCode: 'starter',
  provider: 'mercadopago',
  environment: 'sandbox',
  externalPlanId: '63a35af17150492f92dbc459c686a775',
})
const PRODUCTION_PILOT = Object.freeze({
  planCode: 'starter',
  provider: 'mercadopago',
  country: 'AR',
  currency: 'ARS',
  amount: 30000,
  periodicity: 'monthly',
  environment: 'production',
  slug: 'austral-billing-pilot',
  name: 'Austral Billing Pilot',
})

function normalizeCountryCode(value: unknown) {
  const raw = String(value || '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(raw)) return raw
  const aliases: Record<string, string> = {
    ARGENTINA: 'AR', BRASIL: 'BR', BRAZIL: 'BR', CHILE: 'CL',
    MEXICO: 'MX', MÉXICO: 'MX', URUGUAY: 'UY',
  }
  return aliases[raw] || 'GLOBAL'
}

async function resolveExternalPrice(
  admin: ReturnType<typeof adminClient>, tenantId: number, planCode: string, provider: string, environment: string,
) {
  const { data: tenant, error: tenantError } = await admin.from('barberias').select('pais').eq('id', tenantId).maybeSingle()
  if (tenantError || !tenant) throw Object.assign(new Error('No se pudo resolver el país del tenant.'), { status: 502, code: 'tenant_lookup_failed' })
  const country = normalizeCountryCode(tenant.pais)
  const countries = Array.from(new Set([country, 'GLOBAL']))
  const { data: prices, error: priceError } = await admin.from('saas_plan_precios')
    .select('id, plan_codigo, proveedor_codigo, pais_codigo, moneda, importe, periodicidad, entorno, external_product_id, external_plan_id, habilitado, activo')
    .eq('plan_codigo', planCode).eq('proveedor_codigo', provider).eq('entorno', environment).eq('activo', true).in('pais_codigo', countries)
  if (priceError) throw Object.assign(new Error('No se pudo consultar el precio externo.'), { status: 502, code: 'external_price_lookup_failed' })
  const price = (prices || []).sort((left, right) => {
    const leftExact = left.pais_codigo === country ? 0 : 1
    const rightExact = right.pais_codigo === country ? 0 : 1
    return leftExact - rightExact || Number(left.id) - Number(right.id)
  })[0]
  if (!price) throw Object.assign(new Error('No hay un precio externo configurado para este proveedor y país.'), { status: 409, code: 'external_price_not_configured' })
  return { ...price, country }
}

async function checkoutTenant(admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>, { sandboxOnly = false } = {}) {
  // Platform owners/admins may exercise billing against an isolated technical
  // tenant without becoming a member of it. This is deliberately restricted
  // to rows explicitly marked as sandbox, so production tenants can never be
  // selected through this escape hatch.
  if (body.tenant_id != null) {
    const role = await platformRole(admin, userId)
    if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
    const tenantId = Number(body.tenant_id)
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw Object.assign(new Error('Tenant sandbox inválido.'), { status: 422, code: 'invalid_sandbox_tenant' })
    if (sandboxOnly && tenantId !== SANDBOX_BILLING.tenantId) throw Object.assign(new Error('Mercado Pago sandbox sólo permite el tenant técnico autorizado.'), { status: 403, code: 'sandbox_scope_required' })
    const { data: tenant, error } = await admin.from('barberias').select('id, metadata').eq('id', tenantId).maybeSingle()
    if (error) throw Object.assign(new Error('No se pudo resolver el tenant sandbox.'), { status: 500, code: 'tenant_lookup_failed' })
    const metadata = tenant?.metadata && typeof tenant.metadata === 'object' ? tenant.metadata as Record<string, unknown> : {}
    if (!tenant || metadata.environment !== 'sandbox' || metadata.technical !== true) throw Object.assign(new Error('Solo se permiten tenants técnicos marcados como sandbox.'), { status: 403, code: 'sandbox_tenant_required' })
    return tenantId
  }
  return ownerTenant(admin, userId)
}

async function checkout(request: Request, admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  const planCode = String(body.plan_codigo || '').trim().toLowerCase()
  const provider = String(body.proveedor_codigo || '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(planCode)) throw Object.assign(new Error('Plan inválido.'), { status: 422, code: 'invalid_plan' })
  if (!PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })
  const tenantId = await checkoutTenant(admin, userId, body, { sandboxOnly: provider === 'mercadopago' })

  const [{ data: providerRow }, { data: tenant }] = await Promise.all([
    admin.from('saas_proveedores_pago').select('codigo, activo, entorno, metadata').eq('codigo', provider).maybeSingle(),
    admin.from('barberias').select('id, nombre, pais, billing_email, metadata').eq('id', tenantId).single(),
  ])
  if (!providerRow) throw Object.assign(new Error('Proveedor no registrado.'), { status: 422, code: 'provider_not_registered' })
  if (provider === 'mercadopago' && providerRow.entorno !== 'sandbox') throw Object.assign(new Error('Mercado Pago de producción está deshabilitado.'), { status: 409, code: 'production_provider_disabled' })
  const tenantMetadata = tenant?.metadata && typeof tenant.metadata === 'object' ? tenant.metadata as Record<string, unknown> : {}
  const sandboxBillingEnabled = provider === 'mercadopago'
    && tenantMetadata.environment === 'sandbox'
    && tenantMetadata.technical === true
    && tenantMetadata.billing_provider === 'mercadopago'
    && tenantMetadata.billing_enabled === true
    && tenantMetadata.billing_plan === planCode
  if (provider === 'mercadopago' && !sandboxBillingEnabled) throw Object.assign(new Error('Mercado Pago sandbox está habilitado únicamente para el tenant técnico y plan de prueba.'), { status: 403, code: 'sandbox_scope_required' })
  const config = providerConfigured(provider as 'mercadopago' | 'paypal', provider === 'mercadopago' ? 'checkout' : 'all')
  if (!config.configured) throw Object.assign(new Error('Faltan variables privadas del proveedor sandbox.'), { status: 503, code: 'provider_not_configured' })
  if (!providerRow.activo && provider !== 'mercadopago') throw Object.assign(new Error('El proveedor sandbox todavía no está habilitado.'), { status: 409, code: 'provider_disabled' })
  const externalPrice = await resolveExternalPrice(admin, tenantId, planCode, provider, providerRow.entorno)

  const { data: existing } = await admin.from('saas_billing_checkout_attempts').select('id, estado, checkout_url').eq('barberia_id', tenantId).eq('plan_codigo', planCode).eq('proveedor_codigo', provider).in('estado', ['created', 'pending_provider', 'ready']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing?.id && existing.estado === 'ready' && existing.checkout_url) return json({ checkout_attempt_id: existing.id, status: 'ready', checkout_url: existing.checkout_url, idempotent: true })

  const { data: intent, error: intentError } = await requestClient(request).rpc('create_billing_checkout_intent_with_price', { p_barberia_id: tenantId, p_plan_codigo: planCode, p_proveedor_codigo: provider, p_precio_id: externalPrice.id, p_idempotency_key: `edge-${crypto.randomUUID()}` })
  if (intentError) {
    console.error(JSON.stringify({
      code: 'checkout_intent_rpc_failed',
      rpc_code: intentError.code || null,
      rpc_message: String(intentError.message || '').slice(0, 180),
      rpc_details: String(intentError.details || '').slice(0, 180),
      rpc_hint: String(intentError.hint || '').slice(0, 180),
    }))
    const { data: concurrent } = await admin.from('saas_billing_checkout_attempts').select('id, estado, checkout_url').eq('barberia_id', tenantId).eq('plan_codigo', planCode).eq('proveedor_codigo', provider).in('estado', ['created', 'pending_provider', 'ready']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (concurrent?.id && concurrent.checkout_url) return json({ checkout_attempt_id: concurrent.id, status: 'ready', checkout_url: concurrent.checkout_url, idempotent: true })
    if (concurrent?.id) return json({ checkout_attempt_id: concurrent.id, status: concurrent.estado, checkout_url: null, idempotent: true }, 202)
    throw Object.assign(new Error('No se pudo preparar el checkout.'), { status: 502, code: 'checkout_intent_failed' })
  }
  if (!intent?.checkout_attempt_id) throw Object.assign(new Error('El checkout no devolvió un intento válido.'), { status: 502, code: 'checkout_intent_invalid' })
  const { data: plan } = await admin.from('saas_planes').select('codigo, nombre, descripcion, precio_mensual, moneda, periodicidad').eq('codigo', planCode).single()
  if (!plan || !tenant) throw Object.assign(new Error('Plan o tenant inexistente.'), { status: 404, code: 'billing_context_missing' })
  const reference = `billing:${intent.checkout_attempt_id}`
  const baseUrl = String(Deno.env.get('APP_BASE_URL') || '').trim().replace(/\/$/, '')
  if (!/^https:\/\//i.test(baseUrl)) throw Object.assign(new Error('Falta APP_BASE_URL HTTPS para los retornos del checkout.'), { status: 503, code: 'app_base_url_not_configured' })
  const webhookUrl = `${Deno.env.get('SUPABASE_URL') || new URL(request.url).origin}/functions/v1/billing-webhooks/${provider}`
  try {
    const input = { externalPlanId: externalPrice.habilitado ? externalPrice.external_plan_id : null, email: tenant.billing_email, tenantReference: reference, planName: plan.nombre, amount: Number(externalPrice.importe), currency: externalPrice.moneda, periodicity: externalPrice.periodicidad, successUrl: `${baseUrl}/facturacion?billing=success`, cancelUrl: `${baseUrl}/facturacion?billing=cancel`, webhookUrl }
    const result = provider === 'mercadopago'
      ? await mercadoPago({ ...input, idempotencyKey: `mp-checkout:${intent.checkout_attempt_id}` })
      : await paypal(input)
    if (!result.checkoutUrl) throw Object.assign(new Error('El proveedor no devolvió URL de aprobación.'), { status: 502, code: 'approval_url_missing' })
    const { error: checkoutUpdateError } = await admin.from('saas_billing_checkout_attempts').update({ estado: 'ready', checkout_url: result.checkoutUrl, external_checkout_id: result.externalId, metadata: { tenant_reference: reference, provider_kind: result.kind, environment: 'sandbox', price_id: externalPrice.id, external_plan_id: externalPrice.external_plan_id, pais_codigo: externalPrice.pais_codigo, currency: externalPrice.moneda, amount: externalPrice.importe } }).eq('id', intent.checkout_attempt_id)
    if (checkoutUpdateError) throw Object.assign(new Error('No se pudo registrar el checkout.'), { status: 502, code: 'checkout_persist_failed' })
    if (result.kind === 'subscription' && result.externalId) {
      const { data: subscription, error: subscriptionError } = await admin.from('saas_suscripciones').select('id').eq('barberia_id', tenantId).single()
      if (subscriptionError || !subscription) throw Object.assign(new Error('No se encontró la suscripción interna.'), { status: 502, code: 'subscription_registration_failed' })
      const { error: externalError } = await admin.from('saas_suscripciones_externas').upsert({ suscripcion_id: subscription.id, barberia_id: tenantId, proveedor_codigo: provider, external_subscription_id: result.externalId, external_plan_id: externalPrice.external_plan_id || null, estado_externo: 'pending', metadata: { reference, environment: 'sandbox', price_id: externalPrice.id, pais_codigo: externalPrice.pais_codigo, currency: externalPrice.moneda, amount: externalPrice.importe } }, { onConflict: 'suscripcion_id,proveedor_codigo' })
      if (externalError) throw Object.assign(new Error('No se pudo registrar la suscripción externa.'), { status: 502, code: 'subscription_registration_failed' })
      const { error: subscriptionUpdateError } = await admin.from('saas_suscripciones').update({ provider, provider_subscription_id: result.externalId }).eq('id', subscription.id)
      if (subscriptionUpdateError) throw Object.assign(new Error('No se pudo vincular la suscripción interna.'), { status: 502, code: 'subscription_registration_failed' })
    }
    return json({ checkout_attempt_id: intent.checkout_attempt_id, status: 'ready', checkout_url: result.checkoutUrl })
  } catch (error) {
    const retryable = ['checkout_persist_failed', 'subscription_registration_failed'].includes(error?.code)
    await admin.from('saas_billing_checkout_attempts').update({ estado: retryable ? 'pending_provider' : 'failed', metadata: { tenant_reference: reference, error_code: error?.code || 'provider_error', retryable } }).eq('id', intent.checkout_attempt_id)
    throw error
  }
}

/**
 * Production associated-plan checkout. It is intentionally separate from the
 * hosted sandbox checkout above. The client can submit only a plan code and a
 * one-time card token; tenant, price, seller, application and environment are
 * resolved and validated server-side. The route remains closed until the
 * explicit production readiness guard is complete.
 */
async function productionSubscription(request: Request, admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  const planCode = String(body.plan_codigo || '').trim().toLowerCase()
  if (planCode !== 'starter') throw Object.assign(new Error('El checkout productivo sólo está preparado para Starter.'), { status: 422, code: 'production_plan_restricted' })
  if (['tenant_id', 'importe', 'moneda', 'payer_email', 'external_reference', 'back_url'].some((field) => Object.prototype.hasOwnProperty.call(body, field))) throw Object.assign(new Error('Tenant, email, referencia y precio se resuelven exclusivamente en backend.'), { status: 422, code: 'client_pricing_forbidden' })
  const cardTokenId = String(body.card_token_id || '').trim()
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(cardTokenId)) throw Object.assign(new Error('Token de tarjeta inválido.'), { status: 422, code: 'invalid_card_token' })
  const idempotencyKey = String(request.headers.get('Idempotency-Key') || '').trim()
  if (!/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) throw Object.assign(new Error('Falta una clave de idempotencia válida.'), { status: 422, code: 'invalid_idempotency_key' })

  const tenantId = await ownerTenant(admin, userId)
  if ([1, 5, SANDBOX_BILLING.tenantId].includes(tenantId)) throw Object.assign(new Error('Este tenant está protegido y no puede iniciar el checkout productivo.'), { status: 403, code: 'protected_tenant' })
  const [{ data: providerRow }, { data: tenant, error: tenantError }] = await Promise.all([
    admin.from('saas_proveedores_pago').select('codigo, activo, entorno').eq('codigo', 'mercadopago').maybeSingle(),
    admin.from('barberias').select('id, nombre, pais, billing_email, metadata').eq('id', tenantId).maybeSingle(),
  ])
  if (tenantError || !tenant) throw Object.assign(new Error('No se pudo resolver el tenant.'), { status: 502, code: 'tenant_lookup_failed' })
  if (!providerRow || providerRow.entorno !== 'production' || !providerRow.activo) throw Object.assign(new Error('Mercado Pago productivo permanece deshabilitado.'), { status: 409, code: 'production_provider_disabled' })
  const tenantMetadata = tenant.metadata && typeof tenant.metadata === 'object' ? tenant.metadata as Record<string, unknown> : {}
  if (tenantMetadata.environment !== 'production' || tenantMetadata.technical === true) throw Object.assign(new Error('El tenant no cumple el entorno productivo permitido.'), { status: 403, code: 'production_tenant_required' })

  const externalPrice = await resolveExternalPrice(admin, tenantId, planCode, 'mercadopago', 'production')
  if (externalPrice.pais_codigo !== 'AR' || String(externalPrice.moneda).toUpperCase() !== 'ARS' || Number(externalPrice.importe) !== 30000 || externalPrice.periodicidad !== 'monthly' || !externalPrice.external_plan_id || !externalPrice.habilitado) throw Object.assign(new Error('El precio Starter productivo no coincide con el contrato aprobado.'), { status: 409, code: 'production_price_mismatch' })
  const readiness = mercadoPagoProductionReadiness({ tenantId, externalPlanId: externalPrice.external_plan_id })
  if (!readiness.ready) throw Object.assign(new Error('El checkout productivo continúa bloqueado hasta completar readiness.'), { status: 409, code: 'production_checkout_blocked' })
  const payerEmail = String(tenant.billing_email || '').trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) throw Object.assign(new Error('El email de facturación del tenant no es válido.'), { status: 422, code: 'billing_email_invalid' })

  const { data: existing } = await admin.from('saas_billing_checkout_attempts').select('id, estado, external_checkout_id, checkout_url, metadata').eq('barberia_id', tenantId).eq('idempotency_key', idempotencyKey).maybeSingle()
  if (existing?.external_checkout_id) return json({ status: 'verifying', checkout_attempt_id: existing.id, external_subscription_id: existing.external_checkout_id, checkout_url: existing.checkout_url || null, activation: 'webhook_pending', idempotent: true })

  const { data: intent, error: intentError } = await requestClient(request).rpc('create_billing_checkout_intent_with_price', { p_barberia_id: tenantId, p_plan_codigo: planCode, p_proveedor_codigo: 'mercadopago', p_precio_id: externalPrice.id, p_idempotency_key: idempotencyKey })
  if (intentError || !intent?.checkout_attempt_id) throw Object.assign(new Error('No se pudo preparar el intento de suscripción.'), { status: 502, code: 'subscription_intent_failed' })
  const attemptId = Number(intent.checkout_attempt_id)
  const reference = `billing:${attemptId}`
  const baseUrl = String(Deno.env.get('APP_BASE_URL') || '').trim().replace(/\/$/, '')
  if (!/^https:\/\//i.test(baseUrl)) throw Object.assign(new Error('Falta APP_BASE_URL HTTPS para el retorno.'), { status: 503, code: 'app_base_url_not_configured' })
  let result: { externalId: string | null; checkoutUrl: string | null; status: string }
  try {
    result = await mercadoPagoProductionSubscription({ tenantId, externalPlanId: String(externalPrice.external_plan_id), cardTokenId, payerEmail, externalReference: reference, backUrl: `${baseUrl}/facturacion?billing=pending`, idempotencyKey: `mp-subscription:${attemptId}` })
    if (!result.externalId) throw Object.assign(new Error('Mercado Pago no devolvió un identificador de suscripción.'), { status: 502, code: 'external_subscription_id_missing' })
  } catch (error) {
    await admin.from('saas_billing_checkout_attempts').update({ estado: 'pending_provider', metadata: { environment: 'production', flow: 'associated_plan_card_token', reference, error_code: error?.code || 'provider_error', retryable: true } }).eq('id', attemptId)
    throw error
  }

  const now = new Date().toISOString()
  const { error: attemptError } = await admin.from('saas_billing_checkout_attempts').update({ estado: 'pending_provider', external_checkout_id: result.externalId, checkout_url: result.checkoutUrl, metadata: { environment: 'production', flow: 'associated_plan_card_token', reference, external_plan_id: externalPrice.external_plan_id, price_id: externalPrice.id, amount: externalPrice.importe, currency: externalPrice.moneda, periodicidad: externalPrice.periodicidad, activation: 'webhook_pending' } }).eq('id', attemptId)
  if (attemptError) throw Object.assign(new Error('No se pudo registrar el intento de suscripción.'), { status: 502, code: 'subscription_attempt_persist_failed' })
  const { data: subscription } = await admin.from('saas_suscripciones').select('id').eq('barberia_id', tenantId).maybeSingle()
  if (!subscription?.id) throw Object.assign(new Error('No se encontró la suscripción interna.'), { status: 502, code: 'subscription_registration_failed' })
  const { error: externalError } = await admin.from('saas_suscripciones_externas').upsert({ suscripcion_id: subscription.id, barberia_id: tenantId, proveedor_codigo: 'mercadopago', external_subscription_id: result.externalId, external_plan_id: externalPrice.external_plan_id, estado_externo: 'pending', last_synced_at: now, metadata: { environment: 'production', flow: 'associated_plan_card_token', external_reference: reference, price_id: externalPrice.id, amount: externalPrice.importe, currency: externalPrice.moneda, activation: 'webhook_pending' } }, { onConflict: 'suscripcion_id,proveedor_codigo' })
  if (externalError) throw Object.assign(new Error('No se pudo registrar la suscripción externa.'), { status: 502, code: 'subscription_registration_failed' })
  const { error: linkError } = await admin.from('saas_suscripciones').update({ provider: 'mercadopago', provider_subscription_id: result.externalId, updated_at: now }).eq('id', subscription.id)
  if (linkError) throw Object.assign(new Error('No se pudo vincular la suscripción interna.'), { status: 502, code: 'subscription_registration_failed' })
  return json({ status: 'verifying', checkout_attempt_id: attemptId, external_subscription_id: result.externalId, checkout_url: result.checkoutUrl, activation: 'webhook_pending', idempotent: Boolean(intent.idempotent) })
}

async function syncPlans(request: Request, admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  const role = await platformRole(admin, userId)
  if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
  const provider = String(body.proveedor_codigo || '').trim().toLowerCase()
  if (!PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })
  const planCode = String(body.plan_codigo || '').trim().toLowerCase()
  const requestedTenantId = body.tenant_id == null ? 6 : Number(body.tenant_id)
  if (provider === 'mercadopago' && (requestedTenantId !== 6 || planCode !== 'starter')) throw Object.assign(new Error('Mercado Pago sandbox solo permite sincronizar starter del tenant tecnico #6.'), { status: 403, code: 'sandbox_scope_required' })
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(planCode)) throw Object.assign(new Error('Para sincronizar se debe indicar un único plan válido.'), { status: 422, code: 'invalid_plan' })
  if (provider === 'mercadopago') await checkoutTenant(admin, userId, { tenant_id: requestedTenantId }, { sandboxOnly: true })
  const config = providerConfigured(provider as 'mercadopago' | 'paypal', provider === 'mercadopago' ? 'plan_sync' : 'all')
  if (!config.configured) throw Object.assign(new Error('Faltan variables privadas del proveedor sandbox.'), { status: 503, code: 'provider_not_configured' })
  const { data: providerRow } = await admin.from('saas_proveedores_pago').select('activo, entorno, metadata').eq('codigo', provider).single()
  if (!providerRow) throw Object.assign(new Error('Proveedor no registrado.'), { status: 422, code: 'provider_not_registered' })
  const externalPrice = await resolveExternalPrice(admin, requestedTenantId, planCode, provider, providerRow.entorno)
  if (provider === 'mercadopago' && providerRow.entorno !== 'sandbox') throw Object.assign(new Error('Mercado Pago de producción está deshabilitado.'), { status: 409, code: 'production_provider_disabled' })
  // Mercado Pago plan synchronization is a platform sandbox operation. It
  // must not flip the global provider flag, which stays disabled for
  // production tenants until a separate activation policy is approved.
  if (!providerRow.activo && provider !== 'mercadopago') throw Object.assign(new Error('El proveedor está deshabilitado.'), { status: 409, code: 'provider_disabled' })
  const { data: plans } = await admin.from('saas_planes').select('codigo, nombre, descripcion, precio_mensual, moneda, periodicidad').eq('codigo', planCode).eq('activo', true).limit(1)
  if (!plans?.length) throw Object.assign(new Error('El plan solicitado no existe o está inactivo.'), { status: 404, code: 'plan_not_found' })
  const baseUrl = String(Deno.env.get('APP_BASE_URL') || '').trim().replace(/\/$/, '')
  if (!/^https:\/\//i.test(baseUrl)) throw Object.assign(new Error('Falta APP_BASE_URL HTTPS para sincronizar el plan.'), { status: 503, code: 'app_base_url_not_configured' })
  const results = []
  for (const plan of plans || []) {
    const mapping = provider === 'paypal'
      ? (await admin.from('saas_plan_proveedores').select('id, external_plan_id, external_product_id, habilitado').eq('plan_codigo', plan.codigo).eq('proveedor_codigo', provider).single()).data
      : null
    if (provider === 'paypal' && !mapping) throw Object.assign(new Error('Falta el mapeo interno del plan.'), { status: 502, code: 'plan_mapping_missing' })
    if (externalPrice.external_plan_id && externalPrice.habilitado) {
      results.push({ plan: plan.codigo, price_id: externalPrice.id, status: 'already_synced', external_plan_id: externalPrice.external_plan_id, amount: Number(externalPrice.importe), currency: externalPrice.moneda })
      continue
    }
    const result = provider === 'mercadopago'
      ? await syncMercadoPagoPlan({ name: plan.nombre, description: plan.descripcion, amount: Number(externalPrice.importe), currency: externalPrice.moneda, periodicity: externalPrice.periodicidad, externalReference: `plan-${plan.codigo}-${externalPrice.pais_codigo}-${externalPrice.moneda}`, backUrl: `${baseUrl}/facturacion?billing=success`, idempotencyKey: `mp-plan:${plan.codigo}:${externalPrice.id}` })
      : await syncPayPalPlan({ name: plan.nombre, description: plan.descripcion, amount: Number(externalPrice.importe), currency: externalPrice.moneda, periodicity: externalPrice.periodicidad, externalProductId: mapping?.external_product_id })
    if (provider === 'mercadopago') {
      const { error: priceUpdateError } = await admin.from('saas_plan_precios').update({ external_plan_id: result.externalPlanId, external_product_id: result.externalProductId, habilitado: Boolean(result.externalPlanId), metadata: { source: 'mercadopago_sandbox', synced_at: new Date().toISOString(), environment: providerRow.entorno } }).eq('id', externalPrice.id)
      if (priceUpdateError) throw Object.assign(new Error('No se pudo guardar el precio externo.'), { status: 502, code: 'external_price_persist_failed' })
    } else {
      var { error: mappingUpdateError } = await admin.from('saas_plan_proveedores').update({ external_plan_id: result.externalPlanId, external_product_id: result.externalProductId, habilitado: Boolean(result.externalPlanId), metadata: { synced_at: new Date().toISOString(), environment: providerRow.entorno } }).eq('id', mapping.id)
      if (mappingUpdateError) throw Object.assign(new Error('No se pudo guardar la sincronización del plan.'), { status: 502, code: 'plan_mapping_persist_failed' })
    }
    if (mappingUpdateError) throw Object.assign(new Error('No se pudo guardar la sincronización del plan.'), { status: 502, code: 'plan_mapping_persist_failed' })
    results.push({ plan: plan.codigo, price_id: externalPrice.id, status: 'synced', external_plan_id: result.externalPlanId, amount: Number(externalPrice.importe), currency: externalPrice.moneda })
  }
  return json({ provider, environment: 'sandbox', results })
}

function providerStatus(provider: string, externalId: string, kind: 'checkout' | 'subscription') {
  if (provider === 'mercadopago') return mercadoPagoExternalStatus({ externalId, kind })
  if (provider === 'paypal') return paypalExternalStatus({ externalId, kind })
  throw Object.assign(new Error('Proveedor no soportado.'), { status: 422, code: 'unsupported_provider' })
}

async function externalStatus(admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  // Platform owners/admins may query the isolated technical sandbox tenant by
  // passing tenant_id. Regular tenant owners keep the existing behaviour and
  // can only query their own tenant.
  const requestedAttempt = body.checkout_attempt_id == null ? null : Number(body.checkout_attempt_id)
  if (requestedAttempt !== null && (!Number.isSafeInteger(requestedAttempt) || requestedAttempt <= 0)) throw Object.assign(new Error('Intento de checkout inválido.'), { status: 422, code: 'invalid_checkout_attempt' })
  const provider = body.proveedor_codigo ? String(body.proveedor_codigo).trim().toLowerCase() : null
  if (provider && !PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })
  const tenantId = await checkoutTenant(admin, userId, body, { sandboxOnly: provider === 'mercadopago' })
  const records = requestedAttempt
    ? (await admin.from('saas_billing_checkout_attempts').select('id, proveedor_codigo, external_checkout_id').eq('id', requestedAttempt).eq('barberia_id', tenantId).maybeSingle()).data
    : (await admin.from('saas_suscripciones_externas').select('proveedor_codigo, external_subscription_id').eq('barberia_id', tenantId).maybeSingle()).data
  if (!records) return json({ status: 'not_linked', checked_at: new Date().toISOString() })
  const row = records as Record<string, unknown>
  const currentProvider = String(row.proveedor_codigo)
  const externalId = String(row.external_checkout_id || row.external_subscription_id || '')
  if (!externalId || (provider && provider !== currentProvider)) return json({ status: 'not_linked', checked_at: new Date().toISOString() })
  const kind = requestedAttempt ? 'checkout' : 'subscription'
  const config = providerConfigured(currentProvider as 'mercadopago' | 'paypal', currentProvider === 'mercadopago' ? 'status' : 'all')
  if (!config.configured) throw Object.assign(new Error('Faltan variables privadas del proveedor sandbox.'), { status: 503, code: 'provider_not_configured' })
  const result = await providerStatus(currentProvider, externalId, kind)
  return json({ provider: currentProvider, kind, status: result.normalizedStatus, provider_status: result.status, amount: result.amount, currency: result.currency, checked_at: new Date().toISOString() })
}

async function reconcile(admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  const role = await platformRole(admin, userId)
  if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
  const provider = body.proveedor_codigo ? String(body.proveedor_codigo).trim().toLowerCase() : null
  if (provider && !PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })
  const parsedLimit = body.limit == null ? 100 : Number(body.limit)
  const limit = Number.isSafeInteger(parsedLimit) ? Math.max(1, Math.min(100, parsedLimit)) : 100
  let query = admin.from('saas_suscripciones_externas').select('id, suscripcion_id, proveedor_codigo, external_subscription_id, barberia_id').limit(limit)
  if (provider) query = query.eq('proveedor_codigo', provider)
  const { data: links, error } = await query
  if (error) throw Object.assign(new Error('No se pudieron leer suscripciones externas.'), { status: 502, code: 'reconciliation_read_failed' })
  const summary = { checked: 0, transitioned: 0, unchanged: 0, failed: 0, errors: [] as string[] }
  for (const link of links || []) {
    const currentProvider = String(link.proveedor_codigo) as 'mercadopago' | 'paypal'
    try {
      const config = providerConfigured(currentProvider)
      if (!config.configured) throw Object.assign(new Error('provider_not_configured'), { code: 'provider_not_configured' })
      const result = await providerStatus(currentProvider, String(link.external_subscription_id), 'subscription')
      const now = new Date().toISOString()
      await admin.from('saas_suscripciones_externas').update({ estado_externo: result.normalizedStatus, current_period_start: result.currentPeriodStart, current_period_end: result.currentPeriodEnd, cancel_at_period_end: result.cancelAtPeriodEnd, last_synced_at: now, metadata: { last_reconciliation_status: result.status } }).eq('id', link.id)
      const eventId = `reconcile:${currentProvider}:${link.external_subscription_id}:${result.normalizedStatus}`
      const { data: transition, error: transitionError } = await admin.rpc('transition_saas_subscription', { p_subscription_id: link.suscripcion_id, p_to_state: result.normalizedStatus, p_reason: 'manual_reconciliation', p_source: 'reconciliation', p_provider_event_id: eventId, p_provider_event_at: result.updatedAt || null })
      if (transitionError) throw Object.assign(new Error('subscription_transition_failed'), { code: 'subscription_transition_failed' })
      summary.checked += 1
      if (transition?.idempotent || transition?.state_version === undefined) summary.unchanged += 1
      else summary.transitioned += 1
    } catch (reconciliationError) {
      summary.failed += 1
      summary.errors.push(String(reconciliationError?.code || 'reconciliation_failed'))
    }
  }
  return json({ provider: provider || 'all', environment: 'sandbox', ...summary, checked_at: new Date().toISOString() })
}

async function reconcileSandboxPreapproval(request: Request, admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  let stage = 'authorize'
  try {
  const role = await platformRole(admin, userId)
  if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
  const preapprovalId = String(body.preapproval_id || '').trim()
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(preapprovalId)) throw Object.assign(new Error('Preapproval sandbox inválido.'), { status: 422, code: 'invalid_sandbox_preapproval' })

  const [{ data: tenant }, { data: providerRow }, { data: price }, { data: subscription }] = await Promise.all([
    admin.from('barberias').select('id, metadata').eq('id', SANDBOX_BILLING.tenantId).maybeSingle(),
    admin.from('saas_proveedores_pago').select('codigo, activo, entorno').eq('codigo', SANDBOX_BILLING.provider).maybeSingle(),
    admin.from('saas_plan_precios').select('id, plan_codigo, proveedor_codigo, moneda, importe, periodicidad, entorno, external_plan_id, habilitado, activo').eq('id', 1).maybeSingle(),
    admin.from('saas_suscripciones').select('id, barberia_id, plan_codigo, estado, provider, provider_subscription_id, state_version').eq('barberia_id', SANDBOX_BILLING.tenantId).maybeSingle(),
  ])
  const tenantMetadata = tenant?.metadata && typeof tenant.metadata === 'object' ? tenant.metadata as Record<string, unknown> : {}
  if (!tenant || tenantMetadata.environment !== SANDBOX_BILLING.environment || tenantMetadata.technical !== true || tenantMetadata.billing_enabled !== true || tenantMetadata.billing_provider !== SANDBOX_BILLING.provider || tenantMetadata.billing_plan !== SANDBOX_BILLING.planCode) {
    throw Object.assign(new Error('El tenant sandbox técnico no cumple el contrato de billing.'), { status: 409, code: 'sandbox_tenant_inconsistent' })
  }
  if (!providerRow || providerRow.entorno !== SANDBOX_BILLING.environment) throw Object.assign(new Error('Mercado Pago de producción está bloqueado.'), { status: 409, code: 'production_provider_disabled' })
  if (!price || price.plan_codigo !== SANDBOX_BILLING.planCode || price.proveedor_codigo !== SANDBOX_BILLING.provider || price.entorno !== SANDBOX_BILLING.environment || price.external_plan_id !== SANDBOX_BILLING.externalPlanId || !price.activo || !price.habilitado || String(price.moneda).toUpperCase() !== 'ARS' || Number(price.importe) !== 15000 || price.periodicidad !== 'monthly') {
    throw Object.assign(new Error('El precio sandbox actual no coincide con el plan autorizado.'), { status: 409, code: 'sandbox_price_inconsistent' })
  }
  if (!subscription || subscription.plan_codigo !== SANDBOX_BILLING.planCode) throw Object.assign(new Error('El tenant sandbox no tiene una suscripción starter.'), { status: 409, code: 'sandbox_subscription_missing' })

  stage = 'verify_provider_identity'
  const currentUser = await mercadoPagoCurrentUser()
  if (currentUser.id !== EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID) throw Object.assign(new Error('La credencial no pertenece al vendedor sandbox autorizado.'), { status: 409, code: 'sandbox_seller_mismatch' })
  stage = 'fetch_provider_resources'
  const [external, plan] = await Promise.all([
    mercadoPagoPreapprovalDetails(preapprovalId),
    mercadoPagoPlanDetails(SANDBOX_BILLING.externalPlanId),
  ])
  const normalizedStatus = normalizeStatus('mercadopago', external.status || '')
  if (external.id !== preapprovalId || external.collectorId !== EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID || external.planId !== SANDBOX_BILLING.externalPlanId || external.amount !== 15000 || external.currency !== 'ARS' || external.frequency !== 1 || external.frequencyType !== 'months' || normalizedStatus !== 'active') {
    throw Object.assign(new Error('La suscripción externa no coincide con el contrato sandbox autorizado.'), { status: 409, code: 'sandbox_preapproval_inconsistent' })
  }
  if (plan.collectorId !== EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID || plan.applicationId == null || external.applicationId !== plan.applicationId || plan.amount !== 15000 || plan.currency !== 'ARS' || plan.frequency !== 1 || plan.frequencyType !== 'months') {
    throw Object.assign(new Error('El plan externo no coincide con el vendedor, aplicación o precio sandbox autorizado.'), { status: 409, code: 'sandbox_plan_inconsistent' })
  }

  const [{ data: externalById, error: externalByIdError }, { data: existingForSubscription, error: existingForSubscriptionError }] = await Promise.all([
    admin.from('saas_suscripciones_externas').select('id, suscripcion_id, barberia_id, external_subscription_id, external_plan_id, estado_externo, metadata').eq('proveedor_codigo', SANDBOX_BILLING.provider).eq('external_subscription_id', preapprovalId).maybeSingle(),
    admin.from('saas_suscripciones_externas').select('id, suscripcion_id, barberia_id, external_subscription_id, external_plan_id, estado_externo, metadata').eq('suscripcion_id', subscription.id).eq('proveedor_codigo', SANDBOX_BILLING.provider).maybeSingle(),
  ])
  if (externalByIdError || existingForSubscriptionError) throw Object.assign(new Error('No se pudo verificar el vínculo externo sandbox.'), { status: 502, code: 'sandbox_link_lookup_failed' })
  if (externalById && (externalById.barberia_id !== SANDBOX_BILLING.tenantId || externalById.suscripcion_id !== subscription.id)) throw Object.assign(new Error('La suscripción externa ya está vinculada a otro tenant.'), { status: 409, code: 'sandbox_subscription_conflict' })
  if (existingForSubscription && existingForSubscription.external_subscription_id !== preapprovalId) throw Object.assign(new Error('El tenant sandbox ya tiene otra suscripción externa vinculada.'), { status: 409, code: 'sandbox_subscription_conflict' })

  const providerEventId = `reconcile:${SANDBOX_BILLING.provider}:${preapprovalId}:${normalizedStatus}`
  const now = new Date().toISOString()
  const externalMetadata = {
    source: 'sandbox_reconciliation',
    environment: SANDBOX_BILLING.environment,
    tenant_id: SANDBOX_BILLING.tenantId,
    plan_codigo: SANDBOX_BILLING.planCode,
    external_plan_id: SANDBOX_BILLING.externalPlanId,
    preapproval_id: preapprovalId,
    application_id: external.applicationId,
    collector_id: external.collectorId,
    payer_id: external.payerId,
    external_reference: external.externalReference,
    verified_status: external.status,
  }
  stage = 'persist_external_subscription'
  const { error: externalLinkError } = await admin.from('saas_suscripciones_externas').upsert({
    suscripcion_id: subscription.id,
    barberia_id: SANDBOX_BILLING.tenantId,
    proveedor_codigo: SANDBOX_BILLING.provider,
    external_subscription_id: preapprovalId,
    external_plan_id: SANDBOX_BILLING.externalPlanId,
    estado_externo: normalizedStatus,
    current_period_start: external.dateCreated,
    current_period_end: external.nextPaymentDate,
    cancel_at_period_end: false,
    last_synced_at: now,
    metadata: externalMetadata,
  }, { onConflict: 'suscripcion_id,proveedor_codigo' })
  if (externalLinkError) throw Object.assign(new Error('No se pudo vincular la suscripción externa sandbox.'), { status: 502, code: 'subscription_registration_failed' })
  stage = 'link_internal_subscription'
  const { error: subscriptionLinkError } = await admin.from('saas_suscripciones').update({ provider: SANDBOX_BILLING.provider, provider_subscription_id: preapprovalId, updated_at: now }).eq('id', subscription.id)
  if (subscriptionLinkError) throw Object.assign(new Error('No se pudo vincular la suscripción interna sandbox.'), { status: 502, code: 'subscription_registration_failed' })
  stage = 'transition_internal_subscription'
  const { data: transition, error: transitionError } = await requestClient(request).rpc('transition_saas_subscription', { p_subscription_id: subscription.id, p_to_state: normalizedStatus, p_reason: `sandbox_reconciliation:${preapprovalId}`, p_source: 'reconciliation', p_provider_event_id: providerEventId, p_provider_event_at: external.lastModified || external.dateCreated || null })
  if (transitionError) throw Object.assign(new Error('No se pudo actualizar la suscripción sandbox.'), { status: 502, code: 'subscription_transition_failed' })
  stage = 'write_audit_event'
  const { error: auditError } = await admin.from('saas_billing_events').upsert({
    event_name: 'subscription.sandbox_reconciled',
    barberia_id: SANDBOX_BILLING.tenantId,
    suscripcion_id: subscription.id,
    dedupe_key: `sandbox-reconcile:${SANDBOX_BILLING.provider}:${preapprovalId}`,
    payload: { ...externalMetadata, normalized_status: normalizedStatus, provider_event_id: providerEventId },
  }, { onConflict: 'dedupe_key' })
  if (auditError) throw Object.assign(new Error('La reconciliación terminó sin auditoría completa.'), { status: 502, code: 'sandbox_audit_failed' })

  return json({
    provider: SANDBOX_BILLING.provider,
    environment: SANDBOX_BILLING.environment,
    tenant_id: SANDBOX_BILLING.tenantId,
    plan_codigo: SANDBOX_BILLING.planCode,
    external_plan_id: SANDBOX_BILLING.externalPlanId,
    preapproval_id: preapprovalId,
    status: external.status,
    normalized_status: normalizedStatus,
    application_id: external.applicationId,
    collector_id: external.collectorId,
    payer_id: external.payerId,
    external_reference: external.externalReference,
    transition,
    idempotent: Boolean(transition?.idempotent || existingForSubscription?.external_subscription_id === preapprovalId),
    reconciled_at: now,
  })
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error('Sandbox reconciliation failed.'), { stage })
  }
}

async function configurationStatus(admin: ReturnType<typeof adminClient>, userId: string) {
  const role = await platformRole(admin, userId)
  if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
  const { data: providerRow } = await admin.from('saas_proveedores_pago').select('activo, entorno').eq('codigo', 'mercadopago').maybeSingle()
  const checkout = providerConfigured('mercadopago', 'checkout')
  const webhook = providerConfigured('mercadopago', 'webhook')
  const credential = mercadoPagoCredentialStatus()
  const appBaseUrlConfigured = /^https:\/\//i.test(String(Deno.env.get('APP_BASE_URL') || '').trim())
  let externalPlanCheck: Record<string, unknown> = { configured: false, reachable: false }
  const { data: sandboxPrice } = await admin.from('saas_plan_precios').select('external_plan_id, importe, moneda, periodicidad, entorno, pais_codigo, activo, habilitado').eq('id', 1).eq('plan_codigo', 'starter').eq('proveedor_codigo', 'mercadopago').maybeSingle()
  let sandboxTokenValid = false
  let currentTokenUser: { id: number | null; countryId: string | null } | null = null
  if (credential.configured && sandboxPrice?.external_plan_id && sandboxPrice.entorno === 'sandbox' && sandboxPrice.activo) {
    try {
      const currentUser = await mercadoPagoCurrentUser()
      currentTokenUser = { id: currentUser.id, countryId: currentUser.countryId }
      sandboxTokenValid = currentUser.id === EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID
      if (sandboxTokenValid) {
        const external = await mercadoPagoPlanDetails(String(sandboxPrice.external_plan_id))
        externalPlanCheck = {
          configured: true,
          reachable: true,
          plan_id: external.id,
          application_id: external.applicationId,
          collector_id: external.collectorId,
          status: external.status,
          amount: external.amount,
          currency: external.currency,
          periodicity: external.frequency === 12 && external.frequencyType === 'months' ? 'yearly' : external.frequencyType === 'months' ? 'monthly' : null,
          current_token_user_id: currentUser.id,
          current_token_country_id: currentUser.countryId,
          seller_matches_current_token: Boolean(external.collectorId && currentUser.id && external.collectorId === currentUser.id),
          expected_sandbox_seller_id: EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID,
          matches_internal_price: external.amount === Number(sandboxPrice.importe) && external.currency === String(sandboxPrice.moneda).toUpperCase(),
          sanitized_response: external.raw,
        }
      } else {
        externalPlanCheck = { configured: true, reachable: false, current_token_user_id: currentUser.id, expected_sandbox_seller_id: EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID, error_code: 'sandbox_seller_mismatch' }
      }
      console.log(JSON.stringify({
        code: 'sandbox_external_plan_check',
        plan_id: externalPlanCheck.plan_id,
        application_id: externalPlanCheck.application_id,
        collector_id: externalPlanCheck.collector_id,
        current_token_user_id: externalPlanCheck.current_token_user_id,
        seller_matches_current_token: externalPlanCheck.seller_matches_current_token,
        matches_internal_price: externalPlanCheck.matches_internal_price,
      }))
    } catch (error) {
      externalPlanCheck = {
        configured: true,
        reachable: false,
        current_token_user_id: currentTokenUser?.id || null,
        expected_sandbox_seller_id: EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID,
        error_code: error?.code || 'external_plan_check_failed',
        provider_code: error?.providerCode || null,
        provider_status: Number.isSafeInteger(error?.status) ? error.status : null,
        provider_payload: error?.providerPayload || null,
      }
      if (sandboxTokenValid) {
        try {
          externalPlanCheck.subscription_search = await mercadoPagoPreapprovalSearch(String(sandboxPrice.external_plan_id))
        } catch (searchError) {
          externalPlanCheck.subscription_search_error = {
            error_code: searchError?.code || 'subscription_search_failed',
            provider_code: searchError?.providerCode || null,
            provider_status: Number.isSafeInteger(searchError?.status) ? searchError.status : null,
            provider_payload: searchError?.providerPayload || null,
          }
        }
      }
      console.error(JSON.stringify({ code: 'sandbox_external_plan_check_failed', error_code: externalPlanCheck.error_code, provider_code: externalPlanCheck.provider_code, provider_status: externalPlanCheck.provider_status }))
    }
    if (sandboxTokenValid && sandboxPrice?.external_plan_id && !externalPlanCheck.subscription_search) {
      console.log(JSON.stringify({
        code: 'sandbox_subscription_search_begin',
        plan_id: String(sandboxPrice.external_plan_id),
        token_user_id: currentTokenUser?.id || null,
      }))
      try {
        externalPlanCheck.subscription_search = await mercadoPagoPreapprovalSearch(String(sandboxPrice.external_plan_id))
        const firstPreapprovalId = externalPlanCheck.subscription_search?.results?.[0]?.id
        if (firstPreapprovalId) {
          try {
            externalPlanCheck.subscription_details = await mercadoPagoPreapprovalDetails(String(firstPreapprovalId))
          } catch (detailError) {
            externalPlanCheck.subscription_details_error = {
              error_code: detailError?.code || 'subscription_detail_failed',
              provider_code: detailError?.providerCode || null,
              provider_status: Number.isSafeInteger(detailError?.status) ? detailError.status : null,
              provider_payload: detailError?.providerPayload || null,
            }
          }
        }
        console.log(JSON.stringify({
          code: 'sandbox_subscription_search_finished',
          plan_id: String(sandboxPrice.external_plan_id),
          paging: externalPlanCheck.subscription_search?.paging || null,
          results: externalPlanCheck.subscription_search?.results || [],
          subscription_details: externalPlanCheck.subscription_details || null,
          subscription_details_error: externalPlanCheck.subscription_details_error || null,
        }))
      } catch (searchError) {
        externalPlanCheck.subscription_search_error = {
          error_code: searchError?.code || 'subscription_search_failed',
          provider_code: searchError?.providerCode || null,
          provider_status: Number.isSafeInteger(searchError?.status) ? searchError.status : null,
          provider_payload: searchError?.providerPayload || null,
        }
        console.error(JSON.stringify({ code: 'sandbox_subscription_search_failed', error_code: externalPlanCheck.subscription_search_error.error_code, provider_code: externalPlanCheck.subscription_search_error.provider_code, provider_status: externalPlanCheck.subscription_search_error.provider_status, provider_payload: externalPlanCheck.subscription_search_error.provider_payload || null, provider_message: String(searchError?.message || '').replace(/(?:TEST|APP_USR)-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 180) || null }))
      }
    }
    if (externalPlanCheck.subscription_search) {
      console.log(JSON.stringify({
        code: 'sandbox_subscription_search',
        plan_id: externalPlanCheck.plan_id,
        paging: externalPlanCheck.subscription_search.paging,
        results: externalPlanCheck.subscription_search.results,
      }))
    }
  } else if (credential.configured) {
    // Even before a plan is mapped, validate the seller identity. This keeps
    // the status endpoint honest for APP_USR credentials and never trusts a
    // token prefix.
    try {
      const currentUser = await mercadoPagoCurrentUser()
      sandboxTokenValid = currentUser.id === EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID
      externalPlanCheck = { configured: true, reachable: false, current_token_user_id: currentUser.id, expected_sandbox_seller_id: EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID, error_code: sandboxTokenValid ? 'external_plan_not_configured' : 'sandbox_seller_mismatch' }
    } catch (error) {
      externalPlanCheck = { configured: true, reachable: false, error_code: error?.code || 'sandbox_identity_check_failed' }
    }
  }
  const productionReadiness = mercadoPagoProductionReadiness()
  return json({
    provider: 'mercadopago',
    environment: 'sandbox',
    production_enabled: false,
    database_enabled: Boolean(providerRow?.activo && providerRow?.entorno === 'sandbox'),
    token_configured: checkout.configured,
    token_kind: credential.kind,
    sandbox_token_valid: sandboxTokenValid,
    webhook_secret_configured: webhook.configured,
    app_base_url_configured: appBaseUrlConfigured,
    missing_for_checkout: [...checkout.missing, ...(appBaseUrlConfigured ? [] : ['APP_BASE_URL'])],
    missing_for_webhook: webhook.missing,
    production_checkout_ready: productionReadiness.ready,
    production_readiness: {
      ready: productionReadiness.ready,
      environment: productionReadiness.environment || 'missing',
      project_environment: productionReadiness.projectEnvironment || 'missing',
      api_base_configured: productionReadiness.apiBaseConfigured,
      pilot_tenant_id: productionReadiness.pilotTenantId,
      allowlisted_tenant_count: productionReadiness.allowlistedTenantCount,
      plan_configured: productionReadiness.planConfigured,
      missing: productionReadiness.missing,
    },
    external_plan_check: externalPlanCheck,
  })
}

async function verifyProductionProviderIdentity(admin: ReturnType<typeof adminClient>, userId: string) {
  const role = await platformRole(admin, userId)
  if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
  try {
    const identity = await mercadoPagoProductionIdentity()
    const configuredApplicationId = Number(Deno.env.get('MERCADOPAGO_PRODUCTION_APPLICATION_ID'))
    const applicationConfigured = Number.isSafeInteger(configuredApplicationId) && configuredApplicationId > 0
    const configuredPlanId = String(Deno.env.get('MERCADOPAGO_PRODUCTION_PLAN_ID') || '').trim()
    let verifiedPlan: Awaited<ReturnType<typeof mercadoPagoProductionPlanDetails>> | null = null
    let planVerificationError: string | null = null
    if (configuredPlanId) {
      try {
        verifiedPlan = await mercadoPagoProductionPlanDetails(configuredPlanId)
      } catch (error) {
        planVerificationError = error?.code || 'production_plan_verification_failed'
      }
    }
    const applicationVerified = Boolean(
      applicationConfigured
      && verifiedPlan
      && verifiedPlan.applicationId === configuredApplicationId
      && verifiedPlan.collectorId === identity.sellerId,
    )
    return json({
      ok: true,
      provider: 'mercadopago',
      environment: 'production',
      token_valid: true,
      seller_id: identity.sellerId,
      collector_id: identity.collectorId,
      site_id: identity.siteId,
      country_id: identity.countryId,
      seller_verified: identity.sellerVerified,
      application_id: verifiedPlan?.applicationId || (applicationConfigured ? configuredApplicationId : null),
      application_verified: applicationVerified,
      application_verification: applicationVerified ? 'verified_from_authoritative_plan' : applicationConfigured ? 'configured_not_verified' : 'APPLICATION_ID_UNVERIFIED',
      plan_id: verifiedPlan?.id || configuredPlanId || null,
      plan_verified: Boolean(verifiedPlan),
      plan_status: verifiedPlan?.status || null,
      plan_verification_error: planVerificationError,
      production_checkout_ready: false,
      production_enabled: false,
      financial_writes: 0,
    })
  } catch (error) {
    return json({
      ok: false,
      provider: 'mercadopago',
      environment: 'production',
      token_valid: false,
      seller_id: null,
      collector_id: null,
      application_id: null,
      application_verified: false,
      application_verification: 'APPLICATION_ID_UNVERIFIED',
      production_checkout_ready: false,
      production_enabled: false,
      financial_writes: 0,
      error_code: error?.code || 'production_identity_check_failed',
    }, error?.status || 502)
  }
}

function requirePlatformBillingAdmin(admin: ReturnType<typeof adminClient>, userId: string) {
  return platformRole(admin, userId).then((role) => {
    if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
    return role
  })
}

async function productionPlanSearch(admin: ReturnType<typeof adminClient>, userId: string) {
  await requirePlatformBillingAdmin(admin, userId)
  const result = await mercadoPagoProductionPlanSearch()
  return json({
    ok: true,
    provider: PRODUCTION_PILOT.provider,
    environment: PRODUCTION_PILOT.environment,
    token_valid: true,
    seller_id: result.identity.sellerId,
    collector_id: result.identity.collectorId,
    candidates: result.candidates,
    compatible_candidates: result.compatible,
    contract: {
      reason: 'Austral Starter',
      amount: PRODUCTION_PILOT.amount,
      currency: PRODUCTION_PILOT.currency,
      frequency: 1,
      frequency_type: 'months',
    },
    financial_writes: 0,
  })
}

function productionAllowlistStatus(tenantId: number) {
  const configuredPilot = Number(Deno.env.get('BILLING_PRODUCTION_PILOT_TENANT_ID'))
  const allowlisted = String(Deno.env.get('BILLING_PRODUCTION_ALLOWED_TENANT_IDS') || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0)
  return {
    configured: Number.isSafeInteger(configuredPilot) && configuredPilot === tenantId && allowlisted.length === 1 && allowlisted[0] === tenantId,
    required: ['BILLING_PRODUCTION_PILOT_TENANT_ID', 'BILLING_PRODUCTION_ALLOWED_TENANT_IDS'],
  }
}

async function prepareProductionPilot(admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  await requirePlatformBillingAdmin(admin, userId)
  if (body.confirm !== 'PREPARE_PRODUCTION_PILOT_ONLY') throw Object.assign(new Error('Se requiere la confirmación técnica del piloto sin checkout.'), { status: 422, code: 'production_pilot_confirmation_required' })

  const identity = await mercadoPagoProductionIdentity()
  if (identity.sellerId !== 1334909095) throw Object.assign(new Error('La credencial no pertenece al vendedor productivo autorizado.'), { status: 409, code: 'production_seller_mismatch' })

  // Search first. Multiple compatible plans are an explicit stop condition;
  // never choose arbitrarily and never create a second plan in that case.
  const searched = await mercadoPagoProductionPlanSearch()
  if (searched.compatible.length > 1) throw Object.assign(new Error('Existen varios planes productivos compatibles; revisión manual requerida.'), { status: 409, code: 'production_plan_ambiguous' })
  const plan = searched.compatible[0] || await mercadoPagoCreateProductionPlan()
  if (!plan?.id) throw Object.assign(new Error('Mercado Pago no devolvió un plan productivo verificable.'), { status: 502, code: 'production_plan_missing' })
  const verifiedPlan = await mercadoPagoProductionPlanDetails(plan.id)
  if (!verifiedPlan.applicationId || verifiedPlan.collectorId !== 1334909095) throw Object.assign(new Error('El plan productivo no coincide con la identidad autorizada.'), { status: 409, code: 'production_plan_identity_mismatch' })

  let createdTenantId: number | null = null
  let createdPriceId: number | null = null
  let createdSubscriptionId: number | null = null
  try {
    const { data: allTenants, error: tenantsError } = await admin.from('barberias').select('id, nombre, slug, metadata').order('id')
    if (tenantsError) throw Object.assign(new Error('No se pudo revisar los tenants productivos.'), { status: 502, code: 'production_tenant_lookup_failed' })
    const pilots = (allTenants || []).filter((tenant) => tenant?.metadata?.production_billing_pilot === true)
    if (pilots.length > 1) throw Object.assign(new Error('Existen varios tenants piloto productivos; revisión manual requerida.'), { status: 409, code: 'production_pilot_ambiguous' })
    const slugConflict = (allTenants || []).find((tenant) => tenant.slug === PRODUCTION_PILOT.slug && tenant?.metadata?.production_billing_pilot !== true)
    if (slugConflict) throw Object.assign(new Error('El slug reservado del piloto ya está ocupado.'), { status: 409, code: 'production_pilot_slug_conflict' })

    let pilot = pilots[0] || null
    if (pilot && [1, 5, SANDBOX_BILLING.tenantId].includes(Number(pilot.id))) throw Object.assign(new Error('El tenant piloto coincide con un tenant protegido.'), { status: 409, code: 'protected_tenant' })
    if (pilot) {
      const metadata = pilot.metadata && typeof pilot.metadata === 'object' ? pilot.metadata as Record<string, unknown> : {}
      if (metadata.environment !== PRODUCTION_PILOT.environment || metadata.technical !== true) throw Object.assign(new Error('El tenant piloto existente no cumple el entorno productivo.'), { status: 409, code: 'production_pilot_metadata_mismatch' })
    } else {
      const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      const { data: insertedTenant, error: tenantInsertError } = await admin.from('barberias').insert({
        nombre: PRODUCTION_PILOT.name,
        slug: PRODUCTION_PILOT.slug,
        vertical: 'custom',
        estado_cuenta: 'trial',
        plan_codigo: PRODUCTION_PILOT.planCode,
        trial_ends_at: trialEnds,
        locale: 'es-AR',
        onboarding_completed: false,
        pais: PRODUCTION_PILOT.country,
        moneda: PRODUCTION_PILOT.currency,
        descripcion: 'Tenant técnico interno para preparar el billing productivo.',
        metadata: {
          purpose: 'production_billing_pilot',
          production_billing_pilot: true,
          technical: true,
          environment: PRODUCTION_PILOT.environment,
          billing_provider: PRODUCTION_PILOT.provider,
          billing_plan: PRODUCTION_PILOT.planCode,
          billing_enabled: false,
          external_plan_id: verifiedPlan.id,
          collector_id: verifiedPlan.collectorId,
          application_id: verifiedPlan.applicationId,
        },
      }).select('id, nombre, slug, metadata').single()
      if (tenantInsertError || !insertedTenant) throw Object.assign(new Error('No se pudo crear el tenant piloto productivo.'), { status: 502, code: 'production_pilot_create_failed' })
      pilot = insertedTenant
      createdTenantId = Number(insertedTenant.id)
    }

    const tenantId = Number(pilot.id)
    const { data: prices, error: pricesError } = await admin.from('saas_plan_precios').select('id, plan_codigo, proveedor_codigo, pais_codigo, moneda, importe, periodicidad, entorno, external_plan_id, habilitado, activo').eq('plan_codigo', PRODUCTION_PILOT.planCode).eq('proveedor_codigo', PRODUCTION_PILOT.provider).eq('pais_codigo', PRODUCTION_PILOT.country).eq('entorno', PRODUCTION_PILOT.environment)
    if (pricesError) throw Object.assign(new Error('No se pudo revisar el precio productivo.'), { status: 502, code: 'production_price_lookup_failed' })
    if ((prices || []).length > 1) throw Object.assign(new Error('Existen varios precios productivos para Starter ARS; revisión manual requerida.'), { status: 409, code: 'production_price_ambiguous' })
    let price = prices?.[0] || null
    if (price && (String(price.external_plan_id || '') !== verifiedPlan.id || String(price.moneda).toUpperCase() !== PRODUCTION_PILOT.currency || Number(price.importe) !== PRODUCTION_PILOT.amount || price.periodicidad !== PRODUCTION_PILOT.periodicity)) throw Object.assign(new Error('El precio productivo existente no coincide con el contrato.'), { status: 409, code: 'production_price_mismatch' })
    if (!price) {
      const { data: insertedPrice, error: priceInsertError } = await admin.from('saas_plan_precios').insert({
        plan_codigo: PRODUCTION_PILOT.planCode,
        proveedor_codigo: PRODUCTION_PILOT.provider,
        pais_codigo: PRODUCTION_PILOT.country,
        moneda: PRODUCTION_PILOT.currency,
        importe: PRODUCTION_PILOT.amount,
        periodicidad: PRODUCTION_PILOT.periodicity,
        entorno: PRODUCTION_PILOT.environment,
        external_plan_id: verifiedPlan.id,
        habilitado: false,
        activo: true,
        metadata: { environment: PRODUCTION_PILOT.environment, technical_pilot: true, collector_id: verifiedPlan.collectorId, application_id: verifiedPlan.applicationId, checkout_enabled: false },
      }).select('id, plan_codigo, proveedor_codigo, pais_codigo, moneda, importe, periodicidad, entorno, external_plan_id, habilitado, activo').single()
      if (priceInsertError || !insertedPrice) throw Object.assign(new Error('No se pudo crear el precio productivo.'), { status: 502, code: 'production_price_create_failed' })
      price = insertedPrice
      createdPriceId = Number(insertedPrice.id)
    }

    const { data: subscriptions, error: subscriptionsError } = await admin.from('saas_suscripciones').select('id, barberia_id, plan_codigo, estado, provider_subscription_id').eq('barberia_id', tenantId)
    if (subscriptionsError) throw Object.assign(new Error('No se pudo revisar la suscripción interna del piloto.'), { status: 502, code: 'production_subscription_lookup_failed' })
    if ((subscriptions || []).length > 1) throw Object.assign(new Error('El tenant piloto tiene varias suscripciones internas; revisión manual requerida.'), { status: 409, code: 'production_subscription_ambiguous' })
    let subscription = subscriptions?.[0] || null
    if (subscription && (subscription.plan_codigo !== PRODUCTION_PILOT.planCode || subscription.provider_subscription_id)) throw Object.assign(new Error('La suscripción interna del piloto no está en estado de preparación.'), { status: 409, code: 'production_subscription_mismatch' })
    if (!subscription) {
      const trialStarted = new Date().toISOString()
      const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
      const { data: insertedSubscription, error: subscriptionInsertError } = await admin.from('saas_suscripciones').insert({ barberia_id: tenantId, plan_codigo: PRODUCTION_PILOT.planCode, estado: 'trialing', trial_started_at: trialStarted, trial_ends_at: trialEnds, provider: null, precio: PRODUCTION_PILOT.amount, moneda: PRODUCTION_PILOT.currency, periodicidad: PRODUCTION_PILOT.periodicity, metadata: { environment: PRODUCTION_PILOT.environment, technical_pilot: true, price_id: price.id, external_plan_id: verifiedPlan.id, billing_enabled: false } }).select('id, barberia_id, plan_codigo, estado, provider_subscription_id').single()
      if (subscriptionInsertError || !insertedSubscription) throw Object.assign(new Error('No se pudo crear la suscripción interna de trial del piloto.'), { status: 502, code: 'production_subscription_create_failed' })
      subscription = insertedSubscription
      createdSubscriptionId = Number(insertedSubscription.id)
    }

    const existingMetadata = pilot.metadata && typeof pilot.metadata === 'object' ? pilot.metadata as Record<string, unknown> : {}
    const { error: tenantUpdateError } = await admin.from('barberias').update({ metadata: { ...existingMetadata, production_billing_pilot: true, technical: true, environment: PRODUCTION_PILOT.environment, billing_provider: PRODUCTION_PILOT.provider, billing_plan: PRODUCTION_PILOT.planCode, billing_enabled: false, price_id: price.id, external_plan_id: verifiedPlan.id, collector_id: verifiedPlan.collectorId, application_id: verifiedPlan.applicationId } }).eq('id', tenantId)
    if (tenantUpdateError) throw Object.assign(new Error('No se pudo completar la metadata del tenant piloto.'), { status: 502, code: 'production_pilot_update_failed' })

    return json({
      ok: true,
      provider: PRODUCTION_PILOT.provider,
      environment: PRODUCTION_PILOT.environment,
      production_enabled: false,
      checkout_enabled: false,
      plan: { external_plan_id: verifiedPlan.id, collector_id: verifiedPlan.collectorId, application_id: verifiedPlan.applicationId, status: verifiedPlan.status, amount: verifiedPlan.amount, currency: verifiedPlan.currency, frequency: verifiedPlan.frequency, frequency_type: verifiedPlan.frequencyType },
      pilot_tenant: { id: tenantId, name: pilot.nombre, slug: pilot.slug },
      price: { id: price.id, plan_codigo: price.plan_codigo, proveedor_codigo: price.proveedor_codigo, pais_codigo: price.pais_codigo, moneda: price.moneda, importe: price.importe, periodicidad: price.periodicidad, entorno: price.entorno, external_plan_id: price.external_plan_id, habilitado: price.habilitado, activo: price.activo },
      subscription: { id: subscription.id, estado: subscription.estado, provider_subscription_id: subscription.provider_subscription_id || null },
      allowlist: productionAllowlistStatus(tenantId),
      financial_writes: 0,
      external_financial_writes: 0,
      manual_configuration_required: ['MERCADOPAGO_PRODUCTION_APPLICATION_ID', 'BILLING_PRODUCTION_PILOT_TENANT_ID', 'BILLING_PRODUCTION_ALLOWED_TENANT_IDS'],
    })
  } catch (error) {
    // Compensate only rows created by this invocation. The external plan is
    // intentionally preserved for audit/reuse if a later database step fails.
    if (createdSubscriptionId) await admin.from('saas_suscripciones').delete().eq('id', createdSubscriptionId)
    if (createdPriceId) await admin.from('saas_plan_precios').delete().eq('id', createdPriceId)
    if (createdTenantId) await admin.from('barberias').delete().eq('id', createdTenantId)
    throw error
  }
}

Deno.serve(async (request) => {
  const correlationId = requestId(request)
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    const admin = adminClient()
    const user = await authenticate(request, admin)
    const url = new URL(request.url)
    const route = url.pathname.split('/').filter(Boolean).pop() || 'status'
    if (request.method === 'GET' && route === 'status') {
      const tenantId = await ownerTenant(admin, user.id)
      const { data, error } = await admin.rpc('get_billing_portal', { p_barberia_id: tenantId })
      if (error) {
        // La ausencia de suscripción es un estado comercial válido durante
        // un onboarding incompleto; no debe confundirse con una caída técnica.
        if (error.code === 'P0002') throw Object.assign(new Error('La cuenta todavía no tiene una suscripción.'), { status: 409, code: 'subscription_missing' })
        throw Object.assign(new Error('No se pudo consultar facturación.'), { status: 502, code: 'billing_status_failed' })
      }
      return json(data)
    }
    if (request.method === 'GET' && route === 'config-status') return await configurationStatus(admin, user.id)
    if (request.method === 'GET' && route === 'verify-production-provider-identity') return await verifyProductionProviderIdentity(admin, user.id)
    if (request.method === 'GET' && route === 'production-plan-search') return await productionPlanSearch(admin, user.id)
    const body = await readJson(request)
    if (request.method === 'POST' && route === 'prepare-production-pilot') return await prepareProductionPilot(admin, user.id, body)
    if (request.method === 'POST' && route === 'checkout') return await checkout(request, admin, user.id, body)
    if (request.method === 'POST' && route === 'subscription') return await productionSubscription(request, admin, user.id, body)
    if (request.method === 'POST' && route === 'external-status') return await externalStatus(admin, user.id, body)
    if (request.method === 'POST' && route === 'sync-plans') return await syncPlans(request, admin, user.id, body)
    if (request.method === 'POST' && route === 'reconcile-sandbox') return await reconcileSandboxPreapproval(request, admin, user.id, body)
    if (request.method === 'POST' && route === 'reconcile') return await reconcile(admin, user.id, body)
    return errorJson('Ruta de billing inexistente.', 404, 'route_not_found')
  } catch (error) {
    console.error(JSON.stringify({ correlation_id: correlationId, code: error?.code || 'billing_api_error', stage: error?.stage || null, message: String(error?.message || '').replace(/(?:TEST|APP_USR)-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 180) || null, provider_status: Number.isSafeInteger(error?.status) ? error.status : null, provider_code: error?.providerCode || null, provider_detail: error?.providerDetail || null }))
    return errorJson(error?.message || 'Error temporal de billing.', error?.status || 500, error?.code || 'billing_api_error')
  }
})
