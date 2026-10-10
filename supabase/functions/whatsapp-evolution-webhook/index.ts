import { createClient } from 'npm:@supabase/supabase-js@2.45.0'
import { managedRuntimeProfile, managedTenantFromInstance, manualQaEnabled, manualQaCapabilities, manualQaPhoneAllowed } from '../_shared/qaManualRuntime.mjs'
import { persistManualMessage } from '../_shared/qaManualMessages.mjs'
import { assertShadowAgentConfiguration, classifyShadowIntent, extractInboundText, generateShadowProposal, interpretRequestedDate, normalizeCustomerReply, resolveRequestedServices } from '../_shared/whatsappAgentShadow.mjs'
import { QA_BOOKING_MUTATION_FLAG, QA_BOOKING_MUTATION_TENANTS_ENV, isQaBookingTenantAllowed } from '../_shared/whatsappBookingMutation.mjs'
import { evaluateBotPause } from '../_shared/whatsappBotPause.mjs'
import {
  CHAT_CHOICE_PREFIX,
  PUBLIC_BOOKING_ENVIRONMENT_ENV,
  PUBLIC_BOOKING_ORIGIN_ENV,
  buildChannelOfferReply,
  buildLinkResendReply,
  buildPublicBookingLink,
  buildWebChoiceReply,
  classifyChannelChoice,
  isChannelChoicePending,
  isChannelOfferFresh,
  offerDeliveryState,
  shouldOfferChannels,
} from '../_shared/whatsappChannelOffer.mjs'
import { buildAgentOutboundOperationId } from '../_shared/whatsappAgentOutboundPilot.mjs'
import { advanceConversationTurn, applyWebChannelTurn, buildChannelProposal, buildConversationProposal } from '../_shared/whatsappConversationRuntime.mjs'
import { nextConversationAction, recordAvailabilityResult, isConversationStateFresh, parseExplicitConfirmation } from '../_shared/whatsappConversationState.mjs'
import { conciergeGoal, conciergeNameInput, conciergeChoice, conciergeInformation, conciergeBookingProposal, languageRequest, interpretConcierge, validateLanguageResult, richReply } from '../_shared/whatsappConcierge.mjs'
import { canonicalArgentineMobile } from '../_shared/whatsappCustomer.mjs'
import { canonicalSenderJid, normalizeMessagesUpsertData } from '../_shared/whatsappEvolutionPayload.mjs'
import { EVOLUTION_QR_TTL_MS, qrImageFromEvolutionEvent } from '../_shared/whatsappQrEvent.mjs'
import { inboundTimestampSeconds, isFreshInboundTimestamp } from '../_shared/whatsappInboundFreshness.mjs'
import { isQa927WindowOpen } from '../_shared/whatsappQa927Window.mjs'
import {
  QA_BOOKING_ROUTE_EXPIRES_ENV,
  QA_BOOKING_ROUTE_TENANTS_ENV,
  QA_BOOKING_ROUTE_URL,
  buildQaBookingRouteBody,
  isQaBookingRouteEnabled,
} from '../_shared/whatsappQaBookingRoute.mjs'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const PROTECTED_INSTANCE = 'miwsp'
const WEBHOOK_HEADER = 'X-Austral-Webhook-Secret'
const ALLOWED_EVENTS = new Set(['QRCODE_UPDATED', 'CONNECTION_UPDATE', 'MESSAGES_UPSERT'])
const INBOUND_EVENT = 'MESSAGES_UPSERT'
const QA_927_TENANT_ID = 927
const QA_927_INSTANCE = 'austral-qa-tenant-927'
const QA_927_N8N_URL = 'https://n8n.cuchitron.lat/webhook/austral-qa-927-outbound'

async function forwardQa927Event(connection: Record<string, any>, instance: string, eventId: string) {
  if (Number(connection.barberia_id) !== QA_927_TENANT_ID || instance !== QA_927_INSTANCE) return
  if (Deno.env.get('WHATSAPP_QA_927_AUTOMATION_ENABLED') !== '1' || !isQa927WindowOpen(Deno.env.get('WHATSAPP_QA_927_OUTBOUND_EXPIRES_AT'))) return
  const secret = safeString(Deno.env.get('EVOLUTION_WEBHOOK_SECRET'))
  const anonKey = safeString(Deno.env.get('SUPABASE_ANON_KEY'))
  if (!secret || !anonKey) throw new Error('qa_927_forward_not_configured')
  const response = await fetch(QA_927_N8N_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-austral-qa-route-secret': secret,
      authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ event_id: eventId, tenant_id: QA_927_TENANT_ID, integration_id: connection.integration_id, instance }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error('qa_927_forward_failed')
}

// Ruta QA de la tarea 36: después de persistir el mensaje, avisa al workflow
// n8n QA, que orquesta respuesta, reserva y confirmación. Sólo para tenants
// en la lista explícita y dentro de la ventana; el webhook n8n responde al
// recibir, así que esta llamada no espera el envío. Un fallo devuelve 503 para
// que Evolution reintente; los pasos posteriores son idempotentes.
async function forwardQaBookingRoute(connection: Record<string, any>, instance: string, eventId: string, readyForBookingMutation: boolean) {
  const manual = manualQaEnabled((name: string) => Deno.env.get(name), connection.barberia_id, instance)
  if (manual && !manualQaCapabilities(connection)) return
  if (!manual && !isQaBookingRouteEnabled({
    tenantId: connection.barberia_id,
    instance,
    tenantList: Deno.env.get(QA_BOOKING_ROUTE_TENANTS_ENV),
    expiresAt: Deno.env.get(QA_BOOKING_ROUTE_EXPIRES_ENV),
  })) return
  const secret = safeString(Deno.env.get('EVOLUTION_WEBHOOK_SECRET'))
  if (!secret) throw new Error('qa_booking_route_not_configured')
  const response = await fetch(manual ? runtimeProfile().route : QA_BOOKING_ROUTE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-austral-qa-route-secret': secret, ...(manual ? { 'x-austral-panel-secret': secret, 'user-agent': 'Austral-QA-Integration/1.0' } : {}) },
    body: JSON.stringify(buildQaBookingRouteBody({ eventId, tenantId: connection.barberia_id, integrationId: connection.integration_id, instance, readyForBookingMutation })),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new Error('qa_booking_route_failed')
}

function projectRef() {
  const raw = Deno.env.get('SUPABASE_URL') || ''
  try { return new URL(raw).hostname.split('.')[0].toLowerCase() } catch { return '' }
}

// Perfil del entorno (QA o producción administrada). Producción sólo corre
// con WHATSAPP_MANAGED_RUNTIME_ENABLED=1; QA conserva todos sus gates.
function runtimeProfile() {
  const profile = managedRuntimeProfile((name: string) => Deno.env.get(name))
  if (!profile) throw new Error('runtime_not_enabled')
  return profile
}

function assertRuntime() {
  const ref = projectRef()
  if (ref === QA_PROJECT_REF) {
    if (Deno.env.get('WHATSAPP_PROVISIONING_ENV') !== 'qa' || Deno.env.get('WHATSAPP_MODE') !== 'shadow' || Deno.env.get('PILOT_MODE') !== 'shadow') throw new Error('shadow_mode_required')
    if (Deno.env.get('WHATSAPP_PROVISIONING_ADAPTER') !== 'evolution') throw new Error('evolution_adapter_required')
    assertShadowAgentConfiguration({ WHATSAPP_MODE: Deno.env.get('WHATSAPP_MODE'), PILOT_MODE: Deno.env.get('PILOT_MODE') })
  } else if (ref !== PRODUCTION_PROJECT_REF) throw new Error('project_target_mismatch')
  return runtimeProfile()
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('supabase_not_configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function safeString(value: unknown) { return String(value || '').trim() }

function constantTimeEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left)
  const b = new TextEncoder().encode(right)
  if (a.length === 0 || a.length !== b.length) return false
  let mismatch = 0
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index]
  return mismatch === 0
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' } })
}

