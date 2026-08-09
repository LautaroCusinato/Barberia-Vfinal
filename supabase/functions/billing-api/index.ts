import { adminClient, authenticate, ownerTenant, platformRole, requestClient } from '../_shared/supabase.ts'
import { corsHeaders, errorJson, json, readJson, requestId } from '../_shared/http.ts'
import { EXPECTED_MERCADO_PAGO_SANDBOX_SELLER_ID, mercadoPago, mercadoPagoCredentialStatus, mercadoPagoCurrentUser, mercadoPagoExternalStatus, mercadoPagoPlanDetails, paypal, paypalExternalStatus, providerConfigured, syncMercadoPagoPlan, syncPayPalPlan } from '../_shared/providers.ts'

const PROVIDERS = new Set(['mercadopago', 'paypal'])

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

async function checkoutTenant(admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  // Platform owners/admins may exercise billing against an isolated technical
  // tenant without becoming a member of it. This is deliberately restricted
  // to rows explicitly marked as sandbox, so production tenants can never be
  // selected through this escape hatch.
  if (body.tenant_id != null) {
    const role = await platformRole(admin, userId)
    if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
    const tenantId = Number(body.tenant_id)
    if (!Number.isSafeInteger(tenantId) || tenantId <= 0) throw Object.assign(new Error('Tenant sandbox inválido.'), { status: 422, code: 'invalid_sandbox_tenant' })
    const { data: tenant, error } = await admin.from('barberias').select('id, metadata').eq('id', tenantId).maybeSingle()
    if (error) throw Object.assign(new Error('No se pudo resolver el tenant sandbox.'), { status: 500, code: 'tenant_lookup_failed' })
    const metadata = tenant?.metadata && typeof tenant.metadata === 'object' ? tenant.metadata as Record<string, unknown> : {}
    if (!tenant || metadata.environment !== 'sandbox' || metadata.technical !== true) throw Object.assign(new Error('Solo se permiten tenants técnicos marcados como sandbox.'), { status: 403, code: 'sandbox_tenant_required' })
    return tenantId
  }
  return ownerTenant(admin, userId)
}

async function checkout(request: Request, admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  const tenantId = await checkoutTenant(admin, userId, body)
  const planCode = String(body.plan_codigo || '').trim().toLowerCase()
  const provider = String(body.proveedor_codigo || '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(planCode)) throw Object.assign(new Error('Plan inválido.'), { status: 422, code: 'invalid_plan' })
  if (!PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })

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

async function syncPlans(request: Request, admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  const role = await platformRole(admin, userId)
  if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
  const provider = String(body.proveedor_codigo || '').trim().toLowerCase()
  if (!PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })
  const planCode = String(body.plan_codigo || '').trim().toLowerCase()
  const requestedTenantId = body.tenant_id == null ? 6 : Number(body.tenant_id)
  if (provider === 'mercadopago' && (requestedTenantId !== 6 || planCode !== 'starter')) throw Object.assign(new Error('Mercado Pago sandbox solo permite sincronizar starter del tenant tecnico #6.'), { status: 403, code: 'sandbox_scope_required' })
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(planCode)) throw Object.assign(new Error('Para sincronizar se debe indicar un único plan válido.'), { status: 422, code: 'invalid_plan' })
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
  const tenantId = await checkoutTenant(admin, userId, body)
  const requestedAttempt = body.checkout_attempt_id == null ? null : Number(body.checkout_attempt_id)
  if (requestedAttempt !== null && (!Number.isSafeInteger(requestedAttempt) || requestedAttempt <= 0)) throw Object.assign(new Error('Intento de checkout inválido.'), { status: 422, code: 'invalid_checkout_attempt' })
  const provider = body.proveedor_codigo ? String(body.proveedor_codigo).trim().toLowerCase() : null
  if (provider && !PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })
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
  if (credential.configured && sandboxPrice?.external_plan_id && sandboxPrice.entorno === 'sandbox' && sandboxPrice.activo) {
    try {
      const currentUser = await mercadoPagoCurrentUser()
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
      externalPlanCheck = { configured: true, reachable: false, error_code: error?.code || 'external_plan_check_failed' }
      console.error(JSON.stringify({ code: 'sandbox_external_plan_check_failed', error_code: externalPlanCheck.error_code }))
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
    external_plan_check: externalPlanCheck,
  })
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
      if (error) throw Object.assign(new Error('No se pudo consultar facturación.'), { status: 502, code: 'billing_status_failed' })
      return json(data)
    }
    if (request.method === 'GET' && route === 'config-status') return await configurationStatus(admin, user.id)
    const body = await readJson(request)
    if (request.method === 'POST' && route === 'checkout') return await checkout(request, admin, user.id, body)
    if (request.method === 'POST' && route === 'external-status') return await externalStatus(admin, user.id, body)
    if (request.method === 'POST' && route === 'sync-plans') return await syncPlans(request, admin, user.id, body)
    if (request.method === 'POST' && route === 'reconcile') return await reconcile(admin, user.id, body)
    return errorJson('Ruta de billing inexistente.', 404, 'route_not_found')
  } catch (error) {
    console.error(JSON.stringify({ correlation_id: correlationId, code: error?.code || 'billing_api_error', provider_status: Number.isSafeInteger(error?.status) ? error.status : null, provider_code: error?.providerCode || null, provider_detail: error?.providerDetail || null }))
    return errorJson(error?.message || 'Error temporal de billing.', error?.status || 500, error?.code || 'billing_api_error')
  }
})
