const rank = { PASS: 0, WARN: 1, FAIL: 2 }

function add(checks, status, code, message) {
  checks.push({ status, code, message })
}

export function finalizeProductionDiagnostics(report, { now = new Date() } = {}) {
  const checks = []
  const capabilities = report?.capabilities || {}
  const connection = report?.connection || {}

  add(checks, report?.project_target === 'MATCH' ? 'PASS' : 'FAIL', report?.project_target === 'MATCH' ? 'PROJECT_TARGET_MATCH' : 'PROJECT_TARGET_MISMATCH', report?.project_target === 'MATCH' ? 'El diagnóstico apunta al proyecto esperado.' : 'El proyecto no coincide con el target esperado.')
  add(checks, report?.tenant_resolution === 'PASS' ? 'PASS' : 'FAIL', report?.tenant_resolution === 'PASS' ? 'TENANT_RESOLUTION_READY' : 'TENANT_RESOLUTION_FAILED', report?.tenant_resolution === 'PASS' ? 'La instancia resuelve un único tenant server-side.' : 'La instancia no resolvió un tenant único.')

  if (connection.state === 'ERROR') add(checks, 'FAIL', 'PROVISIONING_FAILED', 'La conexión está en ERROR; revisar el código sanitizado antes de reintentar.')
  else if (connection.state === 'CONNECTED') add(checks, 'PASS', 'DATABASE_CONNECTION_CONNECTED', 'La conexión figura CONNECTED en la base.')
  else if (connection.state) add(checks, 'WARN', 'DATABASE_CONNECTION_NOT_CONNECTED', 'La conexión todavía no figura CONNECTED en la base.')
  else add(checks, 'FAIL', 'DATABASE_CONNECTION_MISSING', 'No se pudo leer una conexión productiva única.')

  if (report?.evolution_state === 'CONNECTED') add(checks, 'PASS', 'EVOLUTION_CONNECTED', 'Evolution informa estado conectado.')
  else if (report?.evolution_state === 'NOT_CONNECTED') add(checks, connection.state === 'CONNECTED' ? 'FAIL' : 'WARN', connection.state === 'CONNECTED' ? 'CONNECTION_STATE_DRIFT' : 'EVOLUTION_NOT_CONNECTED', connection.state === 'CONNECTED' ? 'La base figura CONNECTED pero Evolution no; la conexión está degradada.' : 'Evolution todavía no informa conexión estable.')
  else add(checks, 'FAIL', 'EVOLUTION_STATE_UNKNOWN', 'No se pudo confirmar el estado de Evolution.')

  const webhook = report?.evolution_webhook
  const webhookReady = webhook && webhook.enabled === true && webhook.messages_upsert === true && webhook.has_url === true
  add(checks, webhookReady ? 'PASS' : 'FAIL', webhookReady ? 'WEBHOOK_READY' : 'WEBHOOK_INVALID', webhookReady ? 'El webhook está habilitado para MESSAGES_UPSERT.' : 'El webhook falta, está deshabilitado o no escucha MESSAGES_UPSERT.')

  if (report?.n8n_workflow === 'NOT_CONFIGURED') add(checks, 'WARN', 'N8N_DIAGNOSTICS_NOT_CONFIGURED', 'No se configuró el acceso read-only al diagnóstico de n8n.')
  else {
    const workflow = report?.n8n_workflow || {}
    const identityReady = workflow.found === true && workflow.name_matches === true
    add(checks, identityReady ? 'PASS' : 'FAIL', identityReady ? 'N8N_WORKFLOW_FOUND' : 'N8N_WORKFLOW_INVALID', identityReady ? 'El workflow productivo esperado existe.' : 'El workflow productivo falta o no coincide en identidad.')
    if (capabilities.automation_enabled === true && workflow.active !== true) add(checks, 'FAIL', 'N8N_INACTIVE_WITH_AUTOMATION_ENABLED', 'La automatización del tenant está habilitada pero el workflow está inactivo.')
    else if (workflow.active === true) add(checks, 'PASS', 'N8N_WORKFLOW_ACTIVE', 'El workflow productivo está activo.')
    else add(checks, 'PASS', 'N8N_WORKFLOW_INACTIVE_SAFE', 'El workflow permanece inactivo mientras la automatización del tenant está apagada.')
  }

  const invalidFlags = capabilities.outbound_enabled === true && capabilities.automation_enabled !== true
    || capabilities.booking_enabled === true && (capabilities.automation_enabled !== true || capabilities.outbound_enabled !== true)
  add(checks, invalidFlags ? 'FAIL' : 'PASS', invalidFlags ? 'CAPABILITY_FLAGS_INVALID' : 'CAPABILITY_FLAGS_VALID', invalidFlags ? 'Los flags tienen una combinación insegura.' : 'Los flags respetan el orden automation → outbound → booking.')

  const events = report?.event_window || {}
  if (Number(events.failed_15m) >= 3) add(checks, 'FAIL', 'REPEATED_EVENT_FAILURES', 'Hay tres o más eventos fallidos recientes.')
  else if (Number(events.failed_15m) > 0) add(checks, 'WARN', 'RECENT_EVENT_FAILURE', 'Hay eventos fallidos recientes para revisar.')
  else add(checks, 'PASS', 'NO_RECENT_EVENT_FAILURES', 'No se observaron eventos fallidos en la muestra reciente.')

  if (Number(events.stale_processing) > 0) add(checks, 'FAIL', 'STALE_PROCESSING_EVENTS', 'Hay eventos processing sin finalizar por más de cinco minutos.')
  else add(checks, 'PASS', 'NO_STALE_PROCESSING_EVENTS', 'No hay eventos processing trabados en la muestra reciente.')

  if (report?.binding_consistent === false) add(checks, 'FAIL', 'RUNTIME_BINDING_DRIFT', 'La conexión leída no coincide con el tenant, integración o instancia resueltos.')
  else if (report?.binding_consistent === true) add(checks, 'PASS', 'RUNTIME_BINDING_CONSISTENT', 'Tenant, integración e instancia mantienen un vínculo consistente.')

  for (const error of Array.isArray(report?.errors) ? report.errors : []) add(checks, 'FAIL', 'DIAGNOSTIC_STAGE_FAILED', `Falló el check read-only ${String(error?.stage || 'unknown').slice(0, 40)}.`)

  const status = checks.reduce((current, check) => rank[check.status] > rank[current] ? check.status : current, 'PASS')
  const safeReport = {
    mode: report?.mode,
    project_target: report?.project_target,
    instance_pattern: report?.instance_pattern,
    tenant_resolution: report?.tenant_resolution,
    tenant_id: report?.tenant_id ?? null,
    integration_id: report?.integration_id ?? null,
    connection: report?.connection ? {
      state: report.connection.state,
      instance_name: report.connection.instance_name,
      provisioning_mode: report.connection.provisioning_mode,
      last_error_code: report.connection.last_error_code,
      last_verified_at: report.connection.last_verified_at,
      qr_expires_at: report.connection.qr_expires_at,
    } : null,
    capabilities: report?.capabilities ? {
      automation_enabled: report.capabilities.automation_enabled === true,
      outbound_enabled: report.capabilities.outbound_enabled === true,
      booking_enabled: report.capabilities.booking_enabled === true,
    } : null,
    binding_consistent: report?.binding_consistent ?? null,
    evolution_state: report?.evolution_state,
    evolution_webhook: report?.evolution_webhook && typeof report.evolution_webhook === 'object' ? {
      enabled: report.evolution_webhook.enabled === true,
      messages_upsert: report.evolution_webhook.messages_upsert === true,
      has_url: report.evolution_webhook.has_url === true,
    } : report?.evolution_webhook,
    n8n_workflow: report?.n8n_workflow && typeof report.n8n_workflow === 'object' ? {
      found: report.n8n_workflow.found === true,
      active: report.n8n_workflow.active === true,
      name_matches: report.n8n_workflow.name_matches === true,
    } : report?.n8n_workflow,
    latest_event: report?.latest_event || null,
    latest_shadow: report?.latest_shadow || null,
    event_window: report?.event_window || null,
    outbound_claims: report?.outbound_claims ?? null,
    booking_claims: report?.booking_claims ?? null,
    errors: (Array.isArray(report?.errors) ? report.errors : []).map((error) => ({ stage: error?.stage, code: error?.code })),
  }
  return {
    ...safeReport,
    evaluated_at: now.toISOString(),
    status,
    summary: {
      pass: checks.filter((check) => check.status === 'PASS').length,
      warn: checks.filter((check) => check.status === 'WARN').length,
      fail: checks.filter((check) => check.status === 'FAIL').length,
    },
    checks,
  }
}
