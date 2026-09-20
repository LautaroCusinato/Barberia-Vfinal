const REQUIRED_NODES = [
  'Webhook Evolution - producción',
  'Validar identidad e idempotencia',
  'Identidad válida',
  'Resolver tenant',
  'Tenant encontrado',
  'Reclamar evento',
  'Evento nuevo',
  'Bloquear mutación de reserva',
  'Outbound habilitado para conexión',
  'Reclamar outbound',
  'Outbound nuevo',
  'Enviar respuesta Evolution',
  'Validar ACK Evolution',
  'Finalizar outbound',
]

const ALLOWED_NODE_TYPES = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.code',
  'n8n-nodes-base.if',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.merge',
])

function strings(value, path = '$', output = []) {
  if (typeof value === 'string') output.push({ path, value })
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${path}[${index}]`, output))
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => strings(item, `${path}.${key}`, output))
  return output
}

function destinations(workflow, name, branch = 0) {
  return (workflow.connections?.[name]?.main?.[branch] || []).map((edge) => edge.node)
}

export function validateProductionWorkflow(workflow) {
  const errors = []
  const add = (code, detail) => errors.push({ code, detail })
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
    add('WORKFLOW_INVALID', 'The workflow must be an object.')
    return { valid: false, errors }
  }

  if (workflow.name !== 'Austral WhatsApp Production - Controlled') add('WORKFLOW_NAME_INVALID', 'Unexpected workflow name.')
  if (workflow.active !== false) add('WORKFLOW_ACTIVE', 'The production template must remain inactive.')
  if (workflow.settings?.saveDataSuccessExecution !== 'none' || workflow.settings?.saveDataErrorExecution !== 'none' || workflow.settings?.saveManualExecutions !== false) {
    add('EXECUTION_RETENTION_ENABLED', 'Execution payload retention must remain disabled.')
  }
  if (!(workflow.settings?.executionTimeout > 0 && workflow.settings.executionTimeout <= 120)) add('EXECUTION_TIMEOUT_INVALID', 'Execution timeout must be between 1 and 120 seconds.')

  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : []
  const names = nodes.map((node) => node?.name)
  if (new Set(names).size !== names.length) add('NODE_NAME_DUPLICATE', 'Node names must be unique.')
  const byName = new Map(nodes.map((node) => [node?.name, node]))
  for (const name of REQUIRED_NODES) if (!byName.has(name)) add('REQUIRED_NODE_MISSING', name)

  for (const node of nodes) {
    if (!ALLOWED_NODE_TYPES.has(node?.type)) add('NODE_TYPE_DISALLOWED', `${node?.name || 'unnamed'}:${node?.type || 'missing'}`)
    if (node?.continueOnFail === true || node?.retryOnFail === true || /^continue/i.test(String(node?.onError || ''))) add('NODE_NOT_FAIL_CLOSED', node?.name || 'unnamed')
    if (node?.type === 'n8n-nodes-base.httpRequest' && node?.onError !== 'stopWorkflow') add('HTTP_NODE_NOT_FAIL_CLOSED', node?.name || 'unnamed')
    if (node?.credentials && Object.keys(node.credentials).length) add('CREDENTIALS_EMBEDDED', node?.name || 'unnamed')
  }

  const serialized = JSON.stringify(workflow)
  if (/miwsp|barber[ií]a central|austral-qa-tenant-|cmsymmszlzikqpvfqjre|ssagttjdgtypxjcgdnrw/i.test(serialized)) add('PROTECTED_OR_QA_HARDCODE', 'Protected instance, legacy tenant or known project ref found.')
  if (/\bBind QA\b[^.]{0,120}\bcredential/i.test(serialized)) add('QA_CREDENTIAL_REFERENCE', 'Production workflow still references a QA credential binding.')
  if (/https:\/\/[^"'\s}]+\.supabase\.co/i.test(serialized)) add('SUPABASE_ENDPOINT_HARDCODED', 'Supabase endpoints must use environment bindings.')
  if (/(?:tenant_id|barberia_id)\s*[:=]\s*[1-9]\d*/i.test(serialized)) add('TENANT_ID_HARDCODED', 'Numeric tenant authority is hardcoded.')
  if (/crear_reserva|cancelar_reserva|reprogramar_reserva|createPayment|mercadopago/i.test(serialized)) add('MUTATION_OR_BILLING_PRESENT', 'Booking or billing mutations are not permitted in this workflow.')

  for (const entry of strings(workflow)) {
    if (/\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i.test(entry.value) && !entry.value.includes('$env.')) add('SECRET_LITERAL', entry.path)
    if (/(?:api[_-]?key|password|secret|token)\s*[:=]\s*["'][A-Za-z0-9._~+/-]{12,}["']/i.test(entry.value) && !entry.value.includes('$env.')) add('SECRET_LITERAL', entry.path)
  }

  const inbound = byName.get('Validar identidad e idempotencia')?.parameters?.jsCode || ''
  for (const [pattern, detail] of [
    [/key\.fromMe === false/, 'fromMe=false'],
    [/MESSAGES_UPSERT/, 'MESSAGES_UPSERT'],
    [/validEventId/, 'eventId validation'],
    [/5 \* 60 \* 1000/, 'stale-event window'],
    [/2 \* 60 \* 1000/, 'future clock-skew window'],
    [/mutationAllowed:false,outboundAllowed:false/, 'default-off event capabilities'],
  ]) if (!pattern.test(inbound)) add('INBOUND_GUARD_MISSING', detail)

  const resolver = byName.get('Resolver tenant')?.parameters || {}
  if (!/resolve_whatsapp_runtime_context/.test(String(resolver.url || ''))) add('TENANT_RESOLUTION_MISSING', 'Resolver tenant must call the server-side RPC.')
  if (!/p_environment:\s*'production'/.test(String(resolver.jsonBody || ''))) add('TENANT_ENVIRONMENT_MISSING', 'Resolver tenant must pin production server-side.')
  if (/tenant_id|barberia_id/i.test(String(resolver.jsonBody || ''))) add('CLIENT_TENANT_AUTHORITY', 'Resolver tenant must not accept a tenant id.')

  if (!/claim_whatsapp_runtime_event/.test(JSON.stringify(byName.get('Reclamar evento')?.parameters || {}))) add('INBOUND_CLAIM_MISSING', 'Inbound claim RPC missing.')
  if (!/claim_whatsapp_runtime_event/.test(JSON.stringify(byName.get('Reclamar outbound')?.parameters || {}))) add('OUTBOUND_CLAIM_MISSING', 'Outbound claim RPC missing.')
  if (!/outbound_enabled/.test(JSON.stringify(byName.get('Outbound habilitado para conexión')?.parameters || {}))) add('OUTBOUND_GUARD_MISSING', 'Outbound flag guard missing.')
  if (!/mutationAllowed:false/.test(String(byName.get('Bloquear mutación de reserva')?.parameters?.jsCode || ''))) add('BOOKING_GUARD_MISSING', 'Booking mutation firewall missing.')
  if (!/message\/sendText/.test(String(byName.get('Enviar respuesta Evolution')?.parameters?.url || ''))) add('OUTBOUND_ENDPOINT_INVALID', 'Evolution sendText endpoint missing.')
  if (!/evolution_ack_missing_no_retry/.test(String(byName.get('Validar ACK Evolution')?.parameters?.jsCode || ''))) add('ACK_GUARD_MISSING', 'Ambiguous ACK guard missing.')

  if (!destinations(workflow, 'Webhook Evolution - producción').includes('Validar identidad e idempotencia')) add('INBOUND_ROUTE_INVALID', 'Webhook must route through the identity guard.')
  if (!destinations(workflow, 'Outbound habilitado para conexión', 0).includes('Reclamar outbound')) add('OUTBOUND_ROUTE_UNGUARDED', 'Enabled outbound must route through the atomic claim.')
  if (!destinations(workflow, 'Outbound habilitado para conexión', 1).includes('Finalizar evento')) add('OUTBOUND_DISABLED_ROUTE_INVALID', 'Disabled outbound must finalize without sending.')
  if (!destinations(workflow, 'Outbound nuevo', 0).includes('Enviar respuesta Evolution')) add('OUTBOUND_CLAIM_ROUTE_INVALID', 'Only a newly acquired claim may send.')
  if (!destinations(workflow, 'Outbound nuevo', 1).includes('Finalizar evento')) add('OUTBOUND_DUPLICATE_ROUTE_INVALID', 'Duplicate outbound must finalize without sending.')
  if (!destinations(workflow, 'Horario válido', 0).includes('Bloquear mutación de reserva')) add('BOOKING_ROUTE_UNGUARDED', 'Booking intent must route into the mutation firewall.')

  return { valid: errors.length === 0, errors }
}
