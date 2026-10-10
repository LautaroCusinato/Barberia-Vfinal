import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { manualQaEnabled, manualQaCapabilities, manualQaRecipient } from '../_shared/qaManualRuntime.mjs'
import { acceptedManualReceipt, parseAcceptedManualReceipt, persistManualMessage } from '../_shared/qaManualMessages.mjs'
import { requireOperator } from '../_shared/supabase.ts'
import { conciergeConfirmation } from '../_shared/whatsappConcierge.mjs'
import {
  PROTECTED_WHATSAPP_INSTANCE,
  agentOutboundGuard,
  buildAgentOutboundOperationId,
  buildBookingConfirmationOperationId,
  classifyEvolutionSendOutcome,
  isQaAgentOutboundTenantAllowed,
  isPersistedConversationScope,
  isRealPersistedSourceMetadata,
  isQaAgentOutboundRuntime,
  parseQaAgentOutboundTenantAllowlist,
  qa927OneShotOperationId,
  qaAgentOutboundInstanceForTenant,
} from '../_shared/whatsappAgentOutboundPilot.mjs'
import { evaluateBotPause } from '../_shared/whatsappBotPause.mjs'
import { SLOT_REJECTION_REASONS, buildBookingClaimEventId, buildBookingConfirmedReply, buildSlotRejectedOperationId, buildSlotRejectedReply } from '../_shared/whatsappBookingMutation.mjs'
import { canonicalArgentineMobile } from '../_shared/whatsappCustomer.mjs'
import { isQa927WindowOpen } from '../_shared/whatsappQa927Window.mjs'
import { buildQaEvolutionSendTextPath, normalizeRecipient, sanitizeProviderResult } from '../_shared/whatsappOutboundPilot.mjs'

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

async function finishClaim(admin: ReturnType<typeof adminClient>, integrationId: number, operationId: string, result: string, status: 'completed' | 'failed' = 'completed') {
  const { data, error } = await admin.rpc('finish_whatsapp_event', {
    p_integration_id: integrationId,
    p_event_id: operationId,
    p_status: status,
    p_result_reference: result,
  })
  return !error && data === true
}

async function botPauseBlock(admin: ReturnType<typeof adminClient>, tenantId: number) {
  const { data, error } = await admin.from('config').select('barberia_id,clave,valor').eq('barberia_id', tenantId).eq('clave', 'bot_activo')
  if (error) return 'manual_pause_lookup_failed'
  try { return evaluateBotPause(data || [], tenantId).botActive ? null : 'bot_paused' }
  catch { return 'manual_pause_lookup_failed' }
}

