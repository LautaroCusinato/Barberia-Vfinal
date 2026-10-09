import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.45.0'
import { mergeEvolutionConnectionMetadata, normalizeEvolutionState, resolveEvolutionState, shouldPersistEvolutionStatus } from '../_shared/evolutionState.mjs'
import { qaProvisionCorsOrigin, publicQaCapabilities } from '../_shared/qaProvisionUi.mjs'
import { disconnectQaSession } from '../_shared/qaDisconnect.mjs'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const CONNECTION_ENVIRONMENT = 'qa'
const QA_FIXTURE_PREFIX = 'E2E_QA_'
const PROVIDER = 'evolution'
const EVOLUTION_HOST = 'evolution.cuchitron.lat'
const PROTECTED_INSTANCE = 'miwsp'
const WEBHOOK_HEADER = 'X-Austral-Webhook-Secret'
const QA_INBOUND_SYNC_MODE = 'qa_sync'
// Preserve the already deployed QA inbound route while hardening pairing.
const WEBHOOK_EVENTS = ['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT']
const QR_TTL_MS = 45 * 1000
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
  if (!String(tenant.nombre || '').startsWith(QA_FIXTURE_PREFIX) && tenant.metadata?.e2e_prefix !== QA_FIXTURE_PREFIX) {
    throw Object.assign(new Error('El negocio no pertenece al fixture QA autorizado.'), { status: 403, code: 'qa_fixture_required' })
  }
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
  const cachedQr = typeof row.qr_payload === 'string' ? row.qr_payload : null
  const publicQr = includeQr ? qr || cachedQr : null
  const qrAvailable = Boolean(includeQr && state !== 'CONNECTED' && publicQr && qrExpires > Date.now())
  return {
    state,
    connected: state === 'CONNECTED',
    ...publicQaCapabilities(row, state),
    qr_available: qrAvailable,
    qr: qrAvailable ? publicQr : undefined,
    pairing_expires_at: row.pairing_expires_at || row.qr_expires_at || null,
    qr_expired: Boolean((row.pairing_expires_at || row.qr_expires_at) && qrExpires <= Date.now() && state !== 'CONNECTED'),
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
  const { data: existing, error: lookupError } = await admin.from('saas_integraciones').select('id, barberia_id, proveedor, estado, integration_type, external_instance_id, metadata').eq('barberia_id', tenantId).eq('proveedor', PROVIDER).maybeSingle()
  if (lookupError) throw Object.assign(new Error('No se pudo resolver la integración.'), { status: 502, code: 'integration_lookup_failed' })
  if (existing) {
    if (existing.integration_type !== 'whatsapp' || (existing.external_instance_id && existing.external_instance_id !== instanceNameFor(tenantId)) || (existing.metadata?.environment && existing.metadata.environment !== CONNECTION_ENVIRONMENT)) throw Object.assign(new Error('La integración existente no coincide con WhatsApp.'), { status: 409, code: 'integration_identity_conflict' })
    return existing
  }
  const inserted = await admin.from('saas_integraciones').insert({
    barberia_id: tenantId,
    proveedor: PROVIDER,
    estado: 'pendiente',
    integration_type: 'whatsapp',
    metadata: { environment: CONNECTION_ENVIRONMENT, provisioning: 'managed', external_provider: false, e2e_prefix: QA_FIXTURE_PREFIX },
  }).select('id, barberia_id, proveedor, estado, integration_type, metadata').single()
  if (!inserted.error && inserted.data) return inserted.data
  if (inserted.error?.code === '23505') {
    const winner = await admin.from('saas_integraciones').select('id, barberia_id, proveedor, estado, integration_type, external_instance_id, metadata').eq('barberia_id', tenantId).eq('proveedor', PROVIDER).maybeSingle()
    if (!winner.error && winner.data?.integration_type === 'whatsapp' && (!winner.data.external_instance_id || winner.data.external_instance_id === instanceNameFor(tenantId)) && (!winner.data.metadata?.environment || winner.data.metadata.environment === CONNECTION_ENVIRONMENT)) return winner.data
    if (!winner.error && winner.data) throw Object.assign(new Error('La integración existente no coincide con WhatsApp.'), { status: 409, code: 'integration_identity_conflict' })
  }
  throw Object.assign(new Error('No se pudo crear la integración interna.'), { status: 502, code: 'integration_create_failed' })
}

