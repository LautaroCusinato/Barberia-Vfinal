import process from 'node:process'

const args = new Map(process.argv.slice(2).map((entry) => {
  const [key, ...value] = entry.replace(/^--/, '').split('=')
  return [key, value.join('=')]
}))

const environment = args.get('environment') || 'production'
const instance = args.get('instance') || ''
const expectedProject = process.env.WHATSAPP_RUNTIME_PROJECT_REF || ''
const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const evolutionUrl = (process.env.EVOLUTION_BASE_URL || '').replace(/\/+$/, '')
const evolutionKey = process.env.EVOLUTION_API_KEY || ''
const n8nUrl = (process.env.N8N_API_URL || '').replace(/\/+$/, '')
const n8nKey = process.env.N8N_API_KEY || ''
const n8nWorkflowId = process.env.N8N_PRODUCTION_WHATSAPP_WORKFLOW_ID || ''

const fail = (code) => {
  console.error(JSON.stringify({ status: 'STOP', code }))
  process.exit(1)
}

if (environment !== 'production') fail('production_environment_required')
if (process.env.WHATSAPP_DIAGNOSTICS_ALLOW_PRODUCTION_READONLY !== '1') fail('explicit_readonly_gate_required')
if (!/^austral-prod-tenant-[1-9]\d*$/.test(instance)) fail('managed_production_instance_required')
if (!supabaseUrl || !serviceKey || !evolutionUrl || !evolutionKey || !expectedProject) fail('server_credentials_required')

let projectRef = ''
try {
  projectRef = new URL(supabaseUrl).hostname.split('.')[0]
} catch {
  fail('invalid_supabase_url')
}
if (projectRef !== expectedProject) fail('project_ref_mismatch')

const withTimeout = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('http_' + response.status)
  return response
}

const supabaseHeaders = {
  apikey: serviceKey,
  Authorization: 'Bearer ' + serviceKey,
  'Content-Type': 'application/json',
}

const safeError = (error) => String(error?.message || 'unknown_error').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
const partialId = (value) => {
  const text = String(value || '')
  return text.length <= 10 ? text : text.slice(0, 5) + '…' + text.slice(-5)
}

const report = {
  mode: 'PRODUCTION_READ_ONLY',
  project_target: 'MATCH',
  instance_pattern: 'MANAGED',
  tenant_resolution: 'FAIL',
  evolution_state: 'UNKNOWN',
  evolution_webhook: 'UNKNOWN',
  n8n_workflow: n8nUrl && n8nKey && n8nWorkflowId ? 'UNKNOWN' : 'NOT_CONFIGURED',
  latest_event: null,
  latest_shadow: null,
  outbound_claims: null,
  booking_claims: null,
  errors: [],
}

let context
try {
  const response = await withTimeout(supabaseUrl + '/rest/v1/rpc/resolve_whatsapp_runtime_context', {
    method: 'POST',
    headers: supabaseHeaders,
    body: JSON.stringify({ p_environment: environment, p_external_instance_id: instance }),
  })
  const rows = await response.json()
  if (!Array.isArray(rows) || rows.length !== 1) fail('runtime_context_not_unique')
  context = rows[0]
  report.tenant_resolution = 'PASS'
  report.integration_id = context.integration_id
  report.tenant_id = context.tenant_id
  report.connection_state = {
    automation_enabled: context.automation_enabled === true,
    outbound_enabled: context.outbound_enabled === true,
    booking_enabled: context.booking_enabled === true,
  }
} catch (error) {
  report.errors.push({ stage: 'tenant_resolution', code: safeError(error) })
}

try {
  const response = await withTimeout(evolutionUrl + '/instance/connectionState/' + encodeURIComponent(instance), {
    headers: { apikey: evolutionKey },
  })
  const body = await response.json()
  const state = String(body?.instance?.state || body?.state || '').toLowerCase()
  report.evolution_state = state === 'open' ? 'CONNECTED' : state ? 'NOT_CONNECTED' : 'UNKNOWN'
} catch (error) {
  report.errors.push({ stage: 'evolution_state', code: safeError(error) })
}

try {
  const response = await withTimeout(evolutionUrl + '/webhook/find/' + encodeURIComponent(instance), {
    headers: { apikey: evolutionKey },
  })
  const body = await response.json()
  const webhook = Array.isArray(body) ? body[0] : body
  const events = webhook?.events || webhook?.webhook?.events || []
  report.evolution_webhook = {
    enabled: Boolean(webhook?.enabled ?? webhook?.webhook?.enabled),
    messages_upsert: Array.isArray(events) && events.map(String).some((event) => event.toUpperCase().replace(/[.\s-]+/g, '_') === 'MESSAGES_UPSERT'),
    has_url: Boolean(webhook?.url || webhook?.webhook?.url),
  }
} catch (error) {
  report.errors.push({ stage: 'evolution_webhook', code: safeError(error) })
}

if (context) {
  try {
    const query = new URLSearchParams({
      integration_id: 'eq.' + context.integration_id,
      select: 'event_id,status,created_at,processed_at,metadata',
      order: 'created_at.desc',
      limit: '20',
    })
    const response = await withTimeout(supabaseUrl + '/rest/v1/saas_automation_events?' + query, { headers: supabaseHeaders })
    const events = await response.json()
    const sourceEvents = events.filter((event) => !String(event.event_id).startsWith('outbound:') && !String(event.event_id).startsWith('booking:'))
    const latest = sourceEvents[0]
    report.latest_event = latest ? {
      event_id: partialId(latest.event_id),
      status: latest.status,
      created_at: latest.created_at,
      processed_at: latest.processed_at,
      operation: latest.metadata?.operation || 'inbound',
    } : null
    report.outbound_claims = events.filter((event) => String(event.event_id).startsWith('outbound:')).length
    report.booking_claims = events.filter((event) => String(event.event_id).startsWith('booking:')).length
  } catch (error) {
    report.errors.push({ stage: 'automation_events', code: safeError(error) })
  }

  try {
    const query = new URLSearchParams({
      integration_id: 'eq.' + context.integration_id,
      select: 'event_id,intent,proposed_result,proposed_response_length,observed_at,metadata',
      order: 'observed_at.desc',
      limit: '1',
    })
    const response = await withTimeout(supabaseUrl + '/rest/v1/saas_automation_shadow_runs?' + query, { headers: supabaseHeaders })
    const rows = await response.json()
    const latest = rows[0]
    report.latest_shadow = latest ? {
      event_id: partialId(latest.event_id),
      intent: latest.intent,
      result: latest.proposed_result,
      response_present: Number(latest.proposed_response_length) > 0,
      observed_at: latest.observed_at,
      mutation_allowed: latest.metadata?.mutation_allowed === true,
      outbound_allowed: latest.metadata?.outbound_allowed === true,
    } : null
  } catch (error) {
    report.errors.push({ stage: 'shadow_runs', code: safeError(error) })
  }
}

if (n8nUrl && n8nKey && n8nWorkflowId) {
  try {
    const response = await withTimeout(n8nUrl + '/api/v1/workflows/' + encodeURIComponent(n8nWorkflowId), {
      headers: { 'X-N8N-API-KEY': n8nKey },
    })
    const workflow = await response.json()
    report.n8n_workflow = {
      found: Boolean(workflow?.id),
      active: workflow?.active === true,
      name_matches: workflow?.name === 'Austral WhatsApp Production - Controlled',
    }
  } catch (error) {
    report.errors.push({ stage: 'n8n_workflow', code: safeError(error) })
  }
}

console.log(JSON.stringify(report, null, 2))
if (report.errors.length) process.exitCode = 2
