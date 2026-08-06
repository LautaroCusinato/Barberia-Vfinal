import { adminClient, authenticate, ownerTenant, platformRole } from '../_shared/supabase.ts'
import { errorJson, json, readJson, requestId } from '../_shared/http.ts'
import { mercadoPago, paypal, providerConfigured, syncMercadoPagoPlan, syncPayPalPlan } from '../_shared/providers.ts'

const PROVIDERS = new Set(['mercadopago', 'paypal'])

function providerFunction(provider: string) {
  if (provider === 'mercadopago') return mercadoPago
  if (provider === 'paypal') return paypal
  throw Object.assign(new Error('Proveedor no soportado.'), { status: 422, code: 'unsupported_provider' })
}

async function checkout(request: Request, admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  const tenantId = await ownerTenant(admin, userId)
  const planCode = String(body.plan_codigo || '').trim().toLowerCase()
  const provider = String(body.proveedor_codigo || '').trim().toLowerCase()
  if (!/^[a-z][a-z0-9_-]{1,39}$/.test(planCode)) throw Object.assign(new Error('Plan inválido.'), { status: 422, code: 'invalid_plan' })
  if (!PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })

  const [{ data: providerRow }, { data: planProvider }, { data: tenant }] = await Promise.all([
    admin.from('saas_proveedores_pago').select('codigo, activo, entorno').eq('codigo', provider).maybeSingle(),
    admin.from('saas_plan_proveedores').select('external_plan_id, external_product_id, habilitado').eq('plan_codigo', planCode).eq('proveedor_codigo', provider).maybeSingle(),
    admin.from('barberias').select('id, nombre, billing_email').eq('id', tenantId).single(),
  ])
  if (!providerRow) throw Object.assign(new Error('Proveedor no registrado.'), { status: 422, code: 'provider_not_registered' })
  if (!providerRow.activo) throw Object.assign(new Error('El proveedor sandbox todavía no está habilitado.'), { status: 409, code: 'provider_disabled' })
  const config = providerConfigured(provider as 'mercadopago' | 'paypal')
  if (!config.configured) throw Object.assign(new Error('Faltan variables privadas del proveedor sandbox.'), { status: 503, code: 'provider_not_configured' })

  const { data: existing } = await admin.from('saas_billing_checkout_attempts').select('id, estado, checkout_url').eq('barberia_id', tenantId).eq('plan_codigo', planCode).eq('proveedor_codigo', provider).in('estado', ['created', 'pending_provider', 'ready']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (existing?.id && existing.estado === 'ready' && existing.checkout_url) return json({ checkout_attempt_id: existing.id, status: 'ready', checkout_url: existing.checkout_url, idempotent: true })

  const { data: intent, error: intentError } = await admin.rpc('create_billing_checkout_intent', { p_barberia_id: tenantId, p_plan_codigo: planCode, p_proveedor_codigo: provider, p_idempotency_key: `edge-${crypto.randomUUID()}` })
  if (intentError) {
    const { data: concurrent } = await admin.from('saas_billing_checkout_attempts').select('id, estado, checkout_url').eq('barberia_id', tenantId).eq('plan_codigo', planCode).eq('proveedor_codigo', provider).in('estado', ['created', 'pending_provider', 'ready']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (concurrent?.id && concurrent.checkout_url) return json({ checkout_attempt_id: concurrent.id, status: 'ready', checkout_url: concurrent.checkout_url, idempotent: true })
    if (concurrent?.id) return json({ checkout_attempt_id: concurrent.id, status: concurrent.estado, checkout_url: null, idempotent: true }, 202)
    throw Object.assign(new Error('No se pudo preparar el checkout.'), { status: 502, code: 'checkout_intent_failed' })
  }
  if (!intent?.checkout_attempt_id) throw Object.assign(new Error('El checkout no devolvió un intento válido.'), { status: 502, code: 'checkout_intent_invalid' })
  const { data: plan } = await admin.from('saas_planes').select('codigo, nombre, descripcion, precio_mensual, moneda, periodicidad').eq('codigo', planCode).single()
  if (!plan || !tenant) throw Object.assign(new Error('Plan o tenant inexistente.'), { status: 404, code: 'billing_context_missing' })
  const reference = `billing:${intent.checkout_attempt_id}:${crypto.randomUUID()}`
  const baseUrl = Deno.env.get('APP_BASE_URL') || new URL(request.url).origin
  const webhookUrl = `${Deno.env.get('SUPABASE_URL') || new URL(request.url).origin}/functions/v1/billing-webhooks/${provider}`
  const create = providerFunction(provider)
  try {
    const result = await create({ externalPlanId: planProvider?.external_plan_id || null, email: tenant.billing_email, tenantReference: reference, planName: plan.nombre, amount: Number(plan.precio_mensual), currency: plan.moneda, successUrl: `${baseUrl}/facturacion?billing=success`, cancelUrl: `${baseUrl}/facturacion?billing=cancel`, webhookUrl })
    if (!result.checkoutUrl) throw Object.assign(new Error('El proveedor no devolvió URL de aprobación.'), { status: 502, code: 'approval_url_missing' })
    await admin.from('saas_billing_checkout_attempts').update({ estado: 'ready', checkout_url: result.checkoutUrl, external_checkout_id: result.externalId, metadata: { tenant_reference: reference, provider_kind: result.kind } }).eq('id', intent.checkout_attempt_id)
    if (result.kind === 'subscription' && result.externalId) {
      const { data: subscription } = await admin.from('saas_suscripciones').select('id').eq('barberia_id', tenantId).single()
      if (subscription) {
        await admin.from('saas_suscripciones_externas').upsert({ suscripcion_id: subscription.id, barberia_id: tenantId, proveedor_codigo: provider, external_subscription_id: result.externalId, external_plan_id: planProvider?.external_plan_id || null, estado_externo: 'pending', metadata: { reference } }, { onConflict: 'suscripcion_id,proveedor_codigo' })
        await admin.from('saas_suscripciones').update({ provider, provider_subscription_id: result.externalId }).eq('id', subscription.id)
      }
    }
    return json({ checkout_attempt_id: intent.checkout_attempt_id, status: 'ready', checkout_url: result.checkoutUrl })
  } catch (error) {
    await admin.from('saas_billing_checkout_attempts').update({ estado: 'failed', metadata: { tenant_reference: reference, error_code: error?.code || 'provider_error' } }).eq('id', intent.checkout_attempt_id)
    throw error
  }
}

async function syncPlans(request: Request, admin: ReturnType<typeof adminClient>, userId: string, body: Record<string, unknown>) {
  const role = await platformRole(admin, userId)
  if (!['owner', 'admin'].includes(role || '')) throw Object.assign(new Error('Owner/admin de plataforma requerido.'), { status: 403, code: 'platform_admin_required' })
  const provider = String(body.proveedor_codigo || '').trim().toLowerCase()
  if (!PROVIDERS.has(provider)) throw Object.assign(new Error('Proveedor inválido.'), { status: 422, code: 'unsupported_provider' })
  const config = providerConfigured(provider as 'mercadopago' | 'paypal')
  if (!config.configured) throw Object.assign(new Error('Faltan variables privadas del proveedor sandbox.'), { status: 503, code: 'provider_not_configured' })
  const { data: providerRow } = await admin.from('saas_proveedores_pago').select('activo').eq('codigo', provider).single()
  if (!providerRow?.activo) throw Object.assign(new Error('El proveedor está deshabilitado.'), { status: 409, code: 'provider_disabled' })
  const { data: plans } = await admin.from('saas_planes').select('codigo, nombre, descripcion, precio_mensual, moneda, periodicidad').eq('activo', true).order('codigo')
  const results = []
  for (const plan of plans || []) {
    const { data: mapping } = await admin.from('saas_plan_proveedores').select('id, external_plan_id, external_product_id, habilitado').eq('plan_codigo', plan.codigo).eq('proveedor_codigo', provider).single()
    if (mapping?.external_plan_id && mapping.habilitado) { results.push({ plan: plan.codigo, status: 'already_synced' }); continue }
    const result = provider === 'mercadopago'
      ? await syncMercadoPagoPlan({ name: plan.nombre, description: plan.descripcion, amount: Number(plan.precio_mensual), currency: plan.moneda, periodicity: plan.periodicidad })
      : await syncPayPalPlan({ name: plan.nombre, description: plan.descripcion, amount: Number(plan.precio_mensual), currency: plan.moneda, periodicity: plan.periodicidad, externalProductId: mapping?.external_product_id })
    await admin.from('saas_plan_proveedores').update({ external_plan_id: result.externalPlanId, external_product_id: result.externalProductId, habilitado: Boolean(result.externalPlanId), metadata: { synced_at: new Date().toISOString(), environment: 'sandbox' } }).eq('id', mapping.id)
    results.push({ plan: plan.codigo, status: 'synced' })
  }
  return json({ provider, environment: 'sandbox', results })
}

Deno.serve(async (request) => {
  const correlationId = requestId(request)
  try {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 })
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
    const body = await readJson(request)
    if (request.method === 'POST' && route === 'checkout') return await checkout(request, admin, user.id, body)
    if (request.method === 'POST' && route === 'sync-plans') return await syncPlans(request, admin, user.id, body)
    return errorJson('Ruta de billing inexistente.', 404, 'route_not_found')
  } catch (error) {
    console.error(JSON.stringify({ correlation_id: correlationId, code: error?.code || 'billing_api_error' }))
    return errorJson(error?.message || 'Error temporal de billing.', error?.status || 500, error?.code || 'billing_api_error')
  }
})