function eventName(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  return safeString(payload.event || payload.type || data.event)
    .toUpperCase()
    .replace(/[.\s-]+/g, '_')
}

function instanceName(payload: Record<string, unknown>, profile: ReturnType<typeof runtimeProfile>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  const instance = safeString(payload.instance || payload.instanceName || data.instance || data.instanceName)
  if (!instance || instance.toLowerCase() === PROTECTED_INSTANCE || !managedTenantFromInstance(profile, instance)) return null
  return instance
}

function connectionState(payload: Record<string, unknown>) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  const raw = safeString(data.state || payload.state).toLowerCase()
  if (raw === 'open' || raw === 'connected') return 'CONNECTED'
  if (raw === 'connecting') return 'CONNECTING'
  if (raw === 'close' || raw === 'closed') return 'DISCONNECTED'
  return null
}

function messageData(payload: Record<string, unknown>, { allowEnvelopeIdentity = true } = {}) {
  const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : {}
  const key = data.key && typeof data.key === 'object' ? data.key as Record<string, unknown> : {}
  const message = data.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : {}
  const eventId = safeString(key.id || data.messageId || (allowEnvelopeIdentity ? payload.message_id || payload.event_id || payload.id : '')).slice(0, 200)
  // Un contacto LID sólo se usa con la alternativa de teléfono verificada que
  // entrega el proveedor (remoteJidAlt); sin ella se conserva el LID.
  const remoteJid = canonicalSenderJid(key.remoteJid || key.participant || data.remoteJid || (allowEnvelopeIdentity ? payload.sender : ''), key.remoteJidAlt || data.remoteJidAlt)
  const fromMe = key.fromMe === true || data.fromMe === true || (allowEnvelopeIdentity && payload.fromMe === true)
  const rawMessageType = safeString(data.messageType || payload.messageType || Object.keys(message)[0]).slice(0, 80).toLowerCase()
  const messageType = rawMessageType === 'conversation' || rawMessageType === 'extendedtextmessage' ? 'text' : rawMessageType || null
  const normalizedJid = remoteJid.toLowerCase()
  return {
    eventId,
    remoteJid,
    fromMe,
    messageType,
    isGroup: normalizedJid.endsWith('@g.us'),
    isBroadcast: normalizedJid.endsWith('@broadcast'),
    text: extractInboundText(payload),
    timestamp: data.messageTimestamp || data.timestamp || payload.timestamp || null,
    message,
    instance: safeString(payload.instance || payload.instanceName),
    event: eventName(payload),
  }
}

async function senderHash(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  const bytes = new Uint8Array(digest)
  return `sha256:${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 12)}`
}

async function loadTenantContext(admin: ReturnType<typeof adminClient>, tenantId: number) {
  const [business, services, barbers, schedules, blocks] = await Promise.all([
    admin.from('barberias').select('id,nombre,slug,moneda,zona_horaria,reservas_publicas').eq('id', tenantId).maybeSingle(),
    admin.from('servicios').select('id,nombre,descripcion,precio,duracion_min,activo').eq('barberia_id', tenantId).eq('activo', true).order('nombre'),
    admin.from('barberos').select('id,nombre,especialidad,horario_texto,activo').eq('barberia_id', tenantId).eq('activo', true).order('nombre'),
    admin.from('horarios_barbero').select('barbero_id,day_of_week,start_time,end_time,activo').eq('barberia_id', tenantId).eq('activo', true),
    admin.from('bloqueos_agenda').select('fecha,barbero_id,start_time,end_time,tipo').eq('barberia_id', tenantId),
  ])
  const errors = [business, services, barbers, schedules, blocks].filter((result) => result.error)
  if (errors.length) throw new Error('tenant_context_unavailable')
  return {
    business: business.data || {},
    services: services.data || [],
    barbers: barbers.data || [],
    schedules: schedules.data || [],
    blocks: blocks.data || [],
  }
}

