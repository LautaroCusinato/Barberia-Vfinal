import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { manualQaEnabled, manualQaCapabilities, manualQaRecipient } from '../_shared/qaManualRuntime.mjs'
import { requireOperator } from '../_shared/supabase.ts'
import { isRealPersistedSourceMetadata } from '../_shared/whatsappAgentOutboundPilot.mjs'
import { evaluateBotPause } from '../_shared/whatsappBotPause.mjs'
import { isConversationStateFresh, isConversationStateForScope, recordAvailabilityResult } from '../_shared/whatsappConversationState.mjs'
import { canonicalArgentineMobile, resolveBookingCustomer } from '../_shared/whatsappCustomer.mjs'
import { buildConversationProposal } from '../_shared/whatsappConversationRuntime.mjs'
import { conciergeBookingProposal } from '../_shared/whatsappConcierge.mjs'
import {
  QA_BOOKING_MUTATION_ENVIRONMENT,
  QA_BOOKING_MUTATION_FLAG,
  QA_BOOKING_MUTATION_TENANTS_ENV,
  QA_BOOKING_MUTATION_PROMPT_VERSION,
  alternativeSlotTimes,
  classifyBookingSlotRejection,
  isQaBookingTenantAllowed,
  qaBookingInstanceForTenant,
  bookingMutationGuard,
  buildBookingClaimEventId,
  buildBookingConfirmedReply,
  constantTimeEqual,
  isConfirmedBookingState,
  isQaBookingMutationRuntime,
  selectAuthoritativeSlot,
} from '../_shared/whatsappBookingMutation.mjs'

const MAX_EVENT_AGE_MS = 30 * 60 * 1000
const PROTECTED_INSTANCE = 'miwsp'

function textFrom(value: unknown) { return String(value ?? '').trim() }

function projectRef() {
  try { return new URL(textFrom(Deno.env.get('SUPABASE_URL'))).hostname.split('.')[0].toLowerCase() } catch { return '' }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } })
}

