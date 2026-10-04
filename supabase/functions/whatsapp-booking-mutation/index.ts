import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { requireOperator } from '../_shared/supabase.ts'
import { isRealPersistedSourceMetadata } from '../_shared/whatsappAgentOutboundPilot.mjs'
import { evaluateBotPause } from '../_shared/whatsappBotPause.mjs'
import { isConversationStateFresh, isConversationStateForScope } from '../_shared/whatsappConversationState.mjs'
import { canonicalArgentineMobile, resolveBookingCustomer } from '../_shared/whatsappCustomer.mjs'
import {
  QA_BOOKING_MUTATION_ENVIRONMENT,
  QA_BOOKING_MUTATION_FLAG,
  QA_BOOKING_MUTATION_TENANTS_ENV,
  QA_BOOKING_MUTATION_PROMPT_VERSION,
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
async function loadExistingCustomer(admin: ReturnType<typeof adminClient>, tenantId: number, phone: string) {
  const { data, error } = await admin
    .from('clientes')
    .select('nombre,email')
    .eq('barberia_id', tenantId)
    .eq('telefono', phone)
    .maybeSingle()
  if (error) throw new Error('customer_lookup_failed')
  return data || null
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
    const allowedTenants = Deno.env.get(QA_BOOKING_MUTATION_TENANTS_ENV)
    if (!isQaBookingTenantAllowed(tenantId, allowedTenants)) return json({ error: 'qa_tenant_required', mutation_allowed: false }, 403)
    const expectedInstance = qaBookingInstanceForTenant(tenantId)

    const { data: connection, error: connectionError } = await admin
      .from('saas_whatsapp_connections')
      .select('id,barberia_id,integration_id,provider,environment,state,instance_name')
      .eq('barberia_id', tenantId)
      .eq('provider', 'evolution')
      .eq('environment', QA_BOOKING_MUTATION_ENVIRONMENT)
      .eq('instance_name', expectedInstance)
      .maybeSingle()
    if (connectionError) return json({ error: 'connection_lookup_failed', mutation_allowed: false }, 502)
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
    const recipient = canonicalArgentineMobile(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT'))
    const recipientHash = textFrom(Deno.env.get('WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH'))
    const senderMatches = Boolean(recipient && recipientHash && constantTimeEqual(senderHashValue, recipientHash))
    const stateScopeValid = state ? isConversationStateForScope(state, {
      tenantId: connection.barberia_id,
      integrationId: connection.integration_id,
      instance: connection.instance_name,
      senderHash: senderHashValue,
      environment: QA_BOOKING_MUTATION_ENVIRONMENT,
    }) : false
    const stateFresh = state ? isConversationStateFresh(state) : false
    const promptVersionValid = textFrom(agent?.prompt_version) === QA_BOOKING_MUTATION_PROMPT_VERSION
    const stateValid = stateScopeValid && stateFresh && promptVersionValid && state ? isConfirmedBookingState(state, eventId, allowedTenants) : false
    const sourceEventReal = isRealPersistedSourceMetadata(metadata)
    const sourceFresh = eventIsFresh(sourceRun.observed_at)

    if (!state || !stateValid) return json({ error: 'confirmed_booking_state_required', mutation_allowed: false }, 409)
    if (!sourceFresh || !sourceEventReal || !senderMatches) return json({ error: 'source_event_not_eligible', mutation_allowed: false }, 403)

    const { data: business, error: businessError } = await admin
      .from('barberias')
      .select('id,nombre,slug,zona_horaria')
      .eq('id', tenantId)
      .maybeSingle()
    const { data: service, error: serviceError } = await admin
      .from('servicios')
      .select('id,nombre,activo')
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
    if (!selected.allowed) return json({ error: selected.reason, mutation_allowed: false, revalidated: true }, 409)
    if (!recipient) return json({ error: 'qa_recipient_not_configured', mutation_allowed: false }, 503)

    const pilotEnabled = textFrom(Deno.env.get(QA_BOOKING_MUTATION_FLAG)) === '1'
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
    const customer = resolveBookingCustomer({ existing: await loadExistingCustomer(admin, tenantId, recipient), conversationName: state.customer_name })
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
      const code = safeErrorCode(bookingError)
      return json({ error: code === '23P01' ? 'slot_unavailable_after_recheck' : 'booking_creation_failed', mutation_allowed: true, revalidated: true, booking_mutation_executed: false }, code === '23P01' ? 409 : 502)
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
