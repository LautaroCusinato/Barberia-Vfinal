import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import {
  QA_OUTBOUND_INSTANCE,
  QA_OUTBOUND_MESSAGE,
  QA_OUTBOUND_TENANT_ID,
  buildEvolutionSendTextPath,
  buildOutboundOperationId,
  isQaOutboundRuntime,
  normalizeRecipient,
  outboundPilotGuard,
  sanitizeProviderResult,
} from '../_shared/whatsappOutboundPilot.mjs'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const APPROVAL_HEADER = 'X-Austral-Outbound-Approval'

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

async function senderHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const bytes = new Uint8Array(digest)
  return `sha256:${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12)}`
}

async function markCompleted(admin: ReturnType<typeof adminClient>, integrationId: number, operationId: string, result: string) {
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
    const authorization = safeString(request.headers.get('authorization'))
    if (!authorization.toLowerCase().startsWith('bearer ')) return json({ error: 'authorization_required' }, 401)
    if (!isQaOutboundRuntime({
      projectRef: projectRef(),
      provisioningEnv: safeString(Deno.env.get('WHATSAPP_PROVISIONING_ENV')),
      whatsappMode: safeString(Deno.env.get('WHATSAPP_MODE')),
      pilotMode: safeString(Deno.env.get('PILOT_MODE')),
    })) return json({ error: 'qa_shadow_runtime_required', outbound_allowed: false }, 403)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_payload', outbound_allowed: false }, 422)
    const sourceEventId = safeString((body as Record<string, unknown>).source_event_id)
    if (!sourceEventId || Object.keys(body as Record<string, unknown>).some((key) => ['to', 'recipient', 'text', 'message'].includes(key))) {
      return json({ error: 'source_event_only', outbound_allowed: false }, 422)
    }

    const recipient = normalizeRecipient(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT'))
    const recipientHash = safeString(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH'))
    const approvalToken = safeString(Deno.env.get('WHATSAPP_OUTBOUND_PILOT_APPROVAL'))
    const enabled = safeString(Deno.env.get('WHATSAPP_OUTBOUND_PILOT_ENABLED')) === '1'
    if (!recipient || !/^sha256:[a-f0-9]{12}$/.test(recipientHash) || !approvalToken) return json({ error: 'outbound_pilot_not_configured', outbound_allowed: false }, 503)

    const admin = adminClient()
    const { data: connection, error: connectionError } = await admin
      .from('saas_whatsapp_connections')
      .select('id,barberia_id,integration_id,provider,environment,state,instance_name')
      .eq('barberia_id', QA_OUTBOUND_TENANT_ID)
      .eq('provider', 'evolution')
      .eq('environment', 'qa')
      .eq('instance_name', QA_OUTBOUND_INSTANCE)
      .maybeSingle()
    if (connectionError) return json({ error: 'connection_lookup_failed', outbound_allowed: false }, 502)
    if (!connection || connection.state !== 'CONNECTED') return json({ error: 'qa_connection_not_connected', outbound_allowed: false }, 409)

    const { data: sourceRun, error: sourceError } = await admin
      .from('saas_automation_shadow_runs')
      .select('id,tenant_id,integration_id,event_id,metadata')
      .eq('tenant_id', QA_OUTBOUND_TENANT_ID)
      .eq('integration_id', connection.integration_id)
      .eq('event_id', sourceEventId)
      .maybeSingle()
    if (sourceError) return json({ error: 'shadow_source_lookup_failed', outbound_allowed: false }, 502)
    const sourceMetadata = sourceRun?.metadata && typeof sourceRun.metadata === 'object' ? sourceRun.metadata as Record<string, unknown> : {}
    const sourceSenderHash = safeString(sourceMetadata.sender_hash)
    const operationId = buildOutboundOperationId(sourceEventId)
    if (!operationId) return json({ error: 'source_event_invalid', outbound_allowed: false }, 422)

    const recipientHashMatches = constantTimeEqual(sourceSenderHash, recipientHash)
    const approvalMatches = constantTimeEqual(safeString(request.headers.get(APPROVAL_HEADER)), approvalToken)
    const sourceFromMe = sourceMetadata.from_me === true
    const guard = outboundPilotGuard({
      enabled,
      approvalMatches,
      runtimeValid: true,
      tenantId: Number(sourceRun?.tenant_id),
      instance: connection.instance_name,
      sourceEventPresent: Boolean(sourceRun),
      sourceFromMe,
      sourceOutboundAllowed: sourceMetadata.outbound_allowed,
      sourceMutationAllowed: sourceMetadata.mutation_allowed,
      recipient,
      recipientHashMatches,
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

    const path = buildEvolutionSendTextPath(Deno.env.get('EVOLUTION_BASE_URL'), QA_OUTBOUND_INSTANCE)
    const apiKey = safeString(Deno.env.get('EVOLUTION_API_KEY'))
    if (!path || !apiKey) return json({ error: 'evolution_send_not_configured', operation_id: operationId, outbound_allowed: false }, 503)

    let response: Response
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { apikey: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ number: recipient, textMessage: { text: QA_OUTBOUND_MESSAGE } }),
      })
    } catch {
      return json({ error: 'evolution_send_failed_no_retry', operation_id: operationId, outbound_allowed: true }, 502)
    }
    const providerBody = await response.json().catch(() => null)
    if (!response.ok) return json({ error: 'evolution_send_failed_no_retry', operation_id: operationId, outbound_allowed: true }, 502)

    const providerResult = sanitizeProviderResult(providerBody)
    const completed = await markCompleted(admin, connection.integration_id, operationId, `outbound_qa_sent:${operationId}`)
    if (!completed) return json({ error: 'outbound_sent_audit_unknown_no_retry', operation_id: operationId, outbound_allowed: true }, 502)
    return json({ sent: true, duplicate: false, operation_id: operationId, ...providerResult, outbound_allowed: true, mutation_allowed: false })
  } catch (error) {
    const code = safeString((error as { message?: string })?.message).replace(/[^a-z0-9_:-]/gi, '').slice(0, 80) || 'outbound_error'
    return json({ error: code, outbound_allowed: false }, 503)
  }
})
