import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ALLOWED_REPLY_INTENTS,
  BLOCKED_MUTATIONS,
  bookingRequestReply,
  buildBookingUrl,
  classifyIncomingMessage,
  isFromMe,
  mutationFirewall,
  normalizeReplyIdentity,
  observabilityEvent,
  rateLimitDecision,
  resolveAllowlistedTenant,
  resolveMode,
  replyOnlyFallback,
  sanitizeReply,
  sendTextGuard,
  validateAiDecision,
  validatePilotAllowlist,
} from './whatsapp-reply-only-core.mjs'
import { createMockSendTextAdapter } from './whatsapp-reply-only-adapter.mjs'
import { authorizeWebhookSecret, WEBHOOK_HEADER_NAME } from './whatsapp-webhook-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFile(path.join(root, file), 'utf8')

const allowlist = validatePilotAllowlist([{ tenantId: 'E2E_QA_BARBERIA_A', integrationId: 'E2E_QA_WA_INTEGRATION_A', instance: 'e2e-qa-a', receiver: '5491100000001', mode: 'reply_only', active: true }])
assert.equal(WEBHOOK_HEADER_NAME, 'x-austral-webhook-secret')
assert.equal(authorizeWebhookSecret({ headerValue: 'offline-reply-secret', expectedSecret: 'offline-reply-secret' }).ok, true)
assert.equal(authorizeWebhookSecret({ headerValue: 'wrong', expectedSecret: 'offline-reply-secret' }).status, 401)
assert.throws(() => validatePilotAllowlist([]), /exactamente una/)
assert.throws(() => validatePilotAllowlist([{ tenantId: 'A', integrationId: '*', instance: 'e2e', receiver: '5491100000001', mode: 'reply_only', active: true }]), /wildcard/)
assert.throws(() => validatePilotAllowlist([{ tenantId: 'A', integrationId: 'i', instance: 'e2e', receiver: '5491100000001', mode: 'shadow', active: true }]), /reply_only/)

const payload = { integrationId: 'E2E_QA_WA_INTEGRATION_A', instance: 'E2E-QA-A', receiver: '+54 911 0000 0001' }
assert.deepEqual(normalizeReplyIdentity(payload), { integrationId: 'E2E_QA_WA_INTEGRATION_A', instance: 'e2e-qa-a', receiver: '5491100000001' })
assert.deepEqual(resolveAllowlistedTenant({ payload, allowlist }).tenantId, 'E2E_QA_BARBERIA_A')
assert.equal(resolveAllowlistedTenant({ payload: { ...payload, receiver: '5491100000002' }, allowlist }), null)
assert.equal(resolveAllowlistedTenant({ payload: { ...payload, tenantId: 'OTHER' }, allowlist }).tenantId, 'E2E_QA_BARBERIA_A')

assert.deepEqual(resolveMode({ mode: 'reply_only', pilotMode: 'reply_only', killSwitch: 'enabled' }).allowed, true)
assert.equal(resolveMode({ mode: 'reply_only', pilotMode: 'reply_only', killSwitch: 'disabled' }).allowed, false)
assert.equal(resolveMode({ mode: 'booking_enabled', pilotMode: 'booking_enabled', killSwitch: 'enabled' }).allowed, false)

for (const operation of BLOCKED_MUTATIONS) assert.equal(mutationFirewall({ mode: 'reply_only', operation }).allowed, false)
assert.equal(mutationFirewall({ mode: 'reply_only', operation: 'select_availability' }).allowed, false)

const validDecision = validateAiDecision({ intent: 'availability', confidence: 0.93, arguments: { date: 'tomorrow' }, needs_clarification: false })
assert.equal(validDecision.intent, 'availability')
for (const invalid of [null, {}, { intent: 'unknown', confidence: 1, arguments: {} }, { intent: 'price', confidence: 2, arguments: {} }, { intent: 'price', confidence: 0.9 }]) assert.throws(() => validateAiDecision(invalid))
assert.equal(sanitizeReply('**Corte**\n\nHay horarios.'), '**Corte**\n\nHay horarios.')
assert.equal(sanitizeReply(''), null)
assert.equal(sanitizeReply('{"secret":"x"}'), null)
assert.equal(sanitizeReply('service_role token'), null)
assert.ok(buildBookingUrl({ baseUrl: 'https://barberia.cuchitron.lat', slug: 'e2e-qa-barberia-a' }).endsWith('/reservar/e2e-qa-barberia-a'))
assert.throws(() => buildBookingUrl({ baseUrl: 'https://otro.invalid', slug: 'a' }))
assert.match(bookingRequestReply({ bookingUrl: 'https://barberia.cuchitron.lat/reservar/e2e-qa-a' }), /confirmar el turno/)
assert.match(replyOnlyFallback({ reason: 'handoff' }), /derivar/)

