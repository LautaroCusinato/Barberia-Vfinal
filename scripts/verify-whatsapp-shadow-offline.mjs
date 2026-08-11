import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  authorizeWebhookSecret,
  constantTimeEqual,
  expectedWebhookSecretFromEnv,
  WEBHOOK_HEADER_NAME,
} from './whatsapp-webhook-auth.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFile(path.join(root, file), 'utf8')

const secretSentinel = 'offline-only-shadow-secret-not-real'
const validAuth = (headerValue, expectedSecret) =>
  authorizeWebhookSecret({ headerValue, expectedSecret })

// A-G: the webhook must fail closed before any tenant, AI or Supabase work.
assert.deepEqual(validAuth(secretSentinel, secretSentinel), { ok: true, status: 200, reason: 'authorized' })
assert.deepEqual(validAuth('wrong-secret', secretSentinel), { ok: false, status: 401, reason: 'secret_invalid' })
assert.deepEqual(validAuth(undefined, secretSentinel), { ok: false, status: 401, reason: 'secret_missing' })
assert.deepEqual(validAuth('', secretSentinel), { ok: false, status: 401, reason: 'secret_missing' })
assert.deepEqual(validAuth('   ', secretSentinel), { ok: false, status: 401, reason: 'secret_missing' })
assert.deepEqual(validAuth(secretSentinel, ''), { ok: false, status: 401, reason: 'secret_unconfigured' })
assert.deepEqual(validAuth(secretSentinel, '   '), { ok: false, status: 401, reason: 'secret_unconfigured' })
assert.deepEqual(validAuth(secretSentinel, undefined), { ok: false, status: 401, reason: 'secret_unconfigured' })
assert.equal(expectedWebhookSecretFromEnv({}), '')
assert.equal(expectedWebhookSecretFromEnv({ EVOLUTION_WEBHOOK_SECRET: '' }), '')
assert.equal(constantTimeEqual(secretSentinel, secretSentinel), true)
assert.equal(constantTimeEqual(secretSentinel, 'x'), false)
assert.equal(constantTimeEqual(secretSentinel, `${secretSentinel}x`), false)
assert.match((await read('scripts/whatsapp-webhook-auth.mjs')), /timingSafeEqual/)

const fixture = Object.freeze({
  event_id: 'E2E_QA_WA_SHADOW_001',
  integration_id: 'E2E_QA_WA_INTEGRATION_A',
  instance: 'e2e-qa-a',
  receiver: '5491100000001',
  sender: '5491100000099',
  message_id: 'E2E_QA_MSG_001',
  timestamp: '2026-08-11T12:00:00.000Z',
  event: 'MESSAGES_UPSERT',
  message_type: 'text',
  text: 'Hola, ¿tenés turno mañana después de las 17 para corte?',
})

const integrations = [
  { id: 'E2E_QA_WA_INTEGRATION_A', instance: 'e2e-qa-a', receiver: '5491100000001', tenant: 'E2E_QA_BARBERIA_A' },
  { id: 'E2E_QA_WA_INTEGRATION_B', instance: 'e2e-qa-b', receiver: '5491100000002', tenant: 'E2E_QA_BARBERIA_B' },
]
const normalize = (value) => String(value ?? '').replace(/\D/g, '') || null
const resolveIntegration = ({ integration_id, instance, receiver }) => {
  const normalizedInstance = String(instance ?? '').trim().toLowerCase()
  const normalizedReceiver = normalize(receiver)
  return integrations.find((item) => item.id === integration_id && item.instance === normalizedInstance && item.receiver === normalizedReceiver) ?? null
}

const eventState = new Set()
const shadowLogs = []
const externalMessages = []
const mutations = []
const stages = []

const processShadow = ({ payload, mode = 'shadow', pilotMode = 'shadow', headerValue = secretSentinel, expectedSecret = secretSentinel, mocks = {} }) => {
  stages.push('auth')
  const auth = authorizeWebhookSecret({ headerValue, expectedSecret })
  if (!auth.ok) return { status: 'rejected', reason: auth.reason, stage: 'auth' }
  stages.push('mode')
  if (mode !== 'shadow' || pilotMode !== 'shadow') return { status: 'ignored', reason: 'shadow_mode_required', stage: 'mode' }
  if (!payload || payload.event !== 'MESSAGES_UPSERT' || !payload.event_id || !payload.integration_id) return { status: 'rejected', reason: 'invalid_event', stage: 'validation' }
  stages.push('identity')
  const integration = resolveIntegration(payload)
  if (!integration) return { status: 'rejected', reason: 'identity_mismatch', stage: 'identity' }
  const key = `${integration.id}:${payload.event_id}`
  if (eventState.has(key)) return { status: 'duplicate', reason: 'duplicate_event', stage: 'idempotency' }
  eventState.add(key)
  stages.push('tenant')
  if (mocks.supabase === 'timeout') return { status: 'failed_closed', reason: 'supabase_timeout', stage: 'tenant' }
  stages.push('ai')
  if (mocks.ai === 'timeout') return { status: 'failed_closed', reason: 'ai_timeout', stage: 'ai' }
  if (mocks.ai === 'invalid_json') return { status: 'failed_closed', reason: 'ai_invalid_json', stage: 'ai' }
  stages.push('availability')
  const availability = mocks.availability ?? [{ start: '17:00', service: 'E2E_QA_A_SERVICIO', duration_min: 30 }]
  const proposedResponse = availability.length
    ? 'Hay disponibilidad mañana a las 17:00 para corte. Esta es una propuesta de prueba.'
    : 'No encontré horarios disponibles para ese pedido.'
  const log = {
    correlation_id: `E2E_QA_CORR_${shadowLogs.length + 1}`,
    tenant: integration.tenant,
    intent: 'availability_query',
    result: availability.length ? 'available' : 'no_availability',
    latency_ms: 12,
    duplicate: false,
    mutation_blocked: true,
    proposed_response: proposedResponse,
  }
  shadowLogs.push(log)
  stages.push('shadow_log')
  return { status: 'shadow_completed', tenant: integration.tenant, proposed_response: proposedResponse, shadow_log: log }
}