function timeMinutes(value: unknown) {
  const match = safeString(value).match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function matchesTimePeriod(value: unknown, period: string | null) {
  if (!period) return true
  const minutes = timeMinutes(value)
  if (minutes === null) return false
  if (period === 'morning') return minutes < 12 * 60
  if (period === 'afternoon') return minutes >= 12 * 60 && minutes < 19 * 60
  if (period === 'evening') return minutes >= 19 * 60
  return true
}

async function loadAvailability(admin: ReturnType<typeof adminClient>, context: Awaited<ReturnType<typeof loadTenantContext>>, text: string, intent: string) {
  const request = interpretRequestedDate(text, safeString(context.business.zona_horaria) || 'America/Argentina/Buenos_Aires')
  if (!request.date_key) return { status: 'date_required', request, slots: [] }
  const serviceResolution = resolveRequestedServices(text, context.services)
  if (serviceResolution.status === 'ambiguous') return { status: 'service_ambiguous', request, slots: [], rpc_executed: false, service_resolution: serviceResolution }
  if (intent === 'booking_intent' && serviceResolution.status !== 'matched') return { status: 'service_required', request, slots: [], rpc_executed: false, service_resolution: serviceResolution }
  if (!context.business.slug) return { status: 'error', request, slots: [] }
  const services = serviceResolution.status === 'matched' ? serviceResolution.matches : context.services
  const results = await Promise.all(services.map(async (service) => {
    const { data, error } = await admin.rpc('horarios_disponibles_reserva_publica', {
      p_slug: context.business.slug,
      p_servicio_id: service.id,
      p_fecha: request.date_key,
    })
    if (error) throw new Error('availability_rpc_failed')
    return (data || [])
      .filter((slot: Record<string, unknown>) => matchesTimePeriod(slot.hora, request.time_period))
      .map((slot: Record<string, unknown>) => ({
        service_id: service.id,
        service_name: service.nombre,
        barbero_id: slot.barbero_id,
        barbero_nombre: slot.barbero_nombre,
        duracion_min: slot.duracion_min,
        hora: slot.hora,
      }))
  }))
  const slots = results.flat()
  const requestedSlotAvailable = request.requested_time
    ? slots.some((slot: Record<string, unknown>) => safeString(slot.hora).slice(0, 5) === request.requested_time)
    : null
  return { status: 'ready', request, slots, requested_slot_available: requestedSlotAvailable, rpc_executed: true, service_resolution: serviceResolution }
}

async function loadRelativeAvailability(admin: ReturnType<typeof adminClient>, context: Awaited<ReturnType<typeof loadTenantContext>>, state: Record<string, unknown>, text: string) {
  const dateKey = safeString(state.requested_date)
  if (!dateKey) return { status: 'date_required', request: { date_key: null }, slots: [], rpc_executed: false }
  const serviceId = Number(state.service_id)
  const services = Number.isSafeInteger(serviceId) && serviceId > 0
    ? context.services.filter((service: Record<string, unknown>) => Number(service.id) === serviceId)
    : context.services
  if (!context.business.slug || !services.length) return { status: 'service_required', request: { date_key: dateKey }, slots: [], rpc_executed: false }
  const requestedDaypart = safeString(state.daypart) || null
  const results = await Promise.all(services.map(async (service: Record<string, unknown>) => {
    const { data, error } = await admin.rpc('horarios_disponibles_reserva_publica', {
      p_slug: context.business.slug,
      p_servicio_id: service.id,
      p_fecha: dateKey,
    })
    if (error) throw new Error('availability_rpc_failed')
    return (data || [])
      .filter((slot: Record<string, unknown>) => matchesTimePeriod(slot.hora, requestedDaypart))
      .map((slot: Record<string, unknown>) => ({
        service_id: service.id,
        service_name: service.nombre,
        barbero_id: slot.barbero_id,
        barbero_nombre: slot.barbero_nombre,
        duracion_min: slot.duracion_min,
        hora: slot.hora,
      }))
  }))
  const allSlots = results.flat()
  const normalized = safeString(text).toLocaleLowerCase('es-AR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const reference = timeMinutes(state.availability_reference_time || state.requested_time || state.availability_slots?.[0])
  const slots = normalized.includes('mas tarde') && reference !== null
    ? allSlots.filter((slot: Record<string, unknown>) => (timeMinutes(slot.hora) ?? -1) > reference)
    : normalized.includes('mas temprano') && reference !== null
      ? allSlots.filter((slot: Record<string, unknown>) => (timeMinutes(slot.hora) ?? Number.MAX_SAFE_INTEGER) < reference)
      : allSlots
  return {
    status: 'ready',
    request: { date_key: dateKey, requested_date: dateKey, requested_time: null, requested_daypart: requestedDaypart, time_period: requestedDaypart, time_ambiguous: false, timezone: safeString(context.business.zona_horaria) || 'America/Argentina/Buenos_Aires' },
    slots,
    requested_slot_available: null,
    rpc_executed: true,
    service_resolution: Number.isSafeInteger(serviceId) && serviceId > 0 ? { status: 'matched', match_type: 'conversation_state', matches: services } : { status: 'none', matches: [], match_type: null },
  }
}

async function loadConversationAvailability(admin: ReturnType<typeof adminClient>, context: Awaited<ReturnType<typeof loadTenantContext>>, state: Record<string, unknown>, allowTimeMissing = false) {
  const timezone = safeString(context.business.zona_horaria) || 'America/Argentina/Buenos_Aires'
  const request = {
    date_key: safeString(state.requested_date) || null,
    date_phrase: null,
    time_period: safeString(state.daypart) || null,
    requested_date: safeString(state.requested_date) || null,
    requested_time: safeString(state.requested_time) || null,
    requested_daypart: safeString(state.daypart) || null,
    time_ambiguous: false,
    time_candidate: null,
    timezone,
  }
  const service = context.services.find((candidate: Record<string, unknown>) => Number(candidate.id) === Number(state.service_id))
  if (!service) return { status: 'service_required', request, slots: [], rpc_executed: false }
  if (!request.date_key || (!request.requested_time && !allowTimeMissing)) return { status: 'date_or_time_required', request, slots: [], rpc_executed: false }
  if (!context.business.slug) return { status: 'error', request, slots: [], rpc_executed: false }
  const { data, error } = await admin.rpc('horarios_disponibles_reserva_publica', {
    p_slug: context.business.slug,
    p_servicio_id: service.id,
    p_fecha: request.date_key,
  })
  if (error) throw new Error('availability_rpc_failed')
  const slots = (data || [])
    .filter((slot: Record<string, unknown>) => matchesTimePeriod(slot.hora, request.time_period))
    .filter((slot: Record<string, unknown>) => state.barber_id == null || Number(slot.barbero_id) === Number(state.barber_id))
    .map((slot: Record<string, unknown>) => ({
      service_id: service.id,
      service_name: service.nombre,
      barbero_id: slot.barbero_id,
      barbero_nombre: slot.barbero_nombre,
      duracion_min: slot.duracion_min,
      hora: slot.hora,
    }))
  return {
    status: 'ready',
    request,
    slots,
    requested_slot_available: slots.some((slot: Record<string, unknown>) => safeString(slot.hora).slice(0, 5) === request.requested_time),
    rpc_executed: true,
    service_resolution: { status: 'matched', match_type: 'conversation_state', matches: [service] },
  }
}

async function loadConversationState(admin: ReturnType<typeof adminClient>, connection: Record<string, unknown>, instance: string, senderHashValue: string) {
  const { data, error } = await admin.from('saas_automation_shadow_runs')
    .select('metadata,observed_at')
    .eq('tenant_id', connection.barberia_id)
    .eq('integration_id', connection.integration_id)
    .order('observed_at', { ascending: false })
    .limit(100)
  if (error) throw new Error('conversation_lookup_failed')
  const row = (data || []).find((candidate: Record<string, unknown>) => {
    const metadata = candidate.metadata && typeof candidate.metadata === 'object' ? candidate.metadata as Record<string, unknown> : {}
    const state = metadata.conversation_state && typeof metadata.conversation_state === 'object' ? metadata.conversation_state as Record<string, unknown> : null
    const environment = runtimeProfile().environment
    return metadata.environment === environment
      && metadata.instance === instance
      && metadata.sender_hash === senderHashValue
      && state?.environment === environment
      && state?.instance === instance
      && state?.sender_hash === senderHashValue
  })
  if (!row) return null
  const metadata = row.metadata as Record<string, unknown>
  return metadata.conversation_state && typeof metadata.conversation_state === 'object' ? metadata.conversation_state as Record<string, unknown> : null
}

// Pausa por atención humana del negocio resuelto en el servidor. Un error de
// lectura corta el procesamiento del mensaje: sin respuesta automática.
async function loadBotPause(admin: ReturnType<typeof adminClient>, tenantId: number) {
  const { data, error } = await admin.from('config').select('barberia_id,clave,valor').eq('barberia_id', tenantId).eq('clave', 'bot_activo')
  if (error) throw new Error('manual_pause_lookup_failed')
  return evaluateBotPause(data || [], tenantId)
}

// El nombre se pide sólo si el teléfono verificado por el proveedor no tiene
// ficha con nombre en este negocio. No se revela nada de la ficha existente.
async function isCustomerNameRequired(admin: ReturnType<typeof adminClient>, tenantId: number, remoteJid: string, manual = false) {
  const phone = canonicalArgentineMobile(remoteJid)
  if (!phone) return true
  const { data, error } = await admin.from('clientes').select(manual ? 'nombre,whatsapp_nombre_pendiente' : 'nombre').eq('barberia_id', tenantId).eq('telefono', phone).maybeSingle()
  if (error) throw new Error('customer_lookup_failed')
  return !safeString(data?.nombre) || (manual && data?.whatsapp_nombre_pendiente === true)
}

async function loadConciergeCustomer(admin: ReturnType<typeof adminClient>, tenantId: number, remoteJid: string) {
  const phone = canonicalArgentineMobile(remoteJid)
  if (!phone) return null
  const { data, error } = await admin.from('clientes').select('id,nombre,whatsapp_nombre_pendiente').eq('barberia_id', tenantId).eq('telefono', phone).maybeSingle()
  if (error) throw new Error('customer_lookup_failed')
  return data
}

// Entrega del saludo anterior según su reclamo de envío. Si la consulta falla
// se asume resultado incierto: nunca se arriesga a duplicar el saludo.
async function loadPreviousOfferDelivery(admin: ReturnType<typeof adminClient>, integrationId: number, state: Record<string, any> | null, now: Date) {
  const offerEventId = safeString(state?.channel_offer_event_id)
  if (!offerEventId || !isChannelOfferFresh(state, now)) return null
  const operationId = buildAgentOutboundOperationId(offerEventId)
  if (!operationId) return 'uncertain'
  const { data, error } = await admin.from('saas_automation_events').select('status').eq('integration_id', integrationId).eq('event_id', operationId).maybeSingle()
  if (error) return 'uncertain'
  return offerDeliveryState({ offerEventId, claim: data, offeredAt: state?.channel_offer_at, now })
}

// Enlace público del negocio: slug del tenant resuelto + origen explícito del
// entorno. Si falta algo o el texto no pasa el filtro de respuestas, no hay
// enlace (no se inventa uno).
function resolveBookingLink(business: Record<string, unknown>, chatBookingEnabled: boolean, manual = false) {
  const link = buildPublicBookingLink({
    origin: manual ? runtimeProfile().publicOrigin : Deno.env.get(PUBLIC_BOOKING_ORIGIN_ENV),
    declaredEnvironment: manual ? runtimeProfile().environment : Deno.env.get(PUBLIC_BOOKING_ENVIRONMENT_ENV),
    runtimeEnvironment: runtimeProfile().environment,
    slug: business.slug,
    publicBookingEnabled: business.reservas_publicas === true,
  })
  if (!link.available) return { ...link, offerReply: null }
  const offerReply = buildChannelOfferReply({ businessName: safeString(business.nombre), url: link.url, chatBookingEnabled })
  if (normalizeCustomerReply(offerReply) !== offerReply) return { available: false, reason: 'link_reply_rejected', url: null, offerReply: null }
  return { ...link, offerReply }
}

type InboundProcessingResult = { body: Record<string, unknown>; status: number }

/**
 * Process one normalized Evolution message. This is intentionally sequential
 * at the caller so a batch preserves Evolution's ordering for multi-turn
 * conversations while retaining per-message idempotency.
 */
async function processInboundMessage({
  admin,
  connection,
  instance,
  payload,
  isBatch,
}: {
  admin: ReturnType<typeof adminClient>
  connection: Record<string, any>
  instance: string
  payload: Record<string, unknown>
  isBatch: boolean
}): Promise<InboundProcessingResult> {
  const processingStartedAt = new Date()
  if (connection.state !== 'CONNECTED') return { body: { error: 'connection_not_connected', mutation_blocked: true }, status: 409 }
  if (!connection.integration_id) return { body: { error: 'integration_not_configured', mutation_blocked: true }, status: 409 }
  const inbound = messageData(payload, { allowEnvelopeIdentity: !isBatch })
  if (!inbound.eventId || !inbound.remoteJid) return { body: { error: 'message_identity_required', mutation_blocked: true }, status: 422 }
  if (inbound.fromMe) return { body: { received: true, accepted: false, event: INBOUND_EVENT, reason: 'from_me_ignored', mutation_blocked: true }, status: 202 }
  if (!isFreshInboundTimestamp(inbound.timestamp)) return { body: { received: true, accepted: false, event: INBOUND_EVENT, reason: 'stale_or_invalid_timestamp', mutation_blocked: true, outbound_send: false }, status: 202 }
  const manual = manualQaEnabled((name: string) => Deno.env.get(name), connection.barberia_id, instance)
  const concierge = manual && Deno.env.get('WHATSAPP_QA_MANUAL_CONCIERGE_ENABLED') === '1'
  const phone = manual ? canonicalArgentineMobile(inbound.remoteJid) : null
  if (manual && (!phone || !manualQaPhoneAllowed((name: string) => Deno.env.get(name), phone))) {
    return { body: { received: true, accepted: false, reason: 'qa_recipient_not_allowed', mutation_blocked: true, outbound_send: false }, status: 202 }
  }
  // El mensaje real se conserva también cuando una persona pausó el bot.
  // Sólo texto directo válido; nunca crea un envío externo al persistir.
  const panelMessage = manual && inbound.messageType === 'text' && !inbound.isGroup && !inbound.isBroadcast && inbound.text.trim() && inbound.text.length <= 4096
    ? { integrationId: Number(connection.integration_id), operationId: `inbound:${inbound.eventId}`, de: 'paciente', phone, text: inbound.text, messageAt: new Date(Number(inboundTimestampSeconds(inbound.timestamp)) * 1000).toISOString(), providerMessageId: inbound.eventId }
    : null
  // Guardar el mensaje, buscar el evento repetido y leer la pausa no dependen
  // entre sí: se hacen juntos. La pausa sólo se evalúa para un evento nuevo,
  // así que su error se conserva y se relanza recién en ese punto.
  const [, { data: existing, error: existingError }, pauseLookup] = await Promise.all([
    panelMessage ? persistManualMessage(admin, panelMessage) : null,
    admin.from('saas_automation_shadow_runs').select('id,metadata').eq('integration_id', connection.integration_id).eq('event_id', inbound.eventId).maybeSingle(),
    loadBotPause(admin, Number(connection.barberia_id)).then((value) => ({ value }), (error) => ({ error })),
  ])
  if (existingError) return { body: { error: 'shadow_lookup_failed', mutation_blocked: true }, status: 502 }
  if (existing) {
    if (panelMessage) await persistManualMessage(admin, { ...panelMessage, customerName: (existing.metadata as Record<string, any> | null)?.conversation_state?.customer_name })
    try { await forwardQa927Event(connection, instance, inbound.eventId) } catch { return { body: { error: 'qa_927_forward_failed', mutation_blocked: true, outbound_send: false }, status: 503 } }
    // Reintento de Evolution: se vuelve a avisar a n8n; envío, reserva y
    // confirmación son idempotentes por evento/turno.
    const existingState = (existing.metadata as Record<string, any> | null)?.conversation_state
    const existingConfirmed = existingState?.ready_for_booking_mutation === true && existingState?.confirmation_state === 'confirmed' && existingState?.last_event_id === inbound.eventId
    try { await forwardQaBookingRoute(connection, instance, inbound.eventId, existingConfirmed) } catch { return { body: { error: 'qa_booking_route_failed', mutation_blocked: true, outbound_send: false }, status: 503 } }
    return { body: { received: true, accepted: true, event: INBOUND_EVENT, tenant_id: connection.barberia_id, duplicate: true, mutation_blocked: true, outbound_send: false }, status: 202 }
  }
  const tenantId = Number(connection.barberia_id)
  if ('error' in pauseLookup) throw pauseLookup.error
  const pause = pauseLookup.value
  if (!pause.botActive) return { body: { received: true, accepted: false, event: INBOUND_EVENT, tenant_id: connection.barberia_id, reason: 'bot_paused', mutation_blocked: true, outbound_send: false }, status: 202 }
  // QA manual usa la misma identidad canónica que Clientes y la reserva web,
  // también si el proveedor entrega el celular argentino sin el 9.
  const senderHashValue = await senderHash(manual && phone ? `${phone}@s.whatsapp.net` : inbound.remoteJid)
  const [context, previousConversation, customerContext] = await Promise.all([
    loadTenantContext(admin, connection.barberia_id),
    loadConversationState(admin, connection, instance, senderHashValue),
    concierge ? loadConciergeCustomer(admin, tenantId, inbound.remoteJid) : isCustomerNameRequired(admin, tenantId, inbound.remoteJid, manual),
  ])
  let customer = concierge && customerContext && typeof customerContext === 'object' ? customerContext : null
  const customerNameRequired = concierge ? !customer?.nombre || customer.whatsapp_nombre_pendiente === true : customerContext === true
  const timezone = safeString(context.business.zona_horaria) || 'America/Argentina/Buenos_Aires'
  const now = new Date()
  const today = interpretRequestedDate('hoy', timezone, now).requested_date
  const environment = runtimeProfile().environment
  const scope = { tenantId: connection.barberia_id, integrationId: connection.integration_id, instance, senderHash: senderHashValue, environment }
  // Reservar por chat sólo se ofrece donde el circuito QA puede agendar.
  const chatBookingEnabled = (isQaBookingTenantAllowed(tenantId, Deno.env.get(QA_BOOKING_MUTATION_TENANTS_ENV)) && safeString(Deno.env.get(QA_BOOKING_MUTATION_FLAG)) === '1')
    || (manualQaEnabled((name: string) => Deno.env.get(name), tenantId, instance) && manualQaCapabilities(connection, { booking: true }))
  const bookingLink = resolveBookingLink(context.business, chatBookingEnabled, manualQaEnabled((name: string) => Deno.env.get(name), tenantId, instance))
  const channelChoice = classifyChannelChoice(inbound.text)
  const previousOfferDelivery = await loadPreviousOfferDelivery(admin, Number(connection.integration_id), previousConversation, now)
  const choicePending = isChannelChoicePending(previousConversation, now, previousOfferDelivery)
  // Sin enlace disponible, pedirlo no corta una reserva por chat en curso.
  const linkUnavailableRequest = channelChoice === 'link_request' && bookingLink.available !== true
  const webTurn = (channelChoice === 'link_request' && !linkUnavailableRequest) || (choicePending && channelChoice === 'web')
  const chatChosen = choicePending && channelChoice === 'chat'

  let helperGoal: string | null = null
  let informationTurn = false
  let languageProvider: string | null = null
  let interpretedFields: Record<string, any> = {}
  let effectiveText = inbound.text
  let upcoming: Record<string, any>[] = []
  let identityName: string | null = null
  if (concierge && !webTurn) {
    helperGoal = conciergeGoal(inbound.text, previousConversation)
    if (chatChosen) helperGoal = 'booking'
    const choice = conciergeChoice(inbound.text, previousConversation)
    const name = conciergeNameInput(inbound.text, previousConversation, customer)
    const activeBooking = previousConversation?.pending_intent === 'booking_intent' && previousConversation.confirmation_state !== 'confirmed' && isConversationStateFresh(previousConversation, now)
    const knownService = resolveRequestedServices(inbound.text, context.services)
    if (choice?.type === 'service' && context.services.some((s: any) => Number(s.id) === Number(choice.id))) interpretedFields = { service_id: choice.id, requested_time: previousConversation?.requested_time || null, pending_intent: 'booking_intent' }
    if (choice?.type === 'barber' && context.barbers.some((b: any) => Number(b.id) === Number(choice.id))) interpretedFields = { barber_id: choice.id, barber_selection_pending: false, requested_time: previousConversation?.requested_time || null, pending_intent: 'booking_intent' }
    if (choice?.type === 'time') interpretedFields = { requested_time: choice.time, pending_intent: 'booking_intent' }
    if (choice) helperGoal = 'booking'
    if (name && (knownService.status === 'none' || /^(soy |me llamo |mi nombre es |a nombre de )/i.test(inbound.text.trim())) && previousConversation?.awaiting_customer_name && activeBooking) {
      interpretedFields = { customer_name: name, customer_name_confirmed: true, pending_intent: 'booking_intent', service_id: previousConversation.service_id || null, barber_id: previousConversation.barber_id || null }
      helperGoal = 'booking'
    }
    if (name && previousConversation?.awaiting_customer_name && !activeBooking && previousConversation.last_information_topic === 'identity') {
      identityName = name; helperGoal = 'identity'
      customer = { ...customer, nombre: name, whatsapp_nombre_pendiente: false }
    }
    if (previousConversation?.barber_selection_pending && /^(decime vos|elegi vos|me da igual)[.!?]*$/i.test(inbound.text.trim())) { effectiveText = 'Cualquiera'; helperGoal = 'booking' }
    if (helperGoal === 'unclear' && knownService.status === 'matched') helperGoal = 'booking'
    if (helperGoal === 'unclear' && !parseExplicitConfirmation(inbound.text) && !previousConversation?.awaiting_customer_name) {
      const request = languageRequest({ message: inbound.text, business: context.business, services: context.services, barbers: context.barbers, state: previousConversation, customer, today })
      const raw = await interpretConcierge({ request: { ...request, tenant_id: tenantId, instance }, route: runtimeProfile().languageRoute, secret: safeString(Deno.env.get('EVOLUTION_WEBHOOK_SECRET')) })
      const understood = validateLanguageResult(raw, { services: context.services, barbers: context.barbers, today })
      if (understood) { helperGoal = understood.goal; interpretedFields = understood.fields; languageProvider = understood.provider }
    }
    informationTurn = ['identity', 'my_booking', 'greeting', 'thanks', 'services', 'prices', 'duration', 'recommend', 'human'].includes(helperGoal || '') || (helperGoal === 'unclear' && !activeBooking)
    if (informationTurn) {
      // Una consulta de precio/nombre no cambia el servicio de una reserva ni
      // convierte el texto de la pregunta en el nombre del cliente.
      interpretedFields = { pending_intent: activeBooking ? 'booking_intent' : null, service_id: activeBooking ? previousConversation.service_id : null, requested_date: activeBooking ? previousConversation.requested_date : null, requested_time: activeBooking ? previousConversation.requested_time : null, barber_id: activeBooking ? previousConversation.barber_id : null }
    }
    if (helperGoal === 'booking' && !informationTurn) interpretedFields.pending_intent = 'booking_intent'
    if (identityName) { interpretedFields.customer_name = identityName; interpretedFields.customer_name_confirmed = true }
    if (['my_booking', 'greeting', 'thanks'].includes(helperGoal || '') && customer?.id) {
      const result = await admin.from('turnos').select('id,fecha,hora,motivo,paciente').eq('barberia_id', tenantId).eq('cliente_id', customer.id).gte('fecha', today).eq('estado', 'confirmado').order('fecha').order('hora').limit(3)
      if (!result.error) upcoming = result.data || []
    }
  }

  let availability = null
  let conversationState: Record<string, any>
  let conversationAction: string | null = null
  let bookingFlow = false
  let proposal: Record<string, any>
  if (webTurn) {
    // Pedir o elegir el enlace no agenda nada y corta una reserva por chat en curso.
    const linkRequested = channelChoice === 'link_request'
    const web = applyWebChannelTurn({ state: previousConversation, scope, eventId: inbound.eventId, text: inbound.text, messageType: inbound.messageType || 'text', fromMe: inbound.fromMe, isGroup: inbound.isGroup, isBroadcast: inbound.isBroadcast, timezone, linkResent: linkRequested, now })
    if (!web.accepted) return { body: { received: true, accepted: false, event: INBOUND_EVENT, reason: web.reason, duplicate: web.duplicate === true, mutation_blocked: true, outbound_send: false }, status: web.duplicate ? 202 : 422 }
    conversationState = web.state
    const reply = linkRequested ? buildLinkResendReply({ url: bookingLink.url, linkAvailable: true }) : buildWebChoiceReply()
    conversationAction = linkRequested ? 'channel_link_resent' : 'channel_web_chosen'
    proposal = buildChannelProposal({ reply, requestedAction: conversationAction, state: conversationState })
  } else {
    const conversation = advanceConversationTurn({
      state: previousConversation,
      scope,
      eventId: inbound.eventId,
      text: effectiveText,
      messageType: inbound.messageType || 'text',
      fromMe: inbound.fromMe,
      isGroup: inbound.isGroup,
      isBroadcast: inbound.isBroadcast,
      services: context.services,
      barbers: context.barbers,
      timezone,
      customerNameRequired,
      forceBookingIntent: chatChosen && chatBookingEnabled,
      personalizedBooking: concierge,
      interpretedFields,
      suppressNameCapture: informationTurn,
      now,
    })
    if (!conversation.accepted) return { body: { received: true, accepted: false, event: INBOUND_EVENT, reason: conversation.reason, duplicate: conversation.duplicate === true, mutation_blocked: true, outbound_send: false }, status: conversation.duplicate ? 202 : 422 }
    conversationState = chatChosen ? { ...conversation.state, channel_choice: 'chat' } : conversation.state
    const offer = chatChosen || (concierge && ['identity', 'my_booking', 'thanks', 'prices', 'duration', 'human'].includes(helperGoal || ''))
      ? { offer: false }
      : shouldOfferChannels({ state: previousConversation, intent: conversation.intent, extractedFields: conversation.extracted?.fields, linkAvailable: bookingLink.available === true, previousOfferDelivery, now })
    if (linkUnavailableRequest) {
      conversationAction = 'channel_link_unavailable'
      proposal = buildChannelProposal({ reply: buildLinkResendReply({ linkAvailable: false, chatBookingEnabled }), intent: conversation.intent === 'booking_intent' ? 'booking_intent' : 'general_query', requestedAction: conversationAction, state: conversationState })
    } else if (offer.offer) {
      // Se guarda el evento que lleva el saludo para conocer después si se entregó.
      conversationState = { ...conversationState, channel_offer_at: now.toISOString(), channel_offer_event_id: inbound.eventId, channel_choice: null }
      conversationAction = 'channel_offer'
      proposal = buildChannelProposal({ reply: bookingLink.offerReply, intent: conversation.intent === 'booking_intent' ? 'booking_intent' : 'general_query', requestedAction: conversationAction, state: conversationState })
      if (concierge) proposal.proposed_reply = richReply(`¡Hola${customer?.nombre && !customer.whatsapp_nombre_pendiente ? `, ${customer.nombre.split(' ')[0]}` : ''}! 👋\nBienvenido a ${context.business.nombre}.\nPodés reservar en la web: ${bookingLink.url}\nO lo hacemos por acá, paso a paso. ¿Qué preferís?`)
      proposal.context_counts = { ...proposal.context_counts, previous_offer_delivery: previousOfferDelivery }
    } else {
      bookingFlow = !informationTurn && (conversation.intent === 'booking_intent' || conversationState?.pending_intent === 'booking_intent')
      if (concierge && informationTurn) {
        const intent = ({ services: 'services_query', prices: 'price_query', duration: 'duration_query' } as Record<string,string>)[helperGoal || ''] || 'general_query'
        proposal = buildChannelProposal({ reply: conciergeInformation({ goal: helperGoal, message: inbound.text, customer, services: context.services, state: previousConversation, upcoming, business: context.business }), intent, requestedAction: `concierge_${helperGoal}`, state: conversationState })
        proposal.proposed_reply = richReply(conciergeInformation({ goal: helperGoal, message: inbound.text, customer, services: context.services, state: previousConversation, upcoming, business: context.business }))
        proposal.provider = 'qa_deterministic_shadow'
        proposal.tools_considered = ['tenant_context_read','services_read']
        proposal.context_counts = { ...proposal.context_counts, services: context.services.length, language_provider: languageProvider }
        conversationState = { ...conversationState, last_information_topic: helperGoal }
        if (helperGoal === 'identity') conversationState.awaiting_customer_name = !customer?.nombre || customer.whatsapp_nombre_pendiente === true
        if (['services','recommend'].includes(helperGoal || '')) conversationState.concierge_choices = context.services.slice(0, 5).map((s: any) => ({ type: 'service', id: s.id }))
      } else {
      if (bookingFlow && (conversation.action?.action === 'check_availability' || (concierge && conversation.action?.action === 'ask_time'))) {
        try {
          availability = await loadConversationAvailability(admin, context, conversationState, concierge)
          if (concierge && !conversationState.requested_time && availability.rpc_executed && conversationState.time_preference && availability.slots.length) {
            const times = [...new Set(availability.slots.map((s: any) => safeString(s.hora).slice(0, 5)))].sort()
            conversationState = { ...conversationState, requested_time: conversationState.time_preference === 'latest' ? times.at(-1) : times[0] }
            availability.requested_slot_available = true
            conversation.action = { action: 'check_availability' }
          }
          if (availability.rpc_executed === true && conversationState.requested_time) {
            if (concierge && conversationState.barber_id == null) {
              const matches = availability.slots.filter((s: any) => safeString(s.hora).slice(0, 5) === conversationState.requested_time)
              const ids = [...new Set(matches.map((s: any) => Number(s.barbero_id)))]
              if (ids.length === 1) conversationState = { ...conversationState, barber_id: ids[0] }
            }
            const availabilityResult = recordAvailabilityResult({
              state: conversationState,
              expectedScope: scope,
              source: 'authoritative_rpc',
              available: availability.requested_slot_available === true,
              snapshotId: `rpc:${inbound.eventId}`,
              proposalId: `proposal:${conversationState.conversation_id}:${conversationState.version}`,
              slots: availability.slots,
            })
            if (availabilityResult.accepted) conversationState = availabilityResult.state
          }
        } catch {
          availability = { status: 'error', request: { requested_date: conversationState.requested_date, requested_time: conversationState.requested_time, requested_daypart: conversationState.daypart, timezone }, slots: [], rpc_executed: false }
        }
      }
      proposal = bookingFlow
        ? buildConversationProposal({ state: conversationState, action: conversation.action?.action === 'check_availability' && availability?.rpc_executed ? nextConversationAction(conversationState, { expectedScope: scope, availabilityStatus: availability.requested_slot_available ? 'available' : 'unavailable', requestedSlotAvailable: availability.requested_slot_available }) : conversation.action, availability, serviceResolution: conversation.extracted?.serviceResolution, services: context.services, barbers: context.barbers, businessName: context.business.nombre, replyPrefix: chatChosen && chatBookingEnabled ? CHAT_CHOICE_PREFIX : '' })
        : await (async () => {
          const initialIntent = classifyShadowIntent(inbound.text)
          if (initialIntent === 'availability_query') {
            try { availability = await loadAvailability(admin, context, inbound.text, initialIntent) } catch { availability = { status: 'error', request: interpretRequestedDate(inbound.text, timezone), slots: [], rpc_executed: false } }
          } else if (conversationState?.last_intent === 'availability_query' && /\b(mas tarde|mas temprano|otro horario|otro dia)\b/i.test(inbound.text)) {
            try { availability = await loadRelativeAvailability(admin, context, conversationState, inbound.text) } catch { availability = { status: 'error', request: { date_key: conversationState.requested_date }, slots: [], rpc_executed: false } }
          }
          if (availability?.rpc_executed === true) {
            conversationState = {
              ...conversationState,
              availability_slots: availability.slots.map((slot: Record<string, unknown>) => safeString(slot.hora).slice(0, 5)).filter(Boolean).slice(0, 8),
              availability_reference_time: safeString(availability.slots?.[0]?.hora).slice(0, 5) || conversationState?.availability_reference_time || null,
            }
          }
          return generateShadowProposal({
            text: inbound.text,
            context: { ...context, availability, conversation: conversationState },
            apiKey: safeString(Deno.env.get('DEEPSEEK_API_KEY')),
            model: safeString(Deno.env.get('DEEPSEEK_MODEL')) || 'deepseek-chat',
          })
        })()
      if (concierge && bookingFlow) {
        const action = conversation.action?.action === 'check_availability' && availability?.rpc_executed
          ? nextConversationAction(conversationState, { expectedScope: scope, availabilityStatus: availability.requested_slot_available ? 'available' : 'unavailable', requestedSlotAvailable: availability.requested_slot_available })
          : conversation.action
        const enhanced = conciergeBookingProposal({ proposal, state: conversationState, action, services: context.services, barbers: context.barbers, availability, customer, business: context.business })
        proposal = enhanced.proposal; conversationState = enhanced.state
        proposal.context_counts.language_provider = languageProvider
      }
      }
    }
  }
  const { data: recorded, error: recordError } = await admin.rpc('record_whatsapp_shadow_run', {
    p_integration_id: connection.integration_id,
    p_event_id: inbound.eventId,
    p_intent: proposal.intent,
    p_proposed_result: 'agent_proposal_shadow',
    p_proposed_response_length: proposal.proposed_reply.length,
    p_proposed_latency_ms: Math.max(0, Date.now() - processingStartedAt.getTime()),
    p_proposed_tokens_input: null,
    p_proposed_tokens_output: null,
    p_metadata: {
      source: 'evolution',
      event: INBOUND_EVENT,
      environment,
      message_type: inbound.messageType,
      message_timestamp: inbound.timestamp,
      processing_started_at: processingStartedAt.toISOString(),
      sender_hash: senderHashValue,
      ...(manual ? { qa_manual_sender_phone: phone } : {}),
      instance,
      from_me: false,
      agent: {
        provider: proposal.provider,
        model: proposal.model,
        prompt_version: proposal.agent_prompt_version || 'natural-v2',
        confidence: proposal.confidence,
        requested_action: proposal.requested_action,
        tools_considered: proposal.tools_considered,
        context_counts: {
          ...proposal.context_counts,
          availability_request: availability?.request || null,
          availability_status: availability?.status || null,
          requested_slot_available: availability?.requested_slot_available ?? null,
          service_resolution: availability?.service_resolution
            ? {
                status: availability.service_resolution.status,
                match_type: availability.service_resolution.match_type,
                resolved_service_ids: availability.service_resolution.matches.map((service: Record<string, unknown>) => service.id),
                resolved_service_names: availability.service_resolution.matches.map((service: Record<string, unknown>) => safeString(service.nombre).slice(0, 120)),
              }
            : null,
        },
      },
      proposed_reply: proposal.proposed_reply,
      conversation_state: conversationState,
      conversation_action: conversationAction ?? (bookingFlow ? (proposal.requested_action || null) : null),
      conversation_scope: { tenant_id: connection.barberia_id, integration_id: connection.integration_id, instance, sender_hash: senderHashValue, environment },
      mutation_blocked: true,
      outbound_send: false,
      mutation_allowed: false,
      outbound_allowed: false,
      observed_at: new Date().toISOString(),
    },
  })
  if (recordError) return { body: { error: 'shadow_record_failed', mutation_blocked: true }, status: 502 }
  // El nombre sólo se completa desde el estado de la conversación validado.
  // Repetir esta RPC recupera también un fallo posterior al shadow record.
  if (panelMessage) await persistManualMessage(admin, { ...panelMessage, customerName: conversationState.customer_name })
  const shadowRun = Array.isArray(recorded) ? recorded[0] : recorded
  try { await forwardQa927Event(connection, instance, inbound.eventId) } catch { return { body: { error: 'qa_927_forward_failed', mutation_blocked: true, outbound_send: false }, status: 503 } }
  // "Listo para reservar" sólo en el evento que confirmó la propuesta.
  const confirmedNow = bookingFlow && conversationState.ready_for_booking_mutation === true && conversationState.confirmation_state === 'confirmed' && conversationState.last_event_id === inbound.eventId
  try { await forwardQaBookingRoute(connection, instance, inbound.eventId, confirmedNow) } catch { return { body: { error: 'qa_booking_route_failed', mutation_blocked: true, outbound_send: false }, status: 503 } }
  return {
    body: { received: true, accepted: true, event: INBOUND_EVENT, tenant_id: connection.barberia_id, shadow_run_id: shadowRun?.shadow_run_id || null, duplicate: false, intent: proposal.intent, proposed_reply: proposal.proposed_reply, provider: proposal.provider, mutation_blocked: true, outbound_send: false, conversation_state: bookingFlow ? conversationState.confirmation_state : null, ready_for_booking_mutation: bookingFlow ? conversationState.ready_for_booking_mutation === true : false },
    status: 200,
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  try {
    const profile = assertRuntime()
    const expected = safeString(Deno.env.get('EVOLUTION_WEBHOOK_SECRET'))
    const received = safeString(request.headers.get(WEBHOOK_HEADER))
    if (!expected || !constantTimeEqual(received, expected)) return json({ error: 'webhook_unauthorized' }, 401)
    const payload = await request.json().catch(() => null)
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return json({ error: 'invalid_payload' }, 422)
    const event = eventName(payload as Record<string, unknown>)
    const instance = instanceName(payload as Record<string, unknown>, profile)
    if (!instance) return json({ error: 'qa_instance_required' }, 403)
    if (!ALLOWED_EVENTS.has(event)) return json({ received: true, accepted: false, reason: 'event_not_enabled' }, 202)
    const admin = adminClient()
    const { data: connection, error: lookupError } = await admin.from('saas_whatsapp_connections').select('id, barberia_id, integration_id, state, automation_enabled, outbound_enabled, booking_enabled').eq('provider', 'evolution').eq('environment', profile.environment).eq('instance_name', instance).maybeSingle()
    if (lookupError) return json({ error: 'connection_lookup_failed' }, 502)
    if (!connection) return json({ error: 'qa_connection_not_found' }, 404)
    if (event === INBOUND_EVENT) {
      const rawData = (payload as Record<string, unknown>).data
      const messages = normalizeMessagesUpsertData(rawData)
      if (!messages.length) return json({ error: 'message_identity_required', mutation_blocked: true }, 422)
      const isBatch = Array.isArray(rawData)
      const results: InboundProcessingResult[] = []
      for (const message of messages) {
        const itemPayload = { ...(payload as Record<string, unknown>), data: message }
        try {
          results.push(await processInboundMessage({ admin, connection, instance, payload: itemPayload, isBatch }))
        } catch {
          // Keep processing sibling messages while failing this item closed.
          results.push({ body: { error: 'message_processing_failed', mutation_blocked: true, outbound_send: false }, status: 503 })
        }
      }
      if (!isBatch) {
        const result = results[0]
        return json(result.body, result.status)
      }
      const processed = results.some(({ body }) => body.accepted === true || body.duplicate === true)
      const allInvalid = results.every(({ status }) => status === 422)
      const allIgnored = results.every(({ status }) => status === 202)
      const hasServerError = results.some(({ status }) => status >= 500)
      const status = processed ? 200 : hasServerError ? 503 : allInvalid ? 422 : allIgnored ? 202 : 200
      return json({
        received: true,
        accepted: processed,
        event,
        batch: true,
        messages: results.map(({ body }, index) => ({ index, ...body })),
        mutation_blocked: true,
        outbound_send: false,
      }, status)
    }
    const qr = event === 'QRCODE_UPDATED' ? qrImageFromEvolutionEvent(payload) : null
    if (event === 'QRCODE_UPDATED' && !qr) return json({ error: 'invalid_qr_event', mutation_blocked: true }, 422)
    const state = event === 'QRCODE_UPDATED' ? 'QR_READY' : connectionState(payload as Record<string, unknown>)
    if (state) {
      const qrExpiresAt = qr ? new Date(Date.now() + EVOLUTION_QR_TTL_MS).toISOString() : null
      const fields = {
        state,
        last_verified_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
        ...(qr ? { qr_payload: qr, qr_expires_at: qrExpiresAt, pairing_expires_at: qrExpiresAt } : {}),
        ...(state === 'CONNECTED' || state === 'DISCONNECTED' ? { qr_payload: null, qr_expires_at: null, pairing_expires_at: null } : {}),
        // En producción, vincular el WhatsApp desde el panel deja el bot
        // funcionando: responde, reserva y confirma para este negocio.
        ...(state === 'CONNECTED' && profile.environment === 'production' ? { automation_enabled: true, outbound_enabled: true, booking_enabled: true } : {}),
      }
      let update = admin.from('saas_whatsapp_connections').update(fields).eq('id', connection.id).eq('provider', 'evolution').eq('environment', profile.environment)
      if (event === 'QRCODE_UPDATED') update = update.neq('state', 'CONNECTED')
      const { error: updateError } = await update
      if (updateError) return json({ error: 'connection_state_update_failed' }, 502)
    }
    return json({ received: true, accepted: true, event, tenant_id: connection.barberia_id, mutation_blocked: true })
  } catch (error) {
    const code = safeString((error as { message?: string })?.message).replace(/[^a-z0-9_:-]/gi, '').slice(0, 80) || 'webhook_error'
    return json({ error: code }, 503)
  }
})