async function recoverAcceptedManualReply(admin: ReturnType<typeof adminClient>, integrationId: number, operationId: string, recipient: string) {
  const { data, error } = await admin.from('saas_automation_events').select('status,result_reference')
    .eq('integration_id', integrationId).eq('event_id', operationId).maybeSingle()
  if (error) throw new Error('qa_panel_receipt_lookup_failed')
  if (data?.status !== 'completed') return null
  const receipt = parseAcceptedManualReceipt(data.result_reference, { integrationId, operationId, getEnv: (name: string) => Deno.env.get(name) })
  if (!receipt) return null
  // Además de la lista permitida, el recibo debe ser del remitente de ESTE
  // evento persistido. Reparar no permite mover una respuesta entre clientes.
  if (receipt.phone !== canonicalArgentineMobile(recipient)) throw new Error('qa_panel_receipt_recipient_mismatch')
  return persistManualMessage(admin, receipt)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    if (!safeString(request.headers.get('authorization')).toLowerCase().startsWith('bearer ')) return json({ error: 'authorization_required', outbound_allowed: false }, 401)
    try { await requireOperator(request, adminClient()) } catch (error) { return json({ error: String((error as { code?: string })?.code || 'authorization_required'), outbound_allowed: false }, Number((error as { status?: number })?.status) || 401) }
    const runtimeValid = isQaAgentOutboundRuntime({
      projectRef: projectRef(),
      provisioningEnv: safeString(Deno.env.get('WHATSAPP_PROVISIONING_ENV')),
      whatsappMode: safeString(Deno.env.get('WHATSAPP_MODE')),
      pilotMode: safeString(Deno.env.get('PILOT_MODE')),
    })
    if (!runtimeValid) return json({ error: 'qa_shadow_runtime_required', outbound_allowed: false }, 403)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Record<string, unknown>).some((key) => key !== 'event_id' && key !== 'kind')) return json({ error: 'event_id_only', outbound_allowed: false }, 422)
    const eventId = safeString((body as Record<string, unknown>).event_id)
    // kind=booking_confirmation: aviso posterior a guardar el turno. El texto
    // se arma con la fila guardada, nunca con la propuesta del modelo.
    const kind = safeString((body as Record<string, unknown>).kind) || 'proposal'
    // kind=booking_slot_rejected (tarea 41): el horario confirmado fue
    // rechazado (bloqueado u ocupado) y no se guardó ningún turno.
    if (kind !== 'proposal' && kind !== 'booking_confirmation' && kind !== 'booking_slot_rejected') return json({ error: 'kind_not_supported', outbound_allowed: false }, 422)
    const eventOperationId = buildAgentOutboundOperationId(eventId)
    if (!eventOperationId) return json({ error: 'event_id_required', outbound_allowed: false }, 422)

    const admin = adminClient()
    const { data: sourceRun, error: sourceError } = await admin
      .from('saas_automation_shadow_runs')
      .select('id,tenant_id,integration_id,event_id,intent,metadata,observed_at')
      .eq('event_id', eventId)
      .maybeSingle()
    if (sourceError) return json({ error: 'source_lookup_failed', outbound_allowed: false }, 502)
    if (!sourceRun) return json({ error: 'real_persisted_source_required', outbound_allowed: false }, 404)

    const tenantId = Number(sourceRun.tenant_id)
    const integrationId = Number(sourceRun.integration_id)
    const manual = manualQaEnabled((name: string) => Deno.env.get(name), tenantId, qaAgentOutboundInstanceForTenant(tenantId))
    const allowedTenantIds = parseQaAgentOutboundTenantAllowlist(Deno.env.get('WHATSAPP_AGENT_OUTBOUND_ALLOWED_TENANT_IDS'))
    const tenantAllowlisted = manual || isQaAgentOutboundTenantAllowed(tenantId, allowedTenantIds)
    if (!tenantAllowlisted) return json({ error: 'qa_tenant_not_allowlisted', outbound_allowed: false }, 403)
    const expectedInstance = qaAgentOutboundInstanceForTenant(tenantId)
    if (!expectedInstance || expectedInstance === PROTECTED_WHATSAPP_INSTANCE) return json({ error: 'qa_instance_required', outbound_allowed: false }, 403)
    // Recorrido one-shot del 927 (otro chat), sólo con su flag legado activo.
    const legacy927 = tenantId === 927 && safeString(Deno.env.get('WHATSAPP_QA_927_AUTOMATION_ENABLED')) === '1' && kind === 'proposal'
    let operationId = legacy927 ? qa927OneShotOperationId(Deno.env.get('WHATSAPP_QA_927_OUTBOUND_RUN_ID')) : eventOperationId
    if (!operationId) return json({ error: 'qa_927_one_shot_not_configured', outbound_allowed: false }, 503)
    if (legacy927 && !isQa927WindowOpen(Deno.env.get('WHATSAPP_QA_927_OUTBOUND_EXPIRES_AT'))) return json({ error: 'qa_927_window_closed', outbound_allowed: false }, 403)

    const { data: connection, error: connectionError } = await admin
      .from('saas_whatsapp_connections')
      .select('id,barberia_id,integration_id,provider,environment,state,instance_name,automation_enabled,outbound_enabled,booking_enabled,handoff_enabled')
      .eq('barberia_id', tenantId)
      .eq('integration_id', integrationId)
      .eq('provider', 'evolution')
      .eq('environment', 'qa')
      .maybeSingle()
    if (connectionError) return json({ error: 'connection_lookup_failed', outbound_allowed: false }, 502)
    if (!connection || Number(connection.barberia_id) !== tenantId || Number(connection.integration_id) !== integrationId || connection.instance_name !== expectedInstance || connection.instance_name === PROTECTED_WHATSAPP_INSTANCE) return json({ error: 'qa_connection_not_connected', outbound_allowed: false }, 409)
    // Los pilotos anteriores conservan el gate en el mismo punto. QA928
    // primero puede reparar un recibo pasado; más abajo exige estos mismos
    // estados antes de intentar cualquier envío nuevo.
    if (!manual && connection.state !== 'CONNECTED') return json({ error: 'qa_connection_not_connected', outbound_allowed: false }, 409)
    if (legacy927 && (connection.automation_enabled !== true || connection.outbound_enabled !== true || connection.booking_enabled !== false || connection.handoff_enabled !== false)) return json({ error: 'qa_927_flags_not_ready', outbound_allowed: false }, 403)

    // Conserva el orden de la pausa en los pilotos anteriores.
    if (!manual) {
      const paused = await botPauseBlock(admin, tenantId)
      if (paused) return json({ error: paused, outbound_allowed: false }, paused === 'bot_paused' ? 409 : 502)
    }

    const { data: integration, error: integrationError } = await admin
      .from('saas_integraciones')
      .select('id,barberia_id,proveedor,integration_type,estado')
      .eq('id', connection.integration_id)
      .eq('barberia_id', tenantId)
      .maybeSingle()
    if (integrationError) return json({ error: 'integration_lookup_failed', outbound_allowed: false }, 502)

    const metadata = sourceRun.metadata && typeof sourceRun.metadata === 'object' ? sourceRun.metadata as Record<string, unknown> : {}
    let proposedReply = safeString(metadata.proposed_reply)
    const sourceObservedAt = new Date(String(sourceRun.observed_at || '')).getTime()
    const sourceFresh = Number.isFinite(sourceObservedAt) && Date.now() - sourceObservedAt >= 0 && Date.now() - sourceObservedAt <= MAX_EVENT_AGE_MS
    const sourceEventReal = isRealPersistedSourceMetadata(metadata)
    if (!manual && (!sourceFresh || !sourceEventReal)) return json({ error: 'fresh_source_event_required', outbound_allowed: false }, 409)

    const manualRecipient = manual ? await manualQaRecipient((name: string) => Deno.env.get(name), safeString(metadata.sender_hash), metadata.qa_manual_sender_phone) : null
    const recipient = manual ? manualRecipient?.recipient : normalizeRecipient(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT'))
    if (!recipient) return json({ error: 'qa_recipient_not_configured', outbound_allowed: false }, 503)

    if (manual) {
      const scopeValid = sourceEventReal && safeString(metadata.instance) === expectedInstance
        && integration?.proveedor === 'evolution' && integration?.integration_type === 'whatsapp'
        && Number(integration?.barberia_id) === tenantId && Number(integration?.id) === integrationId
        && isPersistedConversationScope(metadata, { tenantId, integrationId, instance: expectedInstance, senderHash: safeString(metadata.sender_hash) })
      if (!scopeValid) return json({ error: 'qa_manual_receipt_scope_required', outbound_allowed: false }, 403)
      try {
        // La confirmación se identifica por el turno del reclamo ya guardado,
        // sin exigir que ese turno siga activo para conservar su mensaje pasado.
        let recoveryOperationId = kind === 'booking_slot_rejected' ? buildSlotRejectedOperationId(eventId) : operationId
        if (kind === 'booking_confirmation') {
          const state = metadata.conversation_state && typeof metadata.conversation_state === 'object' ? metadata.conversation_state as Record<string, unknown> : {}
          const claimKey = buildBookingClaimEventId(state)
          recoveryOperationId = null
          if (claimKey) {
            const { data: bookingClaim, error: bookingClaimError } = await admin.from('saas_automation_events').select('status,result_reference')
              .eq('integration_id', integrationId).eq('event_id', claimKey).maybeSingle()
            if (bookingClaimError) throw new Error('qa_panel_booking_receipt_lookup_failed')
            if (bookingClaim?.status === 'completed' && /^\d+$/.test(safeString(bookingClaim.result_reference))) recoveryOperationId = buildBookingConfirmationOperationId(bookingClaim.result_reference)
          }
        }
        const recovered = recoveryOperationId ? await recoverAcceptedManualReply(admin, integrationId, recoveryOperationId, recipient) : null
        if (recovered) return json({ sent: true, duplicate: true, send_outcome: 'accepted', panel_message_persisted: true, operation_id: recoveryOperationId, outbound_allowed: false }, 202)
      } catch { return json({ error: 'qa_panel_recovery_failed_no_retry', duplicate: true, operation_id: operationId, outbound_allowed: false }, 502) }
      // Sin recibo duradero no se amplía permiso: un envío nuevo conserva
      // conexión, capacidades, frescura y todos los demás gates actuales.
      if (!manualQaCapabilities(connection)) return json({ error: 'qa_manual_flags_not_ready', outbound_allowed: false }, 409)
      if (connection.state !== 'CONNECTED') return json({ error: 'qa_connection_not_connected', outbound_allowed: false }, 409)
      if (!sourceFresh || !sourceEventReal) return json({ error: 'fresh_source_event_required', outbound_allowed: false }, 409)
    }

    let bookingPersisted = false
    if (kind === 'proposal' && ['barber_selection_required','quote_changed'].includes(safeString((metadata.booking_follow_up as Record<string, unknown> | undefined)?.reason))) {
      // Se recupera primero cualquier recibo aceptado. Un envío nuevo no
      // puede contradecir una reserva guardada o cuyo resultado esté en curso.
      const followUp = metadata.booking_follow_up as Record<string, unknown>
      const { data: claim, error } = await admin.from('saas_automation_events').select('status')
        .eq('integration_id', integrationId).eq('event_id', followUp.claim_key).maybeSingle()
      if (error || claim) return json({ error: 'booking_follow_up_claim_conflict', outbound_allowed: false }, 409)
    }
    if (kind === 'booking_confirmation') {
      // El turno tiene que estar guardado por crear_reserva_whatsapp para esta
      // misma conversación (reclamo completado) y ser de este negocio y de
      // este mismo destinatario.
      const state = metadata.conversation_state && typeof metadata.conversation_state === 'object' ? metadata.conversation_state as Record<string, unknown> : {}
      const claimKey = buildBookingClaimEventId(state)
      if (!claimKey) return json({ error: 'booking_claim_key_invalid', outbound_allowed: false }, 409)
      const { data: claimRow, error: claimLookupError } = await admin
        .from('saas_automation_events')
        .select('status,result_reference')
        .eq('integration_id', integrationId)
        .eq('event_id', claimKey)
        .maybeSingle()
      if (claimLookupError) return json({ error: 'booking_claim_lookup_failed', outbound_allowed: false }, 502)
      if (claimRow?.status !== 'completed' || !/^\d+$/.test(safeString(claimRow?.result_reference))) return json({ error: 'booking_not_persisted', outbound_allowed: false }, 409)
      const { data: turno, error: turnoError } = await admin
        .from('turnos')
        .select('id,barberia_id,servicio_id,barbero_id,paciente,precio,motivo,fecha,hora,estado,origen,telefono')
        .eq('id', Number(claimRow.result_reference))
        .eq('barberia_id', tenantId)
        .maybeSingle()
      if (turnoError) return json({ error: 'booking_lookup_failed', outbound_allowed: false }, 502)
      if (!turno || turno.origen !== 'whatsapp' || ['cancelado', 'no_asistio'].includes(safeString(turno.estado)) || safeString(turno.telefono) !== canonicalArgentineMobile(recipient)) return json({ error: 'booking_not_persisted', outbound_allowed: false }, 409)
      const [{ data: service }, { data: business }] = await Promise.all([
        admin.from('servicios').select('nombre').eq('id', turno.servicio_id).eq('barberia_id', tenantId).maybeSingle(),
        admin.from('barberias').select('nombre,moneda').eq('id', tenantId).maybeSingle(),
      ])
      proposedReply = safeString(buildBookingConfirmedReply({ businessName: business?.nombre, serviceName: service?.nombre, fecha: turno.fecha, hora: turno.hora }))
      if (manual && Deno.env.get('WHATSAPP_QA_MANUAL_CONCIERGE_ENABLED') === '1') {
        const { data: barber } = await admin.from('barberos').select('nombre').eq('id', turno.barbero_id).eq('barberia_id', tenantId).maybeSingle()
        proposedReply = conciergeConfirmation({ turno, service, business, barber })
      }
      operationId = buildBookingConfirmationOperationId(turno.id)
      if (!operationId || !proposedReply) return json({ error: 'booking_confirmation_invalid', outbound_allowed: false }, 409)
      bookingPersisted = true
    }
    if (kind === 'booking_slot_rejected') {
      // Sólo si la reserva marcó el rechazo para este evento, la conversación
      // ya volvió a "elegir horario" y el turno de esa propuesta no existe.
      const rejection = metadata.booking_rejection && typeof metadata.booking_rejection === 'object' ? metadata.booking_rejection as Record<string, unknown> : null
      const state = metadata.conversation_state && typeof metadata.conversation_state === 'object' ? metadata.conversation_state as Record<string, unknown> : {}
      const reason = safeString(rejection?.reason)
      if (!rejection || !SLOT_REJECTION_REASONS.includes(reason) || state.confirmation_state === 'confirmed' || state.ready_for_booking_mutation === true) return json({ error: 'slot_rejection_not_found', outbound_allowed: false }, 409)
      const claimKey = safeString(rejection.claim_key)
      if (!/^booking:/.test(claimKey)) return json({ error: 'slot_rejection_not_found', outbound_allowed: false }, 409)
      const { data: claimRow, error: claimLookupError } = await admin
        .from('saas_automation_events')
        .select('status')
        .eq('integration_id', integrationId)
        .eq('event_id', claimKey)
        .maybeSingle()
      if (claimLookupError) return json({ error: 'booking_claim_lookup_failed', outbound_allowed: false }, 502)
      if (claimRow?.status === 'completed') return json({ error: 'booking_already_persisted', outbound_allowed: false }, 409)
      const alternatives = Array.isArray(rejection.alternatives) ? rejection.alternatives.map((value) => safeString(value)) : null
      proposedReply = safeString(buildSlotRejectedReply({ reason, alternatives }))
      operationId = buildSlotRejectedOperationId(eventId)
      if (!operationId || !proposedReply) return json({ error: 'slot_rejection_invalid', outbound_allowed: false }, 409)
    }
    // La pausa por atención humana se vuelve a leer justo antes de enviar: si
    // alguien del equipo tomó el chat después de la propuesta, no se responde.
    if (manual) {
      const paused = await botPauseBlock(admin, tenantId)
      if (paused) return json({ error: paused, outbound_allowed: false }, paused === 'bot_paused' ? 409 : 502)
    }
    const recipientHash = manual ? manualRecipient?.recipientHash || '' : safeString(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH'))
    const pilotEnabled = manual || safeString(Deno.env.get('WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED')) === '1'
    const sourceHash = safeString(metadata.sender_hash)
    const senderMatches = constantTimeEqual(sourceHash, recipientHash)
    if (sourceRun.intent === 'booking_intent' && !isPersistedConversationScope(metadata, {
      tenantId: connection.barberia_id,
      integrationId: connection.integration_id,
      instance: connection.instance_name,
      senderHash: sourceHash,
    })) return json({ error: 'conversation_scope_required', outbound_allowed: false }, 403)
    const guard = agentOutboundGuard({
      enabled: pilotEnabled,
      runtimeValid,
      tenantAllowlisted,
      tenantId,
      environment: connection.environment,
      connectionState: connection.state,
      integrationProvider: integration?.proveedor,
      integrationType: integration?.integration_type,
      integrationState: integration?.estado,
      instance: connection.instance_name,
      sourceEventPresent: true,
      sourceEventReal,
      sourceTenantId: tenantId,
      sourceIntegrationId: integrationId,
      connectionIntegrationId: Number(connection.integration_id),
      sourceInstance: safeString(metadata.instance),
      sourceFromMe: metadata.from_me === true,
      sourceEnvironment: safeString(metadata.environment),
      senderHashMatches: senderMatches,
      intent: sourceRun.intent,
      proposedReply,
      sourceMetadata: metadata,
      operationAcquired: true,
      replyKind: kind,
      bookingPersisted,
    })
    if (!guard.allowed) return json({ error: guard.reason, outbound_allowed: false }, 403)

    const { data: claim, error: claimError } = await admin.rpc('claim_whatsapp_event', {
      p_integration_id: connection.integration_id,
      p_event_id: operationId,
      p_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    if (claimError) return json({ error: 'outbound_claim_failed', outbound_allowed: false }, 502)
    const claimRow = Array.isArray(claim) ? claim[0] : claim
    if (!claimRow?.acquired) {
      if (manual) {
        try {
          const recovered = await recoverAcceptedManualReply(admin, integrationId, operationId, recipient)
          if (recovered) return json({ sent: true, duplicate: true, send_outcome: 'accepted', panel_message_persisted: true, operation_id: operationId, outbound_allowed: false }, 202)
        } catch {
          return json({ error: 'qa_panel_recovery_failed_no_retry', duplicate: true, operation_id: operationId, outbound_allowed: false }, 502)
        }
      }
      return json({ sent: false, duplicate: true, operation_id: operationId, outbound_allowed: false }, 202)
    }

    const path = buildQaEvolutionSendTextPath(Deno.env.get('EVOLUTION_BASE_URL'), connection.instance_name)
    const apiKey = safeString(Deno.env.get('EVOLUTION_API_KEY'))
    if (!path || !apiKey) return json({ error: 'evolution_send_not_configured', operation_id: operationId, outbound_allowed: false }, 503)

    let response: Response
    try {
      response = await fetch(path, {
        method: 'POST',
        headers: { apikey: apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ number: recipient, text: proposedReply }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      // Sin respuesta: pudo haberse entregado. El reclamo queda en
      // processing (bloquea repeticiones) y no se reintenta.
      return json({ error: 'evolution_send_uncertain_no_retry', send_outcome: 'uncertain', operation_id: operationId, outbound_allowed: true }, 502)
    }
    const providerBody = await response.json().catch(() => null)
    const outcome = classifyEvolutionSendOutcome({ status: response.status })
    if (outcome === 'rejected') {
      // Rechazo explícito del proveedor: el mensaje no salió. Se registra
      // como fallido para que el saludo pueda volver a ofrecerse.
      await finishClaim(admin, connection.integration_id, operationId, `evolution_rejected:${response.status}`, 'failed')
      return json({ error: 'evolution_send_rejected', send_outcome: 'rejected', operation_id: operationId, outbound_allowed: true }, 502)
    }
    if (outcome !== 'sent') return json({ error: 'evolution_send_uncertain_no_retry', send_outcome: 'uncertain', operation_id: operationId, outbound_allowed: true }, 502)

    const providerResult = sanitizeProviderResult(providerBody)
    // Sólo el modo manual nuevo exige el id real del proveedor para mostrar
    // una respuesta aceptada en el panel. No afirma entrega al teléfono.
    if (manual && !providerResult.provider_message_id) return json({ error: 'evolution_acceptance_unverified_no_retry', send_outcome: 'uncertain', operation_id: operationId, outbound_allowed: true }, 502)
    const panelMessage = manual ? {
      integrationId: Number(connection.integration_id), operationId, de: 'bot', phone: recipient,
      text: proposedReply, messageAt: new Date().toISOString(), providerMessageId: providerResult.provider_message_id,
    } : null
    // El recibo queda duradero antes de insertar en la bandeja. Si esa segunda
    // operación falla, un reintento sólo recupera la fila; no vuelve a enviar.
    const completed = await finishClaim(admin, connection.integration_id, operationId, panelMessage ? acceptedManualReceipt(panelMessage) : `agent_outbound_sent:${operationId}`)
    if (!completed) return json({ error: 'outbound_sent_audit_unknown_no_retry', operation_id: operationId, outbound_allowed: true }, 502)
    if (panelMessage) {
      try { await persistManualMessage(admin, panelMessage) }
      catch { return json({ error: 'qa_panel_message_persist_failed_no_retry', sent: true, send_outcome: 'accepted', panel_message_persisted: false, operation_id: operationId, outbound_allowed: true }, 502) }
    }
    return json({ sent: true, duplicate: false, kind, operation_id: operationId, ...providerResult, ...(manual ? { send_outcome: 'accepted', panel_message_persisted: true } : {}), outbound_allowed: true, mutation_allowed: false })
  } catch (error) {
    const code = safeString((error as { message?: string })?.message).replace(/[^a-z0-9_:-]/gi, '').slice(0, 80) || 'agent_outbound_error'
    return json({ error: code, outbound_allowed: false }, 503)
  }
})