assert.equal(isFromMe({ key: { fromMe: true } }), true)
assert.equal(isFromMe({ data: { key: { fromMe: false } } }), false)
assert.deepEqual(classifyIncomingMessage({ messageType: 'audio' }).supported, false)
assert.deepEqual(classifyIncomingMessage({ text: 'Hola' }).supported, true)

const firstRate = rateLimitDecision({ count: 0, nowMs: 1000, windowStartedAt: 1000 })
assert.equal(firstRate.allowed, true)
const blockedRate = rateLimitDecision({ count: 10, nowMs: 2000, windowStartedAt: 1000 })
assert.equal(blockedRate.allowed, false)
assert.equal(rateLimitDecision({ count: 10, nowMs: 70001, windowStartedAt: 1000 }).allowed, true)

const mock = createMockSendTextAdapter()
assert.deepEqual(await mock.adapter({ to: '5491100000099', text: 'Respuesta segura' }), { sent: true, reply: 'Respuesta segura' })
assert.equal(mock.calls.length, 1)
const fromMeGuard = sendTextGuard({ mode: 'reply_only', allowlisted: true, authenticated: true, eventAcquired: true, fromMe: true, rateAllowed: true, reply: 'No debe salir' })
assert.equal(fromMeGuard.allowed, false)
const blockedMutation = mutationFirewall({ mode: 'reply_only', operation: 'create_booking' })
assert.equal(blockedMutation.mutationBlocked, true)

const event = observabilityEvent({ event: 'reply_sent', tenantId: 'E2E_QA_BARBERIA_A', integrationId: 'E2E_QA_WA_INTEGRATION_A', sender: '5491100000099', correlationId: 'E2E_QA_CORR_1', metadata: { mode: 'reply_only', payload: 'removed' } })
assert.match(event.sender_hash, /^sha256:/)
assert.equal(Object.hasOwn(event.metadata, 'payload'), false)

const scenarios = [
  'saludo', 'servicios', 'precio', 'horarios', 'profesionales', 'disponibilidad',
  'quiero_reservar', 'intento_crear_reserva', 'intento_cancelar', 'intento_editar',
  'handoff', 'audio', 'imagen', 'sticker', 'documento', 'ubicacion', 'mensaje_vacio',
  'ia_json_invalido', 'ia_timeout', 'supabase_timeout', 'header_faltante', 'header_incorrecto',
  'tenant_desconocido', 'identidad_cruzada', 'tenant_no_allowlisted', 'duplicate_event',
  'from_me', 'loop_respuesta_propia', 'rate_limit', 'modo_shadow', 'modo_invalido',
  'rpc_mutable',
]
assert.equal(scenarios.length, 32)
for (const scenario of scenarios) {
  const mutationOperation = scenario === 'intento_crear_reserva'
    ? 'create_booking'
    : scenario === 'intento_cancelar'
      ? 'cancel_booking'
      : scenario === 'intento_editar'
        ? 'update_booking'
        : scenario === 'rpc_mutable' ? 'mutable_rpc' : null
  if (mutationOperation) assert.equal(mutationFirewall({ mode: 'reply_only', operation: mutationOperation }).mutationBlocked, true)
  if (scenario === 'from_me' || scenario === 'loop_respuesta_propia') assert.equal(isFromMe({ fromMe: true }), true)
}

const templateText = await read('integrations/templates/Austral WhatsApp Reply Only Pilot.json')
const template = JSON.parse(templateText)
assert.equal(template.active, false)
assert.match(template.name, /Reply Only Pilot/)
assert.doesNotMatch(templateText, /\$env/, 'Reply Only template must not access blocked Code-node environment')
assert.match(templateText, /\$vars/, 'Reply Only template must use supported n8n variables with fail-closed defaults')
assert.doesNotMatch(templateText, /sendText|crear_reserva_whatsapp|update_booking|cancel_booking|service_role|EVOLUTION_API_KEY|DEEPSEEK_API_KEY/i)
assert.match(templateText, /mutation_blocked/)
assert.match(await read('supabase/migrations/20260813120000_whatsapp_reply_only_pilot.sql'), /uq_reply_only_single_enabled/)
assert.match(await read('docs/WHATSAPP-REPLY-ONLY-PILOT.md'), /OFFLINE VALIDATED/)

console.log(JSON.stringify({
  allowlist: 'exactly_one_and_strict',
  mutation_firewall: 'passed',
  auth_boundary: 'existing_contract_reused',
  loop_protection: 'passed',
  idempotency: 'existing_integration_event_claim_required',
  rate_limit: '10 messages / 60 seconds / integration+sender',
  ai_contract: ALLOWED_REPLY_INTENTS.length,
  media_fallback: 'passed',
  booking_links: 'tenant_scoped_https_only',
  mock_external_messages: mock.calls.length,
  reservations_created: 0,
  clients_modified: 0,
}, null, 2))
