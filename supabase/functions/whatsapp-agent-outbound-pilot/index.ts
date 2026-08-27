import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import {
  QA_AGENT_OUTBOUND_INSTANCE,
  QA_AGENT_OUTBOUND_TENANT_ID,
  PROTECTED_WHATSAPP_INSTANCE,
  agentOutboundGuard,
  buildAgentOutboundOperationId,
  isRealPersistedSourceMetadata,
  isQaAgentOutboundRuntime,
} from '../_shared/whatsappAgentOutboundPilot.mjs'
import { buildEvolutionSendTextPath, normalizeRecipient, sanitizeProviderResult } from '../_shared/whatsappOutboundPilot.mjs'

const MAX_EVENT_AGE_MS = 30 * 60 * 1000

function safeString(value: unknown) { return String(value || '').trim() }

function projectRef() {
  try { return new URL(safeString(Deno.env.get('SUPABASE_URL'))).hostname.split('.')[0].toLowerCase() } catch { return '' }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } })
}

function adminClient() {
  const url = safeString(Deno.env.get('SUPABASE_URL'))
  const key = safeString(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
  if (!url || !key) throw new Error('supabase_not_configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  if (a.length === 0 || a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index]
  return mismatch === 0
}

async function finishClaim(admin: ReturnType<typeof adminClient>, integrationId: number, operationId: string, result: string) {
  const { data, error } = await admin.rpc('finish_whatsapp_event', {
    p_integration_id: integrationId,
    p_event_id: operationId,
    p_status: 'completed',
    p_result_reference: result,
  })
  return !error && data === true
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    if (!safeString(request.headers.get('authorization')).toLowerCase().startsWith('bearer ')) return json({ error: 'authorization_required', outbound_allowed: false }, 401)
    const runtimeValid = isQaAgentOutboundRuntime({
      projectRef: projectRef(),
      provisioningEnv: safeString(Deno.env.get('WHATSAPP_PROVISIONING_ENV')),
      whatsappMode: safeString(Deno.env.get('WHATSAPP_MODE')),
      pilotMode: safeString(Deno.env.get('PILOT_MODE')),
    })
    if (!runtimeValid) return json({ error: 'qa_shadow_runtime_required', outbound_allowed: false }, 403)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Record<string, unknown>).some((key) => key !== 'event_id')) return json({ error: 'event_id_only', outbound_allowed: false }, 422)
    const eventId = safeString((body as Record<string, unknown>).event_id)
    const operationId = buildAgentOutboundOperationId(eventId)
    if (!operationId) return json({ error: 'event_id_required', outbound_allowed: false }, 422)

    const admin = adminClient()
    const { data: connection, error: connectionError } = await admin
      .from('saas_whatsapp_connections')
      .select('id,barberia_id,integration_id,provider,environment,state,instance_name')
      .eq('barberia_id', QA_AGENT_OUTBOUND_TENANT_ID)
      .eq('provider', 'evolution')
      .eq('environment', 'qa')
      .eq('instance_name', QA_AGENT_OUTBOUND_INSTANCE)
      .maybeSingle()
    if (connectionError) return json({ error: 'connection_lookup_failed', outbound_allowed: false }, 502)
    if (!connection || connection.state !== 'CONNECTED' || connection.instance_name === PROTECTED_WHATSAPP_INSTANCE) return json({ error: 'qa_connection_not_connected', outbound_allowed: false }, 409)

    const { data: integration, error: integrationError } = await admin
      .from('saas_integraciones')
      .select('id,barberia_id,proveedor,integration_type,estado')
      .eq('id', connection.integration_id)
      .eq('barberia_id', QA_AGENT_OUTBOUND_TENANT_ID)
      .maybeSingle()
    if (integrationError) return json({ error: 'integration_lookup_failed', outbound_allowed: false }, 502)

    const { data: sourceRun, error: sourceError } = await admin
      .from('saas_automation_shadow_runs')
      .select('id,tenant_id,integration_id,event_id,intent,metadata,observed_at')
      .eq('tenant_id', QA_AGENT_OUTBOUND_TENANT_ID)
      .eq('integration_id', connection.integration_id)
      .eq('event_id', eventId)
      .maybeSingle()
    if (sourceError) return json({ error: 'source_lookup_failed', outbound_allowed: false }, 502)
    if (!sourceRun) return json({ error: 'real_persisted_source_required', outbound_allowed: false }, 404)
    const metadata = sourceRun.metadata && typeof sourceRun.metadata === 'object' ? sourceRun.metadata as Record<string, unknown> : {}
    const proposedReply = safeString(metadata.proposed_reply)
    const sourceObservedAt = new Date(String(sourceRun.observed_at || '')).getTime()
    const sourceFresh = Number.isFinite(sourceObservedAt) && Date.now() - sourceObservedAt >= 0 && Date.now() - sourceObservedAt <= MAX_EVENT_AGE_MS
    const sourceEventReal = sourceFresh && isRealPersistedSourceMetadata(metadata)
    if (!sourceEventReal) return json({ error: 'fresh_source_event_required', outbound_allowed: false }, 409)

    const recipient = normalizeRecipient(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT'))
    if (!recipient) return json({ error: 'qa_recipient_not_configured', outbound_allowed: false }, 503)
    const recipientHash = safeString(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH'))
    const pilotEnabled = safeString(Deno.env.get('WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED')) === '1'
    const sourceHash = safeString(metadata.sender_hash)
    const senderMatches = constantTimeEqual(sourceHash, recipientHash)
    const guard = agentOutboundGuard({
      enabled: pilotEnabled,
      runtimeValid,
      tenantId: Number(connection.barberia_id),
      environment: connection.environment,
      connectionState: connection.state,
      integrationProvider: integration?.proveedor,
      integrationType: integration?.integration_type,
      integrationState: integration?.estado,
      instance: connection.instance_name,
      sourceEventPresent: true,
      sourceEventReal,
      sourceTenantId: Number(sourceRun.tenant_id),
      sourceIntegrationId: Number(sourceRun.integration_id),
      sourceFromMe: metadata.from_me === true,
      sourceEnvironment: safeString(metadata.environment),
      senderHashMatches: senderMatches,
      intent: sourceRun.intent,
      proposedReply,
      sourceMetadata: metadata,
      operationAcquired: true,
    })
    if (!guard.allowed) return json({ error: guard.reason, outbound_allowed: false }, 403)

    const { data: claim, error: claimError } = await admin.rpc('claim_whatsapp_event', {
      p_integration_id: connection.integration_id,
      p_event_id: operationId,
      p_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    if (claimError) return json({ error: 'outbound_claim_failed', outbound_allowed: false }, 502)
    const claimRow = Array.isArray(claim) ? claim[0] : claim
    if (!claimRow?.acquired) return json({ sent: false, duplicate: true, operation_id: operationId, outbound_allowed: false }, 202)

    const path = buildEvolutionSendTextPath(Deno.env.get('EVOLUTION_BASE_URL'), QA_AGENT_OUTBOUND_INSTANCE)
    const apiKey = safeString(Deno.env.get('EVOLUTION_API_KEY'))
    if (!path || !apiKey) return json({ error: 'evolution_send_not_configured', operation_id: operationId, outbound_allowed: false }, 503)

    let response: Response
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { apikey: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ number: recipient, text: proposedReply }),
      })
    } catch {
      return json({ error: 'evolution_send_failed_no_retry', operation_id: operationId, outbound_allowed: true }, 502)
    }
    const providerBody = await response.json().catch(() => null)
    if (!response.ok) return json({ error: 'evolution_send_failed_no_retry', operation_id: operationId, outbound_allowed: true }, 502)

    const providerResult = sanitizeProviderResult(providerBody)
    const completed = await finishClaim(admin, connection.integration_id, operationId, `agent_outbound_sent:${operationId}`)
    if (!completed) return json({ error: 'outbound_sent_audit_unknown_no_retry', operation_id: operationId, outbound_allowed: true }, 502)
    return json({ sent: true, duplicate: false, operation_id: operationId, ...providerResult, outbound_allowed: true, mutation_allowed: false })
  } catch (error) {
    const code = safeString((error as { message?: string })?.message).replace(/[^a-z0-9_:-]/gi, '').slice(0, 80) || 'agent_outbound_error'
    return json({ error: code, outbound_allowed: false }, 503)
  }
})
