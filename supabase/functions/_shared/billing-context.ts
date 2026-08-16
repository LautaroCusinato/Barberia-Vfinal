import { adminClient } from './supabase.ts'

export type BillingEnvironment = 'sandbox' | 'production'

export type TenantBillingBinding = {
  id: number
  barberia_id: number
  proveedor_codigo: string
  entorno: BillingEnvironment
  plan_codigo: string
  precio_id: number
  external_plan_id: string | null
  external_seller_id: number | null
  external_application_id: number | null
  activo: boolean
  checkout_habilitado: boolean
  metadata: Record<string, unknown>
  price?: Record<string, unknown>
}

/**
 * Resolve the billing contract from the tenant/environment binding table.
 * Never falls back to the global provider row: an absent binding is a hard
 * failure so credentials, plans and prices cannot cross environments.
 */
export async function resolveTenantBillingBinding(
  admin: ReturnType<typeof adminClient>,
  tenantId: number,
  provider: string,
  environment: BillingEnvironment,
) {
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw Object.assign(new Error('Tenant de billing inválido.'), { status: 422, code: 'invalid_billing_tenant' })
  }
  if (!['mercadopago', 'paypal'].includes(provider)) {
    throw Object.assign(new Error('Proveedor de billing inválido.'), { status: 422, code: 'invalid_billing_provider' })
  }
  if (!['sandbox', 'production'].includes(environment)) {
    throw Object.assign(new Error('Entorno de billing inválido.'), { status: 422, code: 'invalid_billing_environment' })
  }

  const { data, error } = await admin
    .from('saas_billing_provider_bindings')
    .select('id, barberia_id, proveedor_codigo, entorno, plan_codigo, precio_id, external_plan_id, external_seller_id, external_application_id, activo, checkout_habilitado, metadata')
    .eq('barberia_id', tenantId)
    .eq('proveedor_codigo', provider)
    .eq('entorno', environment)
    .eq('activo', true)
    .maybeSingle()

  if (error) throw Object.assign(new Error('No se pudo resolver el binding de billing.'), { status: 502, code: 'billing_binding_lookup_failed' })
  if (!data) throw Object.assign(new Error('No existe un binding de billing para este tenant y entorno.'), { status: 409, code: 'billing_binding_not_configured' })

  const { data: price, error: priceError } = await admin
    .from('saas_plan_precios')
    .select('id, plan_codigo, proveedor_codigo, pais_codigo, moneda, importe, periodicidad, entorno, external_product_id, external_plan_id, habilitado, activo')
    .eq('id', data.precio_id)
    .eq('plan_codigo', data.plan_codigo)
    .eq('proveedor_codigo', provider)
    .eq('entorno', environment)
    .eq('activo', true)
    .maybeSingle()

  if (priceError) throw Object.assign(new Error('No se pudo validar el precio del binding.'), { status: 502, code: 'billing_price_lookup_failed' })
  if (!price) throw Object.assign(new Error('El precio del binding no está activo o pertenece a otro entorno.'), { status: 409, code: 'billing_price_binding_mismatch' })
  if (data.external_plan_id && price.external_plan_id && data.external_plan_id !== price.external_plan_id) {
    throw Object.assign(new Error('El plan externo del binding no coincide con el precio.'), { status: 409, code: 'billing_external_plan_binding_mismatch' })
  }

  return { ...data, metadata: (data.metadata && typeof data.metadata === 'object' ? data.metadata : {}) as Record<string, unknown>, price } as TenantBillingBinding
}

/**
 * Resolve a binding by provider resource. This is used by webhooks before a
 * tenant is selected, and therefore requires a unique external plan mapping.
 */
export async function resolveBindingByExternalPlan(
  admin: ReturnType<typeof adminClient>,
  provider: string,
  externalPlanId: string,
) {
  const normalized = String(externalPlanId || '').trim()
  if (!normalized) return null
  const { data, error } = await admin
    .from('saas_billing_provider_bindings')
    .select('id, barberia_id, proveedor_codigo, entorno, plan_codigo, precio_id, external_plan_id, external_seller_id, external_application_id, activo, checkout_habilitado, metadata')
    .eq('proveedor_codigo', provider)
    .eq('external_plan_id', normalized)
    .eq('activo', true)
    .limit(2)
  if (error) throw Object.assign(new Error('No se pudo resolver el plan externo.'), { status: 502, code: 'billing_external_plan_lookup_failed' })
  if ((data || []).length > 1) throw Object.assign(new Error('El plan externo está asociado a más de un entorno/tenant.'), { status: 409, code: 'billing_external_plan_ambiguous' })
  if (!data?.[0]) return null
  return data[0] as TenantBillingBinding
}
