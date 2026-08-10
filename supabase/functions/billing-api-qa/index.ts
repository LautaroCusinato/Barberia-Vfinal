import { createClient } from 'npm:@supabase/supabase-js@2.45.0'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const PROD_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const allowedStates = new Set(['trialing', 'active', 'past_due', 'suspended', 'canceled'])
const allowedOrigins = new Set([
  'https://barberia.cuchitron.lat',
  'https://cmsymmszlzikqpvfqjre.supabase.co',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:4174',
  'http://localhost:4173',
  'http://localhost:4174',
])

const jsonHeaders = (request: Request) => {
  const origin = request.headers.get('origin') || ''
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : '*',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

const json = (request: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: jsonHeaders(request) })

const errorResponse = (request: Request, message: string, code: string, status: number) =>
  json(request, { error: { message, code }, environment: 'qa', mock: true }, status)

function projectRef() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  try {
    return new URL(supabaseUrl).hostname.split('.')[0]
  } catch {
    return ''
  }
}

function assertQaProject() {
  const ref = projectRef()
  if (!ref || ref === PROD_PROJECT_REF || ref !== QA_PROJECT_REF) {
    throw new Error('QA billing mock is not available outside the authorized QA project.')
  }
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })

async function authenticate(request: Request) {
  const authorization = request.headers.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) throw new Error('Sesión requerida.')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new Error('Sesión inválida.')
  return data.user
}

async function platformRole(userId: string) {
  const { data, error } = await admin.from('platform_members').select('role').eq('user_id', userId).maybeSingle()
  if (error) throw new Error('No se pudo validar el rol de plataforma.')
  return data?.role || null
}

async function tenantFor(userId: string) {
  const { data: member, error: memberError } = await admin
    .from('barberia_members')
    .select('barberia_id, role')
    .eq('user_id', userId)
    .order('role', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (memberError || !member) throw new Error('No se encontró un negocio QA para la sesión.')

  const { data: tenant, error: tenantError } = await admin
    .from('barberias')
    .select('id, nombre, slug, estado_cuenta, pais, moneda, locale, metadata')
    .eq('id', member.barberia_id)
    .maybeSingle()
  if (tenantError || !tenant || tenant.metadata?.e2e_prefix !== 'E2E_QA_' || tenant.metadata?.environment !== 'qa') {
    throw new Error('La sesión no pertenece a un tenant QA autorizado.')
  }
  return { tenant, role: member.role }
}

async function billingPortal(userId: string, state: string) {
  const { tenant, role } = await tenantFor(userId)
  const { data: subscription } = await admin
    .from('saas_suscripciones')
    .select('*')
    .eq('barberia_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const planCode = subscription?.plan_codigo || 'starter'
  const { data: plan } = await admin.from('saas_planes').select('*').eq('codigo', planCode).maybeSingle()
  const { data: providers } = await admin.from('saas_proveedores_pago').select('codigo, nombre, activo, ambiente').order('codigo')
  const safeState = allowedStates.has(state) ? state : subscription?.estado || 'trialing'
  const accessState = safeState === 'suspended' || safeState === 'canceled' ? 'suspended' : safeState
  return {
    environment: 'qa',
    mock: true,
    provider_available: false,
    tenant: { ...tenant, role },
    subscription: subscription ? { ...subscription, estado: safeState, plan: plan || { codigo: planCode, nombre: planCode } } : { estado: safeState, plan: plan || { codigo: planCode, nombre: planCode } },
    access_state: accessState,
    providers: (providers || []).map((provider) => ({ ...provider, activo: false, ambiente: 'qa' })),
    external_subscriptions: [],
    payments: [],
    invoices: [],
    history: [],
  }
}

async function requirePlatform(request: Request, userId: string) {
  const role = await platformRole(userId)
  if (!['owner', 'admin'].includes(role || '')) throw new Error('Se requiere un rol de plataforma autorizado.')
  return role
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders(request) })
  try {
    assertQaProject()
    const user = await authenticate(request)
    const url = new URL(request.url)
    const route = url.pathname.split('/').filter(Boolean).at(-1) || ''

    if (request.method === 'GET' && route === 'status') {
      const state = url.searchParams.get('state') || 'trialing'
      if (!allowedStates.has(state)) return errorResponse(request, 'Estado sandbox no permitido.', 'invalid_state', 400)
      return json(request, await billingPortal(user.id, state))
    }

    if (request.method === 'GET' && route === 'config-status') {
      await requirePlatform(request, user.id)
      return json(request, {
        environment: 'qa',
        mock: true,
        production_enabled: false,
        provider: 'mock',
        provider_enabled: false,
        secrets: { mercadopago_access_token: false, mercadopago_webhook_secret: false, paypal_client_id: false, paypal_client_secret: false },
      })
    }

    if (request.method === 'POST' && route === 'checkout') {
      const { tenant } = await tenantFor(user.id)
      const body = await request.json().catch(() => ({}))
      const planCode = typeof body.plan_codigo === 'string' ? body.plan_codigo : 'starter'
      if (!/^[a-z0-9_-]{1,40}$/i.test(planCode)) return errorResponse(request, 'Plan sandbox inválido.', 'invalid_plan', 400)
      const reference = `qa_${tenant.id}_${planCode}`
      return json(request, { environment: 'qa', mock: true, provider: 'mock', status: 'ready', idempotent: true, external_reference: reference, checkout_url: `https://qa.invalid/billing-mock/checkout?reference=${encodeURIComponent(reference)}` })
    }

    if (request.method === 'POST' && route === 'external-status') {
      await tenantFor(user.id)
      const body = await request.json().catch(() => ({}))
      const status = allowedStates.has(body.status) ? body.status : 'active'
      return json(request, { environment: 'qa', mock: true, provider: 'mock', external_id: body.external_id || 'qa_external_subscription', status, normalized_status: status, verified: true, idempotent: true })
    }

    if (request.method === 'POST' && (route === 'reconcile' || route === 'reconcile-sandbox')) {
      await tenantFor(user.id)
      return json(request, { environment: 'qa', mock: true, reconciled: true, idempotent: true, effects: [] })
    }

    return errorResponse(request, 'Ruta no disponible en el mock de billing QA.', 'not_found', 404)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo completar la operación QA.'
    const status = message.includes('Sesión') ? 401 : message.includes('rol de plataforma') ? 403 : 400
    return errorResponse(request, message, status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'qa_billing_error', status)
  }
})