function adminClient() {
  const url = textFrom(Deno.env.get('SUPABASE_URL'))
  const key = textFrom(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))
  if (!url || !key) throw new Error('supabase_not_configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Un bloqueo de la agenda cubre el horario pedido (del negocio, del
// profesional elegido o, sin profesional elegido, de cualquiera).
async function slotIsBlocked(admin: ReturnType<typeof adminClient>, tenantId: number, state: Record<string, unknown>) {
  const { data, error } = await admin
    .from('bloqueos_agenda')
    .select('barbero_id,start_time,end_time')
    .eq('barberia_id', tenantId)
    .eq('fecha', textFrom(state.requested_date))
  if (error || !Array.isArray(data)) return false
  const time = textFrom(state.requested_time).slice(0, 5)
  const barber = textFrom(state.barber_id)
  return data.some((row: Record<string, unknown>) => {
    const start = textFrom(row.start_time).slice(0, 5)
    const end = textFrom(row.end_time).slice(0, 5)
    const scoped = row.barbero_id === null || row.barbero_id === undefined || !barber || textFrom(row.barbero_id) === barber
    return scoped && start <= time && time < end
  })
}

function eventIsFresh(observedAt: unknown) {
  const timestamp = new Date(textFrom(observedAt)).getTime()
  const age = Date.now() - timestamp
  return Number.isFinite(timestamp) && age >= 0 && age <= MAX_EVENT_AGE_MS
}

function safeErrorCode(error: unknown) {
  return textFrom((error as { code?: string })?.code).replace(/[^a-z0-9_:-]/gi, '').slice(0, 40) || 'booking_mutation_failed'
}

// Cliente del negocio con el mismo teléfono canónico (misma regla que la
// reserva web y que la restricción única barberia_id + telefono).
async function loadExistingCustomer(admin: ReturnType<typeof adminClient>, tenantId: number, phone: string, manual = false) {
  const { data, error } = await admin
    .from('clientes')
    .select(manual ? 'nombre,email,whatsapp_nombre_pendiente' : 'nombre,email')
    .eq('barberia_id', tenantId)
    .eq('telefono', phone)
    .maybeSingle()
  if (error) throw new Error('customer_lookup_failed')
  // El rótulo visible del contacto nuevo no es un nombre confirmado.
  return data ? { ...data, ...(manual && data.whatsapp_nombre_pendiente === true ? { nombre: '' } : {}) } : null
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed', mutation_allowed: false }, 405)
  try {
    if (!textFrom(request.headers.get('authorization')).toLowerCase().startsWith('bearer ')) return json({ error: 'authorization_required', mutation_allowed: false }, 401)
    try { await requireOperator(request, adminClient()) } catch (error) { return json({ error: String((error as { code?: string })?.code || 'authorization_required'), mutation_allowed: false }, Number((error as { status?: number })?.status) || 401) }

    const runtimeValid = isQaBookingMutationRuntime({
      projectRef: projectRef(),
      provisioningEnv: Deno.env.get('WHATSAPP_PROVISIONING_ENV'),
      whatsappMode: Deno.env.get('WHATSAPP_MODE'),
      pilotMode: Deno.env.get('PILOT_MODE'),
    })
    if (!runtimeValid) return json({ error: 'qa_shadow_runtime_required', mutation_allowed: false }, 403)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Record<string, unknown>).some((key) => key !== 'event_id')) {
      return json({ error: 'event_id_only', mutation_allowed: false }, 422)
    }
    const eventId = textFrom((body as Record<string, unknown>).event_id)
    if (!eventId || eventId.length > 200) return json({ error: 'event_id_required', mutation_allowed: false }, 422)

    const admin = adminClient()
    // El tenant sale de la corrida persistida por el webhook (nunca del
    // cuerpo) y debe estar en la lista explícita de tenants QA con reserva.
    const { data: sourceRows, error: sourceError } = await admin
      .from('saas_automation_shadow_runs')
      .select('id,tenant_id,integration_id,event_id,intent,metadata,observed_at')
      .eq('event_id', eventId)
      .limit(2)
    if (sourceError) return json({ error: 'source_lookup_failed', mutation_allowed: false }, 502)
    if (!sourceRows?.length) return json({ error: 'real_persisted_source_required', mutation_allowed: false }, 404)
    if (sourceRows.length > 1) return json({ error: 'source_event_ambiguous', mutation_allowed: false }, 409)
    const sourceRun = sourceRows[0]
    const tenantId = Number(sourceRun.tenant_id)
    const manual = manualQaEnabled((name: string) => Deno.env.get(name), tenantId, qaBookingInstanceForTenant(tenantId))
    const previousAllowed = Deno.env.get(QA_BOOKING_MUTATION_TENANTS_ENV)
    const allowedTenants = manual ? `${previousAllowed || '1'},${tenantId}` : previousAllowed
    if (!isQaBookingTenantAllowed(tenantId, allowedTenants)) return json({ error: 'qa_tenant_required', mutation_allowed: false }, 403)
    const expectedInstance = qaBookingInstanceForTenant(tenantId)

    const { data: connection, error: connectionError } = await admin
      .from('saas_whatsapp_connections')
      .select('id,barberia_id,integration_id,provider,environment,state,instance_name,automation_enabled,outbound_enabled,booking_enabled')
      .eq('barberia_id', tenantId)
      .eq('provider', 'evolution')
      .eq('environment', QA_BOOKING_MUTATION_ENVIRONMENT)
      .eq('instance_name', expectedInstance)
      .maybeSingle()
    if (connectionError) return json({ error: 'connection_lookup_failed', mutation_allowed: false }, 502)
    if (manual && !manualQaCapabilities(connection, { booking: true })) return json({ error: 'qa_manual_flags_not_ready', mutation_allowed: false }, 409)
    if (!connection || connection.state !== 'CONNECTED' || connection.instance_name === PROTECTED_INSTANCE) return json({ error: 'qa_connection_not_connected', mutation_allowed: false }, 409)
    if (Number(connection.integration_id) !== Number(sourceRun.integration_id)) return json({ error: 'source_integration_mismatch', mutation_allowed: false }, 403)

    // Con la pausa por atención humana activa no se agenda automáticamente.
    const { data: pauseRows, error: pauseError } = await admin
      .from('config')
      .select('barberia_id,clave,valor')
      .eq('barberia_id', tenantId)
      .eq('clave', 'bot_activo')
    if (pauseError) return json({ error: 'manual_pause_lookup_failed', mutation_allowed: false }, 502)
    let pause
    try { pause = evaluateBotPause(pauseRows || [], tenantId) } catch { return json({ error: 'manual_pause_lookup_failed', mutation_allowed: false }, 502) }
    if (!pause.botActive) return json({ error: 'bot_paused', mutation_allowed: false, booking_mutation_executed: false }, 409)

    const { data: integration, error: integrationError } = await admin
      .from('saas_integraciones')
      .select('id,barberia_id,proveedor,integration_type,estado')
      .eq('id', connection.integration_id)
      .eq('barberia_id', tenantId)
      .maybeSingle()
    if (integrationError) return json({ error: 'integration_lookup_failed', mutation_allowed: false }, 502)
    if (!integration || integration.proveedor !== 'evolution' || integration.integration_type !== 'whatsapp' || integration.estado !== 'conectado') {
      return json({ error: 'qa_integration_not_connected', mutation_allowed: false }, 409)
    }

    const metadata = sourceRun.metadata && typeof sourceRun.metadata === 'object' ? sourceRun.metadata as Record<string, unknown> : {}
    const state = metadata.conversation_state && typeof metadata.conversation_state === 'object' ? metadata.conversation_state as Record<string, unknown> : null
    const agent = metadata.agent && typeof metadata.agent === 'object' ? metadata.agent as Record<string, unknown> : null
    const senderHashValue = textFrom(metadata.sender_hash)
    const manualRecipient = manual ? await manualQaRecipient((name: string) => Deno.env.get(name), senderHashValue, metadata.qa_manual_sender_phone) : null
    const recipient = manual ? manualRecipient?.recipient : canonicalArgentineMobile(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT'))
    const recipientHash = manual ? manualRecipient?.recipientHash || '' : textFrom(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH'))
    const senderMatches = Boolean(recipient && recipientHash && constantTimeEqual(senderHashValue, recipientHash))
    const conversationScope = {
      tenantId: connection.barberia_id,
      integrationId: connection.integration_id,
      instance: connection.instance_name,
      senderHash: senderHashValue,
      environment: QA_BOOKING_MUTATION_ENVIRONMENT,
    }
    const stateScopeValid = state ? isConversationStateForScope(state, conversationScope) : false
    const stateFresh = state ? isConversationStateFresh(state) : false
    const promptVersionValid = textFrom(agent?.prompt_version) === QA_BOOKING_MUTATION_PROMPT_VERSION
    const stateValid = stateScopeValid && stateFresh && promptVersionValid && state ? isConfirmedBookingState(state, eventId, allowedTenants) : false
    const sourceEventReal = isRealPersistedSourceMetadata(metadata)
    const sourceFresh = eventIsFresh(sourceRun.observed_at)

    // Un reintento del mismo Sí recupera la pregunta persistida, sin pedir
    // otra reserva ni sustituir el estado por una confirmación vieja.
    const followUp = metadata.booking_follow_up as Record<string, unknown> | undefined
    if (state && stateScopeValid && stateFresh && promptVersionValid && sourceFresh && sourceEventReal && senderMatches
      && sourceRun.intent === 'booking_intent' && (manual || textFrom(Deno.env.get(QA_BOOKING_MUTATION_FLAG)) === '1')
      && ((followUp?.reason === 'barber_selection_required' && state.barber_selection_pending === true && state.confirmation_state === 'collecting') || (followUp?.reason === 'quote_changed' && state.confirmation_state === 'awaiting_confirmation' && state.ready_for_booking_mutation === false))
      && state.last_event_id === eventId) {
      const { data: claim, error } = await admin.from('saas_automation_events').select('status').eq('integration_id', connection.integration_id).eq('event_id', followUp.claim_key).maybeSingle()
      if (error || claim) return json({ error: 'booking_follow_up_claim_conflict', mutation_allowed: false }, 409)
      return json({ error: followUp.reason, booking_created: false, booking_follow_up: true, conversation_reopened: true, booking_mutation_executed: false }, 409)
    }
    if (!state || !stateValid) return json({ error: 'confirmed_booking_state_required', mutation_allowed: false }, 409)
    if (!sourceFresh || !sourceEventReal || !senderMatches) return json({ error: 'source_event_not_eligible', mutation_allowed: false }, 403)

    const { data: business, error: businessError } = await admin
      .from('barberias')
      .select('id,nombre,slug,zona_horaria,moneda')
      .eq('id', tenantId)
      .maybeSingle()
    const { data: service, error: serviceError } = await admin
      .from('servicios')
      .select('id,nombre,activo,precio,duracion_min')
      .eq('id', Number(state.service_id))
      .eq('barberia_id', tenantId)
      .eq('activo', true)
      .maybeSingle()
    if (businessError || serviceError || !business?.slug || !service) return json({ error: 'authoritative_service_required', mutation_allowed: false }, 409)
    if (textFrom(state.timezone) !== textFrom(business.zona_horaria)) return json({ error: 'timezone_mismatch', mutation_allowed: false }, 409)

    const { data: slots, error: availabilityError } = await admin.rpc('horarios_disponibles_reserva_publica', {
      p_slug: business.slug,
      p_servicio_id: service.id,
      p_fecha: textFrom(state.requested_date),
    })
    if (availabilityError) return json({ error: 'availability_recheck_failed', mutation_allowed: false }, 502)
    const selected = selectAuthoritativeSlot(slots || [], state)
    const recheck = { source: 'authoritative_rpc', requested_slot_available: selected.allowed === true, slot: selected.slot }

    const claimEventId = buildBookingClaimEventId(state)
    if (!claimEventId) return json({ error: 'booking_claim_key_invalid', mutation_allowed: false }, 409)
    const { data: existingClaim, error: existingClaimError } = await admin
      .from('saas_automation_events')
      .select('status,result_reference')
      .eq('integration_id', connection.integration_id)
      .eq('event_id', claimEventId)
      .maybeSingle()
    if (existingClaimError) return json({ error: 'booking_claim_lookup_failed', mutation_allowed: false }, 502)
    if (existingClaim?.status === 'completed' && /^\d+$/.test(textFrom(existingClaim.result_reference))) {
      return json({
        booking_created: true,
        idempotent: true,
        booking_claim_status: 'completed',
        turno_id: Number(existingClaim.result_reference),
        revalidated: true,
        mutation_allowed: true,
      })
    }
    const pilotEnabled = manual || textFrom(Deno.env.get(QA_BOOKING_MUTATION_FLAG)) === '1'
    // Tarea 41: horario rechazado (bloqueado u ocupado). No se crea nada: la
    // conversación vuelve a "elegir horario" con la disponibilidad vigente y
    // el aviso al cliente (kind booking_slot_rejected) se arma en el servidor.
    const rejectSlot = async (reason: string, freshSlots: unknown[] | null) => {
      const alternatives = freshSlots === null ? null : alternativeSlotTimes(freshSlots as Record<string, unknown>[], state)
      const reopened = recordAvailabilityResult({
        state,
        expectedScope: conversationScope,
        available: false,
        snapshotId: `booking-rejected:${claimEventId}`,
        slots: (alternatives || []).map((hora) => ({ hora })),
      })
      const base = { error: reason === 'slot_unavailable' ? 'slot_unavailable_after_recheck' : reason, rejection_reason: reason, slot_rejected: true, booking_created: false, mutation_allowed: false, revalidated: true, booking_mutation_executed: false }
      if (!reopened.accepted) return json({ ...base, conversation_reopened: false }, 409)
      const { error: reopenError } = await admin
        .from('saas_automation_shadow_runs')
        .update({ metadata: { ...metadata, conversation_state: reopened.state, booking_rejection: { reason, alternatives, claim_key: claimEventId, rejected_at: new Date().toISOString() } } })
        .eq('id', sourceRun.id)
        .eq('event_id', eventId)
      if (reopenError) return json({ ...base, conversation_reopened: false, error: 'conversation_reopen_failed' }, 502)
      return json({ ...base, conversation_reopened: true, alternatives_count: alternatives?.length ?? null }, 409)
    }
    if (!selected.allowed) {
      if (selected.reason === 'barber_selection_required' && pilotEnabled && sourceRun.intent === 'booking_intent') {
        if (existingClaim) return json({ error: 'booking_follow_up_claim_conflict', mutation_allowed: false }, 409)
        const reopened = recordAvailabilityResult({ state, expectedScope: conversationScope, available: true, snapshotId: `barber-choice:${eventId}`, slots: slots || [] })
        if (!reopened.accepted || !reopened.state.barber_selection_pending) return json({ error: 'barber_selection_reopen_failed', mutation_allowed: false }, 502)
        const proposal = buildConversationProposal({ state: reopened.state, action: { action: 'ask_barber' }, barbers: (slots || []).map((slot: Record<string, unknown>) => ({ id: Number(slot.barbero_id), nombre: slot.barbero_nombre })) })
        const { data: changed, error } = await admin.from('saas_automation_shadow_runs')
          .update({ metadata: { ...metadata, proposed_reply: proposal.proposed_reply, conversation_state: reopened.state, conversation_action: proposal.requested_action, agent: { ...agent, requested_action: proposal.requested_action }, booking_follow_up: { reason: 'barber_selection_required', claim_key: claimEventId } } })
          .eq('id', sourceRun.id).eq('event_id', eventId).eq('metadata->conversation_state->>confirmation_state', 'confirmed').select('id').maybeSingle()
        if (error || !changed) return json({ error: 'barber_selection_reopen_failed', mutation_allowed: false }, 502)
        return json({ error: 'barber_selection_required', booking_created: false, booking_follow_up: true, conversation_reopened: true, booking_mutation_executed: false }, 409)
      }
      if (selected.reason === 'slot_unavailable_after_recheck' && pilotEnabled) {
        return rejectSlot(await slotIsBlocked(admin, tenantId, state) ? 'slot_blocked' : 'slot_unavailable', slots || [])
      }
      return json({ error: selected.reason, mutation_allowed: false, revalidated: true }, 409)
    }
    if (!recipient) return json({ error: 'qa_recipient_not_configured', mutation_allowed: false }, 503)

    const guard = bookingMutationGuard({
      enabled: pilotEnabled,
      runtimeValid,
      tenantId: Number(connection.barberia_id),
      environment: connection.environment,
      instance: connection.instance_name,
      connectionState: connection.state,
      sourceEventPresent: true,
      sourceEventFresh: sourceFresh,
      sourceEventReal,
      sourceTenantId: Number(sourceRun.tenant_id),
      sourceIntegrationId: Number(sourceRun.integration_id),
      sourceFromMe: metadata.from_me,
      sourceEnvironment: metadata.environment,
      senderHashMatches: senderMatches,
      sourceIntent: sourceRun.intent,
      stateValid,
      availabilityRechecked: true,
      requestedSlotAvailable: recheck.requested_slot_available,
      operationClaimAvailable: { available: true, integrationId: connection.integration_id },
      allowedTenants,
    })
    if (!guard.allowed) return json({ error: guard.reason, mutation_allowed: false, revalidated: true, booking_mutation_executed: false }, 403)

    // Cliente existente: conserva su ficha. Cliente nuevo: el nombre confirmado
    // en la conversación; sin ese nombre no se agenda (no hay nombre de relleno).
    const personalizedBooking = manual && Deno.env.get('WHATSAPP_QA_MANUAL_CONCIERGE_ENABLED') === '1'
    if (personalizedBooking && state.customer_name_confirmed !== true) return json({ error: 'customer_name_confirmation_required', mutation_allowed: false }, 409)
    if (personalizedBooking) {
      const quote = state.concierge_quote as Record<string, unknown> | undefined
      if (!quote || Number(quote.service_id) !== Number(service.id) || Number(quote.price) !== Number(service.precio) || quote.currency !== (business.moneda || 'ARS') || Number(quote.duration) !== Number(selected.slot.duracion_min)) {
        if (existingClaim) return json({ error: 'booking_follow_up_claim_conflict', mutation_allowed: false }, 409)
        const reopened = recordAvailabilityResult({ state, expectedScope: conversationScope, available: true, snapshotId: `quote:${eventId}`, slots: slots || [] })
        if (!reopened.accepted) return json({ error: 'quote_reopen_failed', mutation_allowed: false }, 502)
        reopened.state.ready_for_booking_mutation = false
        const { data: barber } = await admin.from('barberos').select('id,nombre').eq('barberia_id', tenantId).eq('id', selected.slot.barbero_id).maybeSingle()
        const proposal = buildConversationProposal({ state: reopened.state, action: { action: 'request_confirmation' }, services: [service] })
        const enhanced = conciergeBookingProposal({ proposal, state: reopened.state, action: { action: 'request_confirmation' }, services: [service], barbers: barber ? [barber] : [], availability: { slots }, customer: null, business })
        const { data: changed, error } = await admin.from('saas_automation_shadow_runs').update({ metadata: { ...metadata, proposed_reply: 'El precio o la duración cambiaron. Revisá el resumen actualizado:\n' + enhanced.proposal.proposed_reply, conversation_state: enhanced.state, conversation_action: enhanced.proposal.requested_action, agent: { ...agent, requested_action: enhanced.proposal.requested_action }, booking_follow_up: { reason: 'quote_changed', claim_key: claimEventId } } }).eq('id', sourceRun.id).eq('metadata->conversation_state->>confirmation_state', 'confirmed').select('id').maybeSingle()
        if (error || !changed) return json({ error: 'quote_reopen_failed', mutation_allowed: false }, 502)
        return json({ error: 'quote_changed', booking_created: false, booking_follow_up: true, conversation_reopened: true, booking_mutation_executed: false }, 409)
      }
    }
    const customer = resolveBookingCustomer({ existing: await loadExistingCustomer(admin, tenantId, recipient, manual), conversationName: state.customer_name, preferConversationName: personalizedBooking })
    if (customer.status === 'name_required') return json({ error: 'customer_name_required', mutation_allowed: false, revalidated: true, booking_mutation_executed: false }, 409)
    const { data: booking, error: bookingError } = await admin.rpc('crear_reserva_whatsapp', {
      p_integration_id: connection.integration_id,
      p_event_id: claimEventId,
      p_servicio_id: service.id,
      p_barbero_id: Number(selected.slot.barbero_id),
      p_fecha: textFrom(state.requested_date),
      p_hora: textFrom(state.requested_time),
      p_nombre: customer.nombre,
      p_telefono: recipient,
      p_email: customer.email,
    })
    if (bookingError) {
      // La transacción se revirtió: no hay turno. Si fue por el horario
      // (bloqueado entre la revalidación y el INSERT, u ocupado), se ofrece
      // otro con la disponibilidad posterior al rechazo.
      const rejection = classifyBookingSlotRejection(bookingError)
      if (rejection) {
        const { data: freshSlots, error: freshError } = await admin.rpc('horarios_disponibles_reserva_publica', {
          p_slug: business.slug,
          p_servicio_id: service.id,
          p_fecha: textFrom(state.requested_date),
        })
        return rejectSlot(rejection, freshError || !Array.isArray(freshSlots) ? null : freshSlots)
      }
      return json({ error: 'booking_creation_failed', mutation_allowed: true, revalidated: true, booking_mutation_executed: false }, 502)
    }
    const row = Array.isArray(booking) ? booking[0] : booking
    if (!row?.turno_id) return json({ error: 'booking_result_missing', mutation_allowed: true, revalidated: true, booking_mutation_executed: false }, 502)
    return json({
      booking_created: true,
      idempotent: false,
      booking_claim_status: 'completed',
      turno_id: row.turno_id,
      fecha: row.fecha,
      hora: row.hora,
      duracion_min: row.duracion_min,
      customer_status: customer.status,
      // Texto para avisar por WhatsApp; existe sólo después de guardar el turno.
      confirmation_reply: buildBookingConfirmedReply({ businessName: business.nombre, serviceName: service.nombre, fecha: row.fecha, hora: row.hora }),
      revalidated: true,
      mutation_allowed: true,
      booking_mutation_executed: true,
    })
  } catch (error) {
    return json({ error: safeErrorCode(error), mutation_allowed: false, booking_mutation_executed: false }, 503)
  }
})
