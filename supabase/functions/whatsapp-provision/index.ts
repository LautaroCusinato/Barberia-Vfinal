import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.45.0'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const CONNECTION_ENVIRONMENT = 'qa'
const QA_FIXTURE_PREFIX = 'E2E_QA_'
const PROVIDER = 'evolution'
const STATES = new Set(['NOT_CONFIGURED', 'CREATING_INSTANCE', 'QR_READY', 'CONNECTING', 'CONNECTED', 'DISCONNECTED', 'ERROR'])
const ACTIONS = new Set(['status', 'connect', 'reconnect', 'disconnect'])

function projectRef() {
  const raw = Deno.env.get('SUPABASE_URL') || ''
  try { return new URL(raw).hostname.split('.')[0].toLowerCase() } catch { return '' }
}

function assertQaRuntime() {
  const ref = projectRef()
  if (!ref || ref === PRODUCTION_PROJECT_REF || ref !== QA_PROJECT_REF) {
    throw Object.assign(new Error('WhatsApp provisioning is not available outside the authorized QA project.'), { status: 503, code: 'qa_project_required' })
  }
  if (Deno.env.get('WHATSAPP_PROVISIONING_ENV') !== CONNECTION_ENVIRONMENT) {
    throw Object.assign(new Error('WhatsApp provisioning environment is not configured.'), { status: 503, code: 'provisioning_environment_missing' })
  }
  if (Deno.env.get('WHATSAPP_MODE') !== 'shadow' || Deno.env.get('PILOT_MODE') !== 'shadow') {
    throw Object.assign(new Error('WhatsApp provisioning requires shadow mode.'), { status: 409, code: 'shadow_mode_required' })
  }
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw Object.assign(new Error('Falta configuración interna de Supabase.'), { status: 503, code: 'supabase_not_configured' })
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function authenticate(request: Request, admin: SupabaseClient): Promise<User> {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Autenticación requerida.'), { status: 401, code: 'auth_required' })
  const token = authorization.slice(7).trim()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw Object.assign(new Error('Sesión inválida.'), { status: 401, code: 'invalid_session' })
  return data.user
}

async function resolveTenant(admin: SupabaseClient, userId: string, requestedTenant: unknown, { manage = false } = {}) {
  const requested = requestedTenant == null || requestedTenant === '' ? null : Number(requestedTenant)
  if (requested != null && (!Number.isSafeInteger(requested) || requested < 1)) {
    throw Object.assign(new Error('Tenant inválido.'), { status: 422, code: 'invalid_tenant' })
  }
  let query = admin.from('barberia_members').select('barberia_id, role').eq('user_id', userId)
  if (requested != null) query = query.eq('barberia_id', requested)
  const { data: memberships, error } = await query
  if (error) throw Object.assign(new Error('No se pudo resolver la membresía.'), { status: 502, code: 'membership_lookup_failed' })
  if (!memberships?.length) throw Object.assign(new Error('No tenés acceso a este negocio.'), { status: 403, code: 'tenant_membership_required' })
  if (requested == null && memberships.length !== 1) throw Object.assign(new Error('La sesión pertenece a más de un negocio; seleccioná uno.'), { status: 409, code: 'tenant_selection_required' })
  const tenantId = Number(memberships[0].barberia_id)
  if (manage && !['owner', 'admin'].includes(String(memberships[0].role))) throw Object.assign(new Error('Sólo owner/admin puede gestionar la conexión.'), { status: 403, code: 'owner_admin_required' })
  const { data: tenant, error: tenantError } = await admin.from('barberias').select('id, nombre, metadata').eq('id', tenantId).maybeSingle()
  if (tenantError || !tenant) throw Object.assign(new Error('No se pudo resolver el negocio.'), { status: 404, code: 'tenant_not_found' })
  if (tenant.metadata?.environment && tenant.metadata.environment !== 'qa') throw Object.assign(new Error('El negocio no pertenece al entorno QA.'), { status: 403, code: 'qa_tenant_required' })
  return { tenantId, role: memberships[0].role, tenant }
}

function safeError(error: unknown) {
  const code = String((error as { code?: string })?.code || 'whatsapp_provisioning_error').replace(/[^a-z0-9_:-]/gi, '').slice(0, 80)
  const message = String((error as { message?: string })?.message || 'No se pudo preparar la conexión.').replace(/[\r\n]/g, ' ').slice(0, 240)
  return { code, message }
}

function publicConnection(row: Record<string, unknown> | null, { includeQr = false, qr = null as string | null } = {}) {
  if (!row) return { state: 'NOT_CONFIGURED', connected: false, qr_available: false, provisioning_mode: 'shadow', environment: CONNECTION_ENVIRONMENT }
  const state = STATES.has(String(row.state)) ? String(row.state) : 'ERROR'
  const qrExpires = row.qr_expires_at ? new Date(String(row.qr_expires_at)).getTime() : 0
  const qrAvailable = Boolean(includeQr && qr && qrExpires > Date.now())
  return {
    state,
    connected: state === 'CONNECTED',
    qr_available: qrAvailable,
    qr: qrAvailable ? qr : undefined,
    provisioning_mode: String(row.provisioning_mode || 'shadow'),
    environment: CONNECTION_ENVIRONMENT,
    last_verified_at: row.last_verified_at || null,
    last_error: row.last_error_code ? { code: row.last_error_code, message: row.last_error_message || 'No se pudo completar la conexión.' } : null,
  }
}

async function getConnection(admin: SupabaseClient, tenantId: number) {
  const { data, error } = await admin.from('saas_whatsapp_connections').select('*').eq('barberia_id', tenantId).eq('provider', PROVIDER).eq('environment', CONNECTION_ENVIRONMENT).maybeSingle()
  if (error) throw Object.assign(new Error('La configuración de WhatsApp todavía no está disponible.'), { status: 503, code: 'provisioning_not_migrated' })
  return data as Record<string, unknown> | null
}

async function ensureIntegration(admin: SupabaseClient, tenantId: number) {
  const { data: existing, error: lookupError } = await admin.from('saas_integraciones').select('id, barberia_id, proveedor, estado, integration_type, metadata').eq('barberia_id', tenantId).eq('proveedor', PROVIDER).maybeSingle()
  if (lookupError) throw Object.assign(new Error('No se pudo resolver la integración.'), { status: 502, code: 'integration_lookup_failed' })
  if (existing) return existing
  const { data, error } = await admin.from('saas_integraciones').insert({
    barberia_id: tenantId,
    proveedor: PROVIDER,
    estado: 'pendiente',
    integration_type: 'whatsapp',
    metadata: { environment: CONNECTION_ENVIRONMENT, provisioning: 'managed', external_provider: false, e2e_prefix: QA_FIXTURE_PREFIX },
  }).select('id, barberia_id, proveedor, estado, integration_type, metadata').single()
  if (error || !data) throw Object.assign(new Error('No se pudo crear la integración interna.'), { status: 502, code: 'integration_create_failed' })
  return data
}

function instanceNameFor(tenantId: number) {
  // Generated once and persisted in the QA connection row. It is never
  // accepted from the browser and is not displayed as a product label.
  return `austral-qa-${tenantId}-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`
}

function mockAdapter(instanceName: string) {
  return {
    mode: 'mock' as const,
    instanceName,
    externalInstanceId: instanceName,
    receiverNumber: null,
    qr: `data:text/plain;charset=utf-8,Austral%20QA%20QR%20(mock)%20sin%20escaneo%20real%20%7C%20${encodeURIComponent(instanceName)}`,
    qrExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }
}

function adapterFor(instanceName: string) {
  const adapter = Deno.env.get('WHATSAPP_PROVISIONING_ADAPTER') || 'mock'
  if (adapter === 'mock') return mockAdapter(instanceName)
  // Real Evolution provisioning is intentionally not implicit. It needs a
  // separately allowlisted QA host and a dedicated operational authorization.
  throw Object.assign(new Error('La instancia QA de WhatsApp todavía requiere configuración operativa.'), { status: 503, code: 'qa_provider_not_configured' })
}

async function upsertConnection(admin: SupabaseClient, tenantId: number, integrationId: number, patch: Record<string, unknown>) {
  const { data: current } = await admin.from('saas_whatsapp_connections').select('*').eq('barberia_id', tenantId).eq('provider', PROVIDER).eq('environment', CONNECTION_ENVIRONMENT).maybeSingle()
  const payload = { barberia_id: tenantId, integration_id: integrationId, provider: PROVIDER, environment: CONNECTION_ENVIRONMENT, ...patch }
  const result = current
    ? await admin.from('saas_whatsapp_connections').update(patch).eq('id', current.id).select('*').single()
    : await admin.from('saas_whatsapp_connections').insert(payload).select('*').single()
  if (result.error?.code === '23505') {
    // Dos clicks simultáneos compiten por la única fila del tenant. Releer la
    // fila ganadora hace la operación idempotente sin crear otra conexión.
    const { data: winner } = await admin.from('saas_whatsapp_connections').select('*').eq('barberia_id', tenantId).eq('provider', PROVIDER).eq('environment', CONNECTION_ENVIRONMENT).maybeSingle()
    if (winner) return winner as Record<string, unknown>
  }
  if (result.error || !result.data) throw Object.assign(new Error('No se pudo guardar el estado de la conexión.'), { status: 502, code: 'connection_state_write_failed' })
  return result.data as Record<string, unknown>
}

async function connect(admin: SupabaseClient, tenantId: number, reconnect = false) {
  const integration = await ensureIntegration(admin, tenantId)
  let connection = await getConnection(admin, tenantId)
  if (connection?.state === 'CONNECTED' && !reconnect) return { connection, qr: null }
  if (connection?.state === 'CREATING_INSTANCE' && Date.now() - new Date(String(connection.updated_at)).getTime() < 5 * 60 * 1000) return { connection, qr: null }
  const instanceName = String(connection?.instance_name || instanceNameFor(tenantId))
  connection = await upsertConnection(admin, tenantId, Number(integration.id), {
    state: 'CREATING_INSTANCE',
    provisioning_mode: Deno.env.get('WHATSAPP_PROVISIONING_ADAPTER') === 'evolution' ? 'shadow' : 'mock',
    instance_name: instanceName,
    last_error_code: null,
    last_error_message: null,
    metadata: { environment: CONNECTION_ENVIRONMENT, provisioning: 'managed', e2e_prefix: QA_FIXTURE_PREFIX, last_action: reconnect ? 'reconnect' : 'connect' },
  })
  const result = adapterFor(instanceName)
  const next = await upsertConnection(admin, tenantId, Number(integration.id), {
    state: 'QR_READY',
    provisioning_mode: result.mode,
    instance_name: result.instanceName,
    external_instance_id: result.externalInstanceId,
    receiver_number: result.receiverNumber,
    qr_expires_at: result.qrExpiresAt,
    last_error_code: null,
    last_error_message: null,
  })
  await admin.from('saas_integraciones').update({
    estado: 'pendiente',
    integration_type: 'whatsapp',
    external_instance_id: result.externalInstanceId,
    receiver_number: result.receiverNumber,
    metadata: { environment: CONNECTION_ENVIRONMENT, provisioning: 'managed', external_provider: result.mode !== 'mock', e2e_prefix: QA_FIXTURE_PREFIX },
  }).eq('id', integration.id).eq('barberia_id', tenantId)
  return { connection: next, qr: result.qr }
}

async function disconnect(admin: SupabaseClient, tenantId: number) {
  const connection = await getConnection(admin, tenantId)
  if (!connection) return { connection: null, qr: null }
  const next = await upsertConnection(admin, tenantId, Number(connection.integration_id), {
    state: 'DISCONNECTED', qr_expires_at: null, last_error_code: null, last_error_message: null,
    metadata: { environment: CONNECTION_ENVIRONMENT, provisioning: 'managed', e2e_prefix: QA_FIXTURE_PREFIX, last_action: 'disconnect' },
  })
  if (connection.integration_id) await admin.from('saas_integraciones').update({ estado: 'desactivado' }).eq('id', connection.integration_id).eq('barberia_id', tenantId)
  return { connection: next, qr: null }
}

const headers = (request: Request): HeadersInit => {
  const origin = request.headers.get('origin') || ''
  const allowed = new Set([Deno.env.get('APP_BASE_URL') || '', `https://${QA_PROJECT_REF}.supabase.co`])
  const corsOrigin = allowed.has(origin) && origin ? origin : null
  return { ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }
}

function json(request: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: headers(request) }) }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(request) })
  const admin = adminClient()
  try {
    assertQaRuntime()
    const user = await authenticate(request, admin)
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
    const url = new URL(request.url)
    const action = String(body.action || url.searchParams.get('action') || 'status').trim().toLowerCase()
    if (!ACTIONS.has(action)) throw Object.assign(new Error('Acción de WhatsApp inválida.'), { status: 422, code: 'invalid_action' })
    const tenant = await resolveTenant(admin, user.id, body.tenant_id || url.searchParams.get('tenant_id'), { manage: action !== 'status' })
    if (action === 'status') return json(request, { tenant_id: tenant.tenantId, connection: publicConnection(await getConnection(admin, tenant.tenantId)) })
    if (action === 'disconnect') {
      const result = await disconnect(admin, tenant.tenantId)
      return json(request, { tenant_id: tenant.tenantId, connection: publicConnection(result.connection), changed: Boolean(result.connection) })
    }
    const result = await connect(admin, tenant.tenantId, action === 'reconnect')
    return json(request, { tenant_id: tenant.tenantId, connection: publicConnection(result.connection, { includeQr: true, qr: result.qr }), idempotent: result.connection?.state === 'CONNECTED' })
  } catch (error) {
    const safe = safeError(error)
    return json(request, { error: safe }, Number((error as { status?: number })?.status) || 500)
  }
})