function instanceNameFor(tenantId: number) {
  // Stable server-side name. It is never accepted from the browser, and the
  // protected production instance `miwsp` can never be selected here.
  const name = `austral-qa-tenant-${tenantId}`
  if (name.toLowerCase() === PROTECTED_INSTANCE) throw new Error('La instancia protegida no puede ser utilizada por QA.')
  return name
}

function mockAdapter(instanceName: string) {
  return {
    mode: 'mock' as const,
    instanceName,
    externalInstanceId: instanceName,
    receiverNumber: null,
    qr: `data:text/plain;charset=utf-8,Austral%20QA%20QR%20(mock)%20sin%20escaneo%20real%20%7C%20${encodeURIComponent(instanceName)}`,
    qrExpiresAt: new Date(Date.now() + QR_TTL_MS).toISOString(),
  }
}

function adapterMode() { return String(Deno.env.get('WHATSAPP_PROVISIONING_ADAPTER') || 'mock').trim().toLowerCase() }

function evolutionBaseUrl() {
  const raw = String(Deno.env.get('EVOLUTION_BASE_URL') || '').trim()
  if (!raw) throw Object.assign(new Error('La conexión todavía requiere configuración operativa.'), { status: 503, code: 'evolution_base_url_missing' })
  let url: URL
  try { url = new URL(raw) } catch { throw Object.assign(new Error('La conexión todavía requiere configuración operativa.'), { status: 503, code: 'evolution_base_url_invalid' }) }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname.toLowerCase() !== EVOLUTION_HOST) {
    throw Object.assign(new Error('La conexión segura de WhatsApp no está disponible.'), { status: 503, code: 'evolution_https_required' })
  }
  return url.toString().replace(/\/$/, '')
}

function evolutionApiKey() {
  const key = String(Deno.env.get('EVOLUTION_API_KEY') || '').trim()
  if (!key) throw Object.assign(new Error('La conexión todavía requiere configuración operativa.'), { status: 503, code: 'evolution_api_key_missing' })
  return key
}

function evolutionWebhookSecret() {
  const secret = String(Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || '').trim()
  if (!secret) throw Object.assign(new Error('La conexión todavía requiere configuración operativa.'), { status: 503, code: 'evolution_webhook_secret_missing' })
  return secret
}

function evolutionWebhookUrl() {
  const endpoint = Deno.env.get('WHATSAPP_INBOUND_MODE') === QA_INBOUND_SYNC_MODE
    ? 'whatsapp-inbound-sync'
    : 'whatsapp-evolution-webhook'
  return `https://${QA_PROJECT_REF}.supabase.co/functions/v1/${endpoint}`
}

function assertEvolutionConfiguration() {
  evolutionBaseUrl()
  evolutionApiKey()
  evolutionWebhookSecret()
  if (Deno.env.get('WHATSAPP_PROVISIONING_ENV') !== CONNECTION_ENVIRONMENT || Deno.env.get('WHATSAPP_MODE') !== 'shadow' || Deno.env.get('PILOT_MODE') !== 'shadow') {
    throw Object.assign(new Error('La conexión QA requiere modo shadow.'), { status: 503, code: 'shadow_mode_required' })
  }
}

async function evolutionRequest(path: string, init: { method?: string, body?: unknown } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(`${evolutionBaseUrl()}${path}`, {
      method: init.method || 'GET',
      headers: { apikey: evolutionApiKey(), 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    })
    const raw = await response.text()
    let body: unknown = null
    try { body = raw ? JSON.parse(raw) : null } catch { body = null }
    if (!response.ok) throw Object.assign(new Error('Evolution no pudo completar la operación.'), { status: 502, code: `evolution_http_${response.status}` })
    return body
  } catch (error) {
    if ((error as { code?: string })?.code?.startsWith('evolution_http_')) throw error
    throw Object.assign(new Error('Evolution no está disponible temporalmente.'), { status: 502, code: 'evolution_unreachable' })
  } finally { clearTimeout(timeout) }
}

function instanceNameFrom(value: unknown) {
  const name = String(value || '').trim()
  if (!name || name.toLowerCase() === PROTECTED_INSTANCE || !name.startsWith('austral-qa-tenant-')) return null
  return name
}

function evolutionInstances(payload: unknown) {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload && typeof payload === 'object' && Array.isArray((payload as { instances?: unknown[] }).instances)) return (payload as { instances: unknown[] }).instances as Record<string, unknown>[]
  return []
}

