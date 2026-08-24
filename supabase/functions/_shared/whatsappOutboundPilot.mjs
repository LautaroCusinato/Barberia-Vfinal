export const QA_OUTBOUND_TENANT_ID = 1
export const QA_OUTBOUND_INSTANCE = 'austral-qa-tenant-1'
export const PROTECTED_INSTANCE = 'miwsp'
export const QA_OUTBOUND_MESSAGE = 'Prueba QA de Austral: respuesta enviada correctamente.'

const textFrom = (value) => String(value ?? '').trim()

export function normalizeRecipient(value) {
  const raw = textFrom(value).toLowerCase()
  if (!raw || raw.includes('@g.us') || raw.includes('@broadcast')) return null
  const digits = raw.replace(/@s\.whatsapp\.net$/, '').replace(/\D/g, '')
  return /^\d{8,20}$/.test(digits) ? digits : null
}

export function isQaOutboundRuntime({ projectRef, provisioningEnv, whatsappMode, pilotMode }) {
  return projectRef === 'cmsymmszlzikqpvfqjre'
    && provisioningEnv === 'qa'
    && whatsappMode === 'shadow'
    && pilotMode === 'shadow'
}

export function buildOutboundOperationId(sourceEventId) {
  const eventId = textFrom(sourceEventId).replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 160)
  return eventId ? `qa-outbound:${eventId}` : null
}

export function buildEvolutionSendTextPath(baseUrl, instance = QA_OUTBOUND_INSTANCE) {
  const raw = textFrom(baseUrl)
  let url
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.hostname.toLowerCase() !== 'evolution.cuchitron.lat') return null
  if (instance !== QA_OUTBOUND_INSTANCE || instance === PROTECTED_INSTANCE) return null
  return `${url.toString().replace(/\/$/, '')}/message/sendText/${encodeURIComponent(instance)}`
}

export function outboundPilotGuard({
  enabled,
  approvalMatches,
  runtimeValid,
  tenantId,
  instance,
  sourceEventPresent,
  sourceFromMe,
  sourceOutboundAllowed,
  sourceMutationAllowed,
  recipient,
  recipientHashMatches,
  operationAcquired,
}) {
  if (!runtimeValid) return { allowed: false, reason: 'qa_shadow_runtime_required' }
  if (enabled !== true) return { allowed: false, reason: 'outbound_pilot_disabled' }
  if (approvalMatches !== true) return { allowed: false, reason: 'one_shot_approval_required' }
  if (tenantId !== QA_OUTBOUND_TENANT_ID) return { allowed: false, reason: 'qa_tenant_required' }
  if (instance !== QA_OUTBOUND_INSTANCE || instance === PROTECTED_INSTANCE) return { allowed: false, reason: 'qa_instance_required' }
  if (sourceEventPresent !== true) return { allowed: false, reason: 'shadow_source_event_required' }
  if (sourceFromMe === true) return { allowed: false, reason: 'from_me_ignored' }
  if (sourceOutboundAllowed !== false || sourceMutationAllowed !== false) return { allowed: false, reason: 'shadow_source_not_hard_disabled' }
  if (!recipient || recipientHashMatches !== true) return { allowed: false, reason: 'recipient_not_allowlisted' }
  if (operationAcquired !== true) return { allowed: false, reason: 'operation_already_claimed' }
  return { allowed: true, reason: null }
}

export function sanitizeProviderResult(body) {
  const value = body && typeof body === 'object' ? body : {}
  const key = value.key && typeof value.key === 'object' ? value.key : {}
  const status = textFrom(value.status).slice(0, 40) || null
  const messageId = textFrom(key.id).slice(0, 120) || null
  return { provider_status: status, provider_message_id: messageId }
}
