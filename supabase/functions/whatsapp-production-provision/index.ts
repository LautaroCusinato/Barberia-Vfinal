import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.0'

const PROVIDER = 'evolution'
const ENVIRONMENT = 'production'
const WEBHOOK_HEADER = 'X-Austral-Webhook-Secret'
const INSTANCE_PREFIX = 'austral-prod-tenant-'

function value(input: unknown) { return String(input || '').trim() }
function projectRef() {
  try { return new URL(value(Deno.env.get('SUPABASE_URL'))).hostname.split('.')[0].toLowerCase() } catch { return '' }
}
function assertRuntime() {
  const expectedRef = value(Deno.env.get('WHATSAPP_RUNTIME_PROJECT_REF')).toLowerCase()
  if (!expectedRef || projectRef() !== expectedRef) throw Object.assign(new Error('project_target_mismatch'), { status: 503 })
  if (value(Deno.env.get('WHATSAPP_RUNTIME_ENV')) !== ENVIRONMENT) throw Object.assign(new Error('production_runtime_required'), { status: 503 })
  if (value(Deno.env.get('WHATSAPP_PROVISIONING_ENABLED')) !== '1') throw Object.assign(new Error('provisioning_disabled'), { status: 503 })
}
function adminClient() {
  const url = value(Deno.env.get('SUPABASE_URL'))
  const key = value(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
  if (!url || !key) throw Object.assign(new Error('supabase_not_configured'), { status: 503 })
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}
function allowedOrigin(request: Request) {
  const expected = value(Deno.env.get('APP_BASE_URL')).replace(/\/$/, '')
  const origin = value(request.headers.get('origin')).replace(/\/$/, '')
  return expected && origin === expected ? origin : ''
}
function response(body: unknown, status: number, origin: string) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      Vary: 'Origin',
    },
  })
}
function instanceName(tenantId: number) { return `${INSTANCE_PREFIX}${tenantId}` }
function safeConnection(row: Record<string, unknown> | null) {
  if (!row) return { state: 'NOT_CONFIGURED', automation_enabled: false, outbound_enabled: false, booking_enabled: false }
  return {
    state: row.state,
    provisioning_mode: row.provisioning_mode,
    last_verified_at: row.last_verified_at,
    qr_expires_at: row.qr_expires_at,
    automation_enabled: row.automation_enabled === true,
    outbound_enabled: row.outbound_enabled === true,
    booking_enabled: row.booking_enabled === true,
  }
}
function evolutionConfig() {
  const baseUrl = value(Deno.env.get('EVOLUTION_BASE_URL')).replace(/\/$/, '')
  const apiKey = value(Deno.env.get('EVOLUTION_API_KEY'))
  const webhookUrl = value(Deno.env.get('WHATSAPP_N8N_WEBHOOK_URL'))
  const webhookSecret = value(Deno.env.get('WHATSAPP_N8N_WEBHOOK_SECRET'))
  const allowedHost = value(Deno.env.get('WHATSAPP_N8N_ALLOWED_HOST')).toLowerCase()
  let parsed: URL
  try { parsed = new URL(webhookUrl) } catch { throw Object.assign(new Error('webhook_not_configured'), { status: 503 }) }
  if (!baseUrl || !apiKey || !webhookSecret || parsed.protocol !== 'https:' || !allowedHost || parsed.hostname.toLowerCase() !== allowedHost) {
    throw Object.assign(new Error('provider_not_configured'), { status: 503 })
  }
  return { baseUrl, apiKey, webhookUrl, webhookSecret }
}
async function evolution(path: string, init: { method?: string; body?: unknown } = {}) {
  const config = evolutionConfig()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const result = await fetch(`${config.baseUrl}${path}`, {
      method: init.method || 'GET',
      headers: { apikey: config.apiKey, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const text = await result.text()
    let body: unknown = null
    try { body = text ? JSON.parse(text) : null } catch { body = null }
    if (!result.ok) throw Object.assign(new Error('evolution_request_failed'), { status: 502 })
    return body as Record<string, unknown> | null
  } finally {
    clearTimeout(timeout)
  }
}
function extractQr(payload: Record<string, unknown> | null) {
  const nested = payload?.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  const candidates = [payload?.base64, payload?.qrcode, payload?.qr, nested.base64, nested.qrcode, nested.qr]
  const qr = candidates.map(value).find((candidate) => candidate.length > 20)
  if (!qr) return null
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`
}
function evolutionInstances(payload: Record<string, unknown> | Record<string, unknown>[] | null) {
  if (Array.isArray(payload)) return payload
  return payload && Array.isArray(payload.instances) ? payload.instances as Record<string, unknown>[] : []
}
function evolutionInstanceName(row: Record<string, unknown>) {
  const nested = row.instance && typeof row.instance === 'object' ? row.instance as Record<string, unknown> : {}
  return value(row.name || row.instanceName || nested.instanceName)
}
async function configureWebhook(expectedInstance: string) {
  const config = evolutionConfig()
  const events = ['MESSAGES_UPSERT']
  await evolution(`/webhook/set/${encodeURIComponent(expectedInstance)}`, {
    method: 'POST',
    body: { webhook: { enabled: true, url: config.webhookUrl, webhookByEvents: false, webhookBase64: false, events, headers: { [WEBHOOK_HEADER]: config.webhookSecret } } },
  })
  const readback = await evolution(`/webhook/find/${encodeURIComponent(expectedInstance)}`)
  const webhook = readback?.webhook && typeof readback.webhook === 'object' ? readback.webhook as Record<string, unknown> : readback || {}
  const headers = webhook.headers && typeof webhook.headers === 'object' ? webhook.headers as Record<string, unknown> : {}
  const actualEvents = Array.isArray(webhook.events) ? webhook.events.map(String).sort() : []
  const hasSecretHeader = Object.keys(headers).some((name) => name.toLowerCase() === WEBHOOK_HEADER.toLowerCase())
  if (webhook.enabled !== true || value(webhook.url) !== config.webhookUrl || !hasSecretHeader || actualEvents.join(',') !== events.join(',')) {
    throw Object.assign(new Error('evolution_webhook_not_confirmed'), { status: 502 })
  }
}
function normalizeState(payload: Record<string, unknown> | null) {
  const nested = payload?.instance && typeof payload.instance === 'object' ? payload.instance as Record<string, unknown> : {}
  const state = value(nested.state || payload?.state).toLowerCase()
  if (state === 'open' || state === 'connected') return 'CONNECTED'
  if (state === 'connecting') return 'CONNECTING'
  if (state === 'close' || state === 'closed') return 'DISCONNECTED'
  return null
}
async function authorize(request: Request, admin: SupabaseClient, tenantId: number) {
  const token = value(request.headers.get('authorization')).replace(/^Bearer\s+/i, '')
  if (!token) throw Object.assign(new Error('authorization_required'), { status: 401 })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw Object.assign(new Error('invalid_session'), { status: 401 })
  const { data: membership, error: membershipError } = await admin.from('barberia_members')
    .select('role').eq('barberia_id', tenantId).eq('user_id', data.user.id).maybeSingle()
  if (membershipError || !membership || !['owner', 'admin'].includes(value(membership.role))) {
    throw Object.assign(new Error('owner_or_admin_required'), { status: 403 })
  }
}
async function connection(admin: SupabaseClient, tenantId: number) {
  const { data, error } = await admin.from('saas_whatsapp_connections').select('*')
    .eq('barberia_id', tenantId).eq('provider', PROVIDER).eq('environment', ENVIRONMENT).maybeSingle()
  if (error) throw Object.assign(new Error('connection_lookup_failed'), { status: 502 })
  return data as Record<string, unknown> | null
}
async function ensureIntegration(admin: SupabaseClient, tenantId: number, expectedInstance: string) {
  const { data: rows, error } = await admin.from('saas_integraciones')
    .select('id,barberia_id,external_instance_id,metadata').eq('barberia_id', tenantId)
    .eq('proveedor', PROVIDER).eq('integration_type', 'whatsapp').limit(2)
  if (error || (rows || []).length > 1) throw Object.assign(new Error('integration_not_unique'), { status: 409 })
  const existing = rows?.[0]
  if (existing && value(existing.external_instance_id) && value(existing.external_instance_id) !== expectedInstance) {
    throw Object.assign(new Error('integration_identity_conflict'), { status: 409 })
  }
  if (existing) {
    const { data, error: updateError } = await admin.from('saas_integraciones').update({
      external_instance_id: expectedInstance,
      credential_reference: 'server:evolution',
      metadata: { ...(existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {}), environment: ENVIRONMENT, provisioning: 'managed', automation_enabled: false, outbound_enabled: false, booking_enabled: false },
    }).eq('id', existing.id).eq('barberia_id', tenantId).select('id').single()
    if (updateError) throw Object.assign(new Error('integration_update_failed'), { status: 502 })
    return Number(data.id)
  }
  const { data, error: createError } = await admin.from('saas_integraciones').insert({
    barberia_id: tenantId, proveedor: PROVIDER, estado: 'pendiente', integration_type: 'whatsapp',
    external_instance_id: expectedInstance, credential_reference: 'server:evolution',
    metadata: { environment: ENVIRONMENT, provisioning: 'managed', automation_enabled: false, outbound_enabled: false, booking_enabled: false },
  }).select('id').single()
  if (createError || !data) throw Object.assign(new Error('integration_create_failed'), { status: 502 })
  return Number(data.id)
}
async function prepare(admin: SupabaseClient, tenantId: number) {
  const expectedInstance = instanceName(tenantId)
  const protectedInstances = new Set(value(Deno.env.get('WHATSAPP_PROTECTED_INSTANCES')).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))
  protectedInstances.add('miwsp')
  if (protectedInstances.has(expectedInstance.toLowerCase())) throw Object.assign(new Error('protected_instance'), { status: 403 })
  const current = await connection(admin, tenantId)
  if (current && value(current.instance_name) && value(current.instance_name) !== expectedInstance) throw Object.assign(new Error('connection_identity_conflict'), { status: 409 })
  const integrationId = await ensureIntegration(admin, tenantId, expectedInstance)
  const base = {
    barberia_id: tenantId, integration_id: integrationId, provider: PROVIDER, environment: ENVIRONMENT,
    provisioning_mode: 'live', instance_name: expectedInstance,
    automation_enabled: false, outbound_enabled: false, booking_enabled: false,
    last_error_code: null, last_error_message: null,
  }
  const write = current
    ? await admin.from('saas_whatsapp_connections').update({ ...base, state: 'CREATING_INSTANCE' }).eq('id', current.id).select('*').single()
    : await admin.from('saas_whatsapp_connections').insert({ ...base, state: 'CREATING_INSTANCE' }).select('*').single()
  if (write.error) throw Object.assign(new Error('connection_prepare_failed'), { status: 502 })

  const instances = evolutionInstances(await evolution('/instance/fetchInstances'))
  const exists = instances.some((item) => evolutionInstanceName(item) === expectedInstance)
  if (!exists) await evolution('/instance/create', { method: 'POST', body: { instanceName: expectedInstance, qrcode: true, integration: 'WHATSAPP-BAILEYS' } })
  await configureWebhook(expectedInstance)
  let qr: string | null = null
  for (let attempt = 0; attempt < 3 && !qr; attempt += 1) {
    qr = extractQr(await evolution(`/instance/connect/${encodeURIComponent(expectedInstance)}`))
    if (!qr && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750))
  }
  if (!qr) throw Object.assign(new Error('evolution_qr_missing'), { status: 502 })
  const qrExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const { data, error: updateError } = await admin.from('saas_whatsapp_connections').update({ state: 'QR_READY', qr_expires_at: qrExpiresAt, last_verified_at: new Date().toISOString() })
    .eq('barberia_id', tenantId).eq('environment', ENVIRONMENT).select('*').single()
  if (updateError) throw Object.assign(new Error('connection_qr_state_failed'), { status: 502 })
  return { connection: { ...safeConnection(data), qr_available: true, qr }, qr_expires_at: qrExpiresAt }
}
async function status(admin: SupabaseClient, tenantId: number) {
  const current = await connection(admin, tenantId)
  if (!current || !current.instance_name) return { connection: safeConnection(current) }
  const providerState = normalizeState(await evolution(`/instance/connectionState/${encodeURIComponent(value(current.instance_name))}`))
  if (!providerState) throw Object.assign(new Error('provider_state_unknown'), { status: 502 })
  const { data, error } = await admin.from('saas_whatsapp_connections').update({ state: providerState, last_verified_at: new Date().toISOString(), qr_expires_at: providerState === 'CONNECTED' ? null : current.qr_expires_at })
    .eq('id', current.id).eq('barberia_id', tenantId).eq('environment', ENVIRONMENT).select('*').single()
  if (error) throw Object.assign(new Error('connection_state_update_failed'), { status: 502 })
  return { connection: safeConnection(data) }
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request)
  if (request.method === 'OPTIONS') return origin ? response(null, 204, origin) : response({ error: 'origin_not_allowed' }, 403, '')
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405, origin)
  if (!origin) return response({ error: 'origin_not_allowed' }, 403, '')
  try {
    assertRuntime()
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (!body || Object.keys(body).some((key) => !['action', 'tenant_id'].includes(key))) throw Object.assign(new Error('invalid_request'), { status: 422 })
    const action = value(body.action)
    const tenantId = Number(body.tenant_id)
    if (!['status', 'prepare'].includes(action) || !Number.isSafeInteger(tenantId) || tenantId < 1) throw Object.assign(new Error('invalid_request'), { status: 422 })
    const admin = adminClient()
    await authorize(request, admin, tenantId)
    const result = action === 'prepare' ? await prepare(admin, tenantId) : await status(admin, tenantId)
    return response(result, 200, origin)
  } catch (error) {
    const statusCode = Number((error as { status?: number }).status) || 503
    const code = value((error as { message?: string }).message).replace(/[^a-z0-9_:-]/gi, '').slice(0, 80) || 'provisioning_failed'
    return response({ error: code }, statusCode, origin)
  }
})