function evolutionInstanceName(row: Record<string, unknown>) {
  return instanceNameFrom(row.name ?? row.instanceName ?? (row.instance as Record<string, unknown> | undefined)?.instanceName)
}

function normalizeQr(value: unknown) {
  if (typeof value !== 'string' || value.trim().length < 20) return null
  const qr = value.trim()
  return qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`
}

function extractQr(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const data = payload as Record<string, unknown>
  return normalizeQr(data.base64 ?? data.qrcode ?? data.qr ?? (data.data as Record<string, unknown> | undefined)?.base64 ?? (data.data as Record<string, unknown> | undefined)?.qrcode)
}

async function configureEvolutionWebhook(instanceName: string) {
  const expectedUrl = evolutionWebhookUrl()
  await evolutionRequest(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: { webhook: { enabled: true, url: expectedUrl, webhookByEvents: false, webhookBase64: false, events: WEBHOOK_EVENTS, headers: { [WEBHOOK_HEADER]: evolutionWebhookSecret() } } },
  })
  const readback = await evolutionRequest(`/webhook/find/${encodeURIComponent(instanceName)}`)
  const config = (readback as Record<string, unknown> | null)?.webhook && typeof (readback as Record<string, unknown>).webhook === 'object'
    ? ((readback as Record<string, unknown>).webhook as Record<string, unknown>).webhook as Record<string, unknown> || (readback as Record<string, unknown>).webhook as Record<string, unknown>
    : readback as Record<string, unknown>
  const headers = config?.headers && typeof config.headers === 'object' ? config.headers as Record<string, unknown> : {}
  const configuredSecret = Object.entries(headers).find(([name]) => name.toLowerCase() === WEBHOOK_HEADER.toLowerCase())?.[1]
  const events = Array.isArray(config?.events) ? config.events.map(String) : []
  if (config?.enabled !== true || String(config?.url || '') !== expectedUrl || String(configuredSecret || '') !== evolutionWebhookSecret() || events.sort().join(',') !== [...WEBHOOK_EVENTS].sort().join(',')) {
    throw Object.assign(new Error('No se pudo confirmar el webhook QA.'), { status: 502, code: 'evolution_webhook_not_confirmed' })
  }
}

async function realEvolutionConnect(instanceName: string) {
  assertEvolutionConfiguration()
  const instances = evolutionInstances(await evolutionRequest('/instance/fetchInstances'))
  const existing = instances.find((row) => evolutionInstanceName(row) === instanceName)
  if (!existing) {
    await evolutionRequest('/instance/create', { method: 'POST', body: { instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS' } })
  } else {
    const signals = await realEvolutionSignals(instanceName)
    if (signals.connectionState === 'open' && ['open', 'connected'].includes(String(signals.fetchState))) {
      await configureEvolutionWebhook(instanceName)
      return { mode: 'shadow' as const, instanceName, externalInstanceId: instanceName, receiverNumber: null, qr: null, qrExpiresAt: null }
    }
  }
  await configureEvolutionWebhook(instanceName)
  // Evolution 2.3.7 puede crear la instancia primero y publicar el QR unos
  // instantes después. Releer el mismo endpoint acotadamente evita dejar al
  // owner en CONNECTING sin generar otra instancia ni tocar tráfico externo.
  let qr: string | null = null
  for (let attempt = 0; attempt < 3 && !qr; attempt += 1) {
    const qrResponse = await evolutionRequest(`/instance/connect/${encodeURIComponent(instanceName)}`)
    qr = extractQr(qrResponse)
    if (!qr && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 750))
  }
  return { mode: 'shadow' as const, instanceName, externalInstanceId: instanceName, receiverNumber: null, qr, qrExpiresAt: qr ? new Date(Date.now() + QR_TTL_MS).toISOString() : null }
}

async function realEvolutionSignals(instanceName: string) {
  assertEvolutionConfiguration()
  const [connectionPayload, instancesPayload] = await Promise.all([
    evolutionRequest(`/instance/connectionState/${encodeURIComponent(instanceName)}`),
    evolutionRequest(`/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`),
  ])
  const connection = connectionPayload as Record<string, unknown> | null
  const connectionState = normalizeEvolutionState((connection?.instance as Record<string, unknown> | undefined)?.state ?? connection?.state)
  const instance = evolutionInstances(instancesPayload).find((row) => evolutionInstanceName(row) === instanceName)
  const fetchState = normalizeEvolutionState(instance?.connectionStatus ?? instance?.status ?? instance?.state)
  return { connectionState, fetchState }
}

function connectionMetadata(current: Record<string, unknown>, signals: { connectionState: string | null, fetchState: string | null }, resolution: { state: string }) {
  return mergeEvolutionConnectionMetadata(current.metadata as Record<string, unknown> || {}, signals, resolution.state)
}

async function realEvolutionStatus(instanceName: string, current: Record<string, unknown> = {}) {
  const signals = await realEvolutionSignals(instanceName)
  const resolution = resolveEvolutionState({
    connectionState: signals.connectionState,
    fetchState: signals.fetchState,
    previousState: String(current.state || ''),
    receiverNumber: current.receiver_number,
    metadata: current.metadata,
    qrExpiresAt: current.qr_expires_at,
  })
  return { ...resolution, signals }
}

async function realEvolutionDisconnect(instanceName: string) {
  assertEvolutionConfiguration()
  await disconnectQaSession({ instanceName, request: evolutionRequest, signals: realEvolutionSignals })
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

async function writeClaimedConnection(admin: SupabaseClient, tenantId: number, connectionId: number, operationId: string, patch: Record<string, unknown>) {
  const result = await admin.from('saas_whatsapp_connections').update(patch)
    .eq('id', connectionId).eq('barberia_id', tenantId).eq('environment', CONNECTION_ENVIRONMENT)
    .eq('provisioning_operation_id', operationId).select('*').maybeSingle()
  if (result.error || !result.data) throw Object.assign(new Error('No se pudo guardar el estado de la conexión.'), { status: 502, code: 'connection_state_write_failed' })
  return result.data as Record<string, unknown>
}

async function connect(admin: SupabaseClient, tenantId: number, operationId: string) {
  if (adapterMode() === 'evolution') assertEvolutionConfiguration()
  const integration = await ensureIntegration(admin, tenantId)
  let connection = await getConnection(admin, tenantId)
  const instanceName = instanceNameFor(tenantId)
  if (connection?.instance_name && connection.instance_name !== instanceName) throw Object.assign(new Error('La conexión existente no coincide con este negocio.'), { status: 409, code: 'connection_identity_conflict' })
  if (Date.parse(String(connection?.provisioning_lease_until || '')) > Date.now()) return { connection, qr: null }

  if (adapterMode() === 'evolution' && connection?.instance_name) {
    let status
    try { status = await realEvolutionStatus(instanceName, connection) }
    catch (error) {
      if ((error as { code?: string })?.code !== 'evolution_http_404') throw error
      connection = await upsertConnection(admin, tenantId, Number(integration.id), { state: 'DISCONNECTED', qr_payload: null, qr_expires_at: null, pairing_expires_at: null })
    }
    if (status?.state === 'CONNECTED') {
      const linked = await upsertConnection(admin, tenantId, Number(integration.id), { state: 'CONNECTED', provisioning_mode: 'shadow', qr_payload: null, qr_expires_at: null, pairing_expires_at: null, last_verified_at: new Date().toISOString(), metadata: connectionMetadata(connection, status.signals, status), last_error_code: null, last_error_message: null })
      return { connection: linked, qr: null }
    }
    if (status?.state === 'ERROR') throw Object.assign(new Error('El estado de la conexión requiere verificación.'), { status: 502, code: 'provider_state_conflict' })
  } else if (connection?.state === 'CONNECTED') return { connection, qr: null }

  if (connection?.qr_payload && Date.parse(String(connection.qr_expires_at || '')) > Date.now()) return { connection, qr: connection.qr_payload }
  const claimResult = await admin.rpc('claim_whatsapp_pairing', {
    p_barberia_id: tenantId,
    p_environment: CONNECTION_ENVIRONMENT,
    p_integration_id: Number(integration.id),
    p_instance_name: instanceName,
    p_operation_id: operationId,
    p_force_new: false,
  })
  if (claimResult.error || !claimResult.data) throw Object.assign(new Error('No se pudo iniciar una conexión segura.'), { status: 502, code: 'pairing_claim_failed' })
  const claim = claimResult.data as { connection_id: number, claimed: boolean }
  if (!claim.claimed) {
    connection = await getConnection(admin, tenantId)
    return { connection, qr: connection?.state === 'CONNECTED' ? null : connection?.qr_payload || null }
  }

  try {
    const result = adapterMode() === 'evolution' ? await realEvolutionConnect(instanceName) : mockAdapter(instanceName)
    if (!result.qr && result.mode === 'shadow') {
      const status = await realEvolutionStatus(instanceName, connection || {})
      if (status.state !== 'CONNECTED') throw Object.assign(new Error('Evolution no devolvió un código temporal.'), { status: 502, code: 'evolution_qr_missing' })
      const linked = await writeClaimedConnection(admin, tenantId, claim.connection_id, operationId, { state: 'CONNECTED', provisioning_mode: 'shadow', instance_name: instanceName, external_instance_id: result.externalInstanceId, receiver_number: result.receiverNumber, qr_payload: null, qr_expires_at: null, pairing_expires_at: null, provisioning_lease_until: null, last_verified_at: new Date().toISOString(), metadata: connectionMetadata(connection || {}, status.signals, status), last_error_code: null, last_error_message: null })
      return { connection: linked, qr: null }
    }
    const next = await writeClaimedConnection(admin, tenantId, claim.connection_id, operationId, {
      state: 'QR_READY', provisioning_mode: result.mode, instance_name: result.instanceName,
      external_instance_id: result.externalInstanceId, receiver_number: result.receiverNumber,
      qr_expires_at: result.qrExpiresAt, pairing_expires_at: result.qrExpiresAt, qr_payload: result.qr,
      provisioning_lease_until: null, last_error_code: null, last_error_message: null,
    })
    const integrationUpdate = await admin.from('saas_integraciones').update({ estado: 'pendiente', integration_type: 'whatsapp', external_instance_id: result.externalInstanceId, receiver_number: result.receiverNumber, metadata: { environment: CONNECTION_ENVIRONMENT, provisioning: 'managed', external_provider: result.mode !== 'mock', e2e_prefix: QA_FIXTURE_PREFIX } }).eq('id', integration.id).eq('barberia_id', tenantId)
    if (integrationUpdate.error) throw Object.assign(new Error('No se pudo actualizar la integración.'), { status: 502, code: 'integration_update_failed' })
    return { connection: next, qr: result.qr }
  } catch (error) {
    const safe = safeError(error)
    await admin.from('saas_whatsapp_connections').update({ state: 'ERROR', qr_payload: null, qr_expires_at: null, pairing_expires_at: null, provisioning_lease_until: null, last_error_code: safe.code, last_error_message: safe.message }).eq('id', claim.connection_id).eq('barberia_id', tenantId).eq('provisioning_operation_id', operationId)
    throw error
  }
}

async function disconnect(admin: SupabaseClient, tenantId: number) {
  const connection = await getConnection(admin, tenantId)
  if (!connection) return { connection: null, qr: null }
  if (connection.instance_name && connection.instance_name !== instanceNameFor(tenantId)) throw Object.assign(new Error('La conexión existente no coincide con este negocio.'), { status: 409, code: 'connection_identity_conflict' })
  if (connection.state === 'DISCONNECTED') return { connection, qr: null }
  const instanceName = instanceNameFrom(connection.instance_name)
  if (adapterMode() === 'evolution' && instanceName) await realEvolutionDisconnect(instanceName)
  const next = await upsertConnection(admin, tenantId, Number(connection.integration_id), {
    state: 'DISCONNECTED', qr_expires_at: null, qr_payload: null, pairing_expires_at: null, provisioning_lease_until: null, last_error_code: null, last_error_message: null,
    metadata: { environment: CONNECTION_ENVIRONMENT, provisioning: 'managed', e2e_prefix: QA_FIXTURE_PREFIX, last_action: 'disconnect' },
  })
  if (connection.integration_id) await admin.from('saas_integraciones').update({ estado: 'desactivado' }).eq('id', connection.integration_id).eq('barberia_id', tenantId)
  return { connection: next, qr: null }
}

async function updateObservedConnection(admin: SupabaseClient, tenantId: number, current: Record<string, unknown>, patch: Record<string, unknown>) {
  const result = await admin.from('saas_whatsapp_connections').update(patch)
    .eq('id', current.id).eq('barberia_id', tenantId).eq('environment', CONNECTION_ENVIRONMENT)
    .eq('updated_at', current.updated_at).select('*').maybeSingle()
  if (result.error) throw Object.assign(new Error('No se pudo guardar el estado de la conexión.'), { status: 502, code: 'connection_state_write_failed' })
  return (result.data || await getConnection(admin, tenantId)) as Record<string, unknown> | null
}

async function refreshStatus(admin: SupabaseClient, tenantId: number) {
  let current = await getConnection(admin, tenantId)
  if (!current) return current
  if (current.instance_name && current.instance_name !== instanceNameFor(tenantId)) throw Object.assign(new Error('La conexión existente no coincide con este negocio.'), { status: 409, code: 'connection_identity_conflict' })
  const qrExpiry = Date.parse(String(current.qr_expires_at || current.pairing_expires_at || ''))
  if (current.qr_payload && Number.isFinite(qrExpiry) && qrExpiry <= Date.now()) {
    current = await updateObservedConnection(admin, tenantId, current, { qr_payload: null, qr_expires_at: null, pairing_expires_at: null })
  }
  if (Date.parse(String(current?.provisioning_lease_until || '')) > Date.now()) return current
  if (adapterMode() !== 'evolution' || !current.instance_name) return current
  let status
  try { status = await realEvolutionStatus(String(current.instance_name), current) }
  catch (error) {
    if ((error as { code?: string })?.code !== 'evolution_http_404') throw error
    status = { state: 'DISCONNECTED', reason: 'instance_missing', signals: { connectionState: null, fetchState: null } }
  }
  const nextMetadata = connectionMetadata(current, status.signals, status)
  if (!shouldPersistEvolutionStatus(String(current.state || ''), status.state, current.metadata as Record<string, unknown> || {})) return current
  const qrExpiresAt = ['QR_READY', 'CONNECTING'].includes(status.state) ? current.qr_expires_at : null
  const updated = await updateObservedConnection(admin, tenantId, current, {
    state: status.state,
    last_verified_at: new Date().toISOString(),
    qr_expires_at: qrExpiresAt,
    ...(status.state === 'CONNECTED' || status.reason === 'instance_missing' ? { qr_payload: null, pairing_expires_at: null } : {}),
    metadata: nextMetadata,
    last_error_code: status.state === 'ERROR' ? status.reason : null,
    last_error_message: status.state === 'ERROR' ? 'Evolution devolvió señales contradictorias.' : null,
  })
  if (updated?.state === status.state && updated.integration_id) {
    const integration = await admin.from('saas_integraciones').update({ estado: status.state === 'CONNECTED' ? 'conectado' : 'pendiente' }).eq('id', updated.integration_id).eq('barberia_id', tenantId)
    if (integration.error) throw Object.assign(new Error('No se pudo actualizar la integración.'), { status: 502, code: 'integration_update_failed' })
  }
  return updated
}

const headers = (request: Request): HeadersInit => {
  const origin = request.headers.get('origin') || ''
  const corsOrigin = qaProvisionCorsOrigin(origin, {
    appBaseUrl: Deno.env.get('APP_BASE_URL') || '',
    projectRef: projectRef(),
    environment: Deno.env.get('WHATSAPP_PROVISIONING_ENV') || '',
  })
  return { ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}), 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', Vary: 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }
}

function json(request: Request, body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: headers(request) }) }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: headers(request) })
  try {
    assertQaRuntime()
    const admin = adminClient()
    const user = await authenticate(request, admin)
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
    const url = new URL(request.url)
    const action = String(body.action || url.searchParams.get('action') || 'status').trim().toLowerCase()
    if (!ACTIONS.has(action)) throw Object.assign(new Error('Acción de WhatsApp inválida.'), { status: 422, code: 'invalid_action' })
    const tenant = await resolveTenant(admin, user.id, body.tenant_id || url.searchParams.get('tenant_id'), { manage: action !== 'status' })
    if (action === 'status') return json(request, { tenant_id: tenant.tenantId, connection: publicConnection(await refreshStatus(admin, tenant.tenantId), { includeQr: ['owner', 'admin'].includes(String(tenant.role)) }) })
    if (action === 'disconnect') {
      const result = await disconnect(admin, tenant.tenantId)
      return json(request, { tenant_id: tenant.tenantId, connection: publicConnection(result.connection), changed: Boolean(result.connection) })
    }
    const operationId = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(body.operation_id || '')) ? String(body.operation_id) : crypto.randomUUID()
    const result = await connect(admin, tenant.tenantId, operationId)
    return json(request, { tenant_id: tenant.tenantId, connection: publicConnection(result.connection, { includeQr: true, qr: result.qr }), idempotent: result.connection?.state === 'CONNECTED' })
  } catch (error) {
    const safe = safeError(error)
    return json(request, { error: safe }, Number((error as { status?: number })?.status) || 500)
  }
})