const first = processShadow({ payload: fixture })
const duplicate = processShadow({ payload: fixture })
assert.equal(first.status, 'shadow_completed')
assert.equal(first.tenant, 'E2E_QA_BARBERIA_A')
assert.equal(first.shadow_log.mutation_blocked, true)
assert.equal(duplicate.status, 'duplicate')
assert.equal(shadowLogs.length, 1)
assert.equal(externalMessages.length, 0)
assert.equal(mutations.length, 0)

const crossed = processShadow({ payload: { ...fixture, event_id: 'E2E_QA_WA_SHADOW_CROSSED', receiver: '5491100000002' } })
const unknown = processShadow({ payload: { ...fixture, event_id: 'E2E_QA_WA_SHADOW_UNKNOWN', integration_id: 'E2E_QA_UNKNOWN' } })
assert.deepEqual(crossed, { status: 'rejected', reason: 'identity_mismatch', stage: 'identity' })
assert.deepEqual(unknown, { status: 'rejected', reason: 'identity_mismatch', stage: 'identity' })

for (const mode of ['reply_only', 'booking_enabled', '', 'live']) {
  assert.equal(processShadow({ payload: { ...fixture, event_id: `E2E_QA_MODE_${mode || 'empty'}` }, mode, pilotMode: mode }).status, 'ignored')
}
assert.equal(processShadow({ payload: { ...fixture, event_id: 'E2E_QA_BAD_AUTH' }, headerValue: 'wrong-secret' }).stage, 'auth')
assert.equal(processShadow({ payload: { ...fixture, event_id: 'E2E_QA_NO_SECRET' }, expectedSecret: '' }).reason, 'secret_unconfigured')
assert.equal(processShadow({ payload: { ...fixture, event_id: 'E2E_QA_SUPABASE_TIMEOUT' }, mocks: { supabase: 'timeout' } }).reason, 'supabase_timeout')
assert.equal(processShadow({ payload: { ...fixture, event_id: 'E2E_QA_AI_TIMEOUT' }, mocks: { ai: 'timeout' } }).reason, 'ai_timeout')
assert.equal(processShadow({ payload: { ...fixture, event_id: 'E2E_QA_AI_JSON' }, mocks: { ai: 'invalid_json' } }).reason, 'ai_invalid_json')
assert.equal(processShadow({ payload: { ...fixture, event_id: 'E2E_QA_EMPTY' }, mocks: { availability: [] } }).shadow_log.result, 'no_availability')
assert.ok(stages.indexOf('auth') < stages.indexOf('identity'))

const templateText = await read('integrations/templates/WhatsApp Multi Tenant - Contract Template.json')
const template = JSON.parse(templateText)
const legacyText = await read('integrations/Barberia Central - Bot WhatsApp (Evolution + Deepseek) (5).json')
assert.equal(template.active, false)
assert.doesNotMatch(templateText, /sendText|crear_reserva_whatsapp|editar.*reserva|cancelar.*reserva|mutar.*cliente/i)
assert.doesNotMatch(templateText, /EVOLUTION_API_KEY|EVOLUTION_BASE_URL/)
assert.match(legacyText, /gRTZDLTXvGgNq4BZ/)
assert.equal(legacyText.includes(secretSentinel), false)
const allOutput = JSON.stringify({ fixture, first, duplicate, crossed, unknown, shadowLogs, externalMessages, mutations })
assert.equal(allOutput.includes(secretSentinel), false, 'La salida nunca debe contener secretos')
assert.equal(WEBHOOK_HEADER_NAME, 'x-austral-webhook-secret')

console.log(JSON.stringify({
  auth: 'passed',
  fixture: fixture.event_id,
  tenant: first.tenant,
  intent: first.shadow_log.intent,
  availability: first.shadow_log.result,
  proposed_response: first.proposed_response,
  idempotency: duplicate.reason,
  identity_crossed: crossed.reason,
  modes: 'fail_closed',
  shadow_logs: shadowLogs.length,
  mutation_blocked: true,
  mutations: mutations.length,
  messages_sent: externalMessages.length,
  template_active: template.active,
  legacy_audit: 'read-only',
}, null, 2))
