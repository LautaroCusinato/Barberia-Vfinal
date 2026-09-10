import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEBHOOK_SECRET_SENTINEL = 'offline-qa-webhook-sentinel'

const integrations = Object.freeze([
  { integrationId: 'E2E_QA_INTEGRATION_A', instance: 'e2e-qa-a', receiver: '5491100000001', tenantId: 'E2E_QA_BARBERIA_A' },
  { integrationId: 'E2E_QA_INTEGRATION_B', instance: 'e2e-qa-b', receiver: '5491100000002', tenantId: 'E2E_QA_BARBERIA_B' },
])

const fixtures = Object.freeze({
  services_query: { eventId: 'E2E_QA_HARNESS_SERVICES', text: '¿Qué servicios tienen?' },
  price_query: { eventId: 'E2E_QA_HARNESS_PRICE', text: '¿Cuánto sale el corte?' },
  availability_query: { eventId: 'E2E_QA_HARNESS_AVAILABILITY', text: '¿Hay turno mañana a las 17?' },
  booking_intent: { eventId: 'E2E_QA_HARNESS_BOOKING', text: 'Quiero reservar' },
  fromMe: { eventId: 'E2E_QA_HARNESS_FROM_ME', text: 'respuesta saliente', fromMe: true },
  invalid: { eventId: '', text: 'payload inválido' },
  unknownTenant: { eventId: 'E2E_QA_HARNESS_UNKNOWN', text: 'Hola', instance: 'e2e-qa-unknown' },
  duplicate: { eventId: 'E2E_QA_HARNESS_DUPLICATE', text: 'Hola' },
  incompleteIdentity: { eventId: 'E2E_QA_HARNESS_INCOMPLETE', text: 'Hola', receiver: '' },
  loop: { eventId: 'E2E_QA_HARNESS_LOOP', text: 'respuesta del agente', fromMe: true },
})

const normalizeDigits = (value) => String(value ?? '').replace(/\D/g, '') || null
const normalizeInstance = (value) => String(value ?? '').trim().toLowerCase() || null

const classifyIntent = (text) => {
  const normalized = String(text ?? '').toLocaleLowerCase('es-AR')
  if (/servicio|servicios/.test(normalized)) return 'services_query'
  if (/precio|cu[aá]nto sale|cu[aá]nto cuesta/.test(normalized)) return 'price_query'
  if (/turno|disponib|ma[ñn]ana|horario/.test(normalized)) return 'availability_query'
  if (/reserv/.test(normalized)) return 'booking_intent'
  return 'general_query'
}

const resolveTenant = ({ instance, receiver }) => {
  const normalizedInstance = normalizeInstance(instance)
  const normalizedReceiver = normalizeDigits(receiver)
  return integrations.find((entry) => entry.instance === normalizedInstance && entry.receiver === normalizedReceiver) ?? null
}

const validateIdentity = ({ event, headerValue, expectedSecret }) => {
  const payload = event && typeof event === 'object' && !Array.isArray(event) ? event : null
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload
  const key = data?.key && typeof data.key === 'object' ? data.key : {}
  const eventId = String(key.id ?? data?.eventId ?? data?.event_id ?? '').trim()
  const instance = normalizeInstance(data?.instance ?? payload?.instance)
  const receiver = normalizeDigits(data?.destination ?? payload?.destination)
  const fromMe = Boolean(key.fromMe ?? data?.fromMe ?? payload?.fromMe)
  const valid = Boolean(
    payload
    && payload.event === 'MESSAGES_UPSERT'
    && headerValue === expectedSecret
    && eventId
    && instance
    && receiver
    && fromMe === false
  )
  return { valid, eventId, instance, receiver, fromMe }
}

const createProcessor = () => {
  const claims = new Set()
  const shadowRuns = []
  const outbound = []
  const bookingWrites = []
  const customerWrites = []

  const process = (fixture, overrides = {}) => {
    const payload = {
      event: 'MESSAGES_UPSERT',
      instance: fixture.instance ?? 'e2e-qa-a',
      destination: fixture.receiver ?? '5491100000001',
      data: {
        key: { id: fixture.eventId, fromMe: fixture.fromMe ?? false },
        instance: fixture.instance ?? 'e2e-qa-a',
        destination: fixture.receiver ?? '5491100000001',
        message: { conversation: fixture.text },
      },
      tenant_id: fixture.tenant_id ?? 'attacker-controlled-value',
      ...overrides,
    }
    const identity = validateIdentity({
      event: overrides.payload ?? payload,
      headerValue: overrides.headerValue ?? WEBHOOK_SECRET_SENTINEL,
      expectedSecret: WEBHOOK_SECRET_SENTINEL,
    })
    if (!identity.valid) return { status: 'rejected', reason: identity.fromMe ? 'from_me_ignored' : 'invalid_identity', mutationBlocked: true, outboundAllowed: false }

    const context = resolveTenant(identity)
    if (!context) return { status: 'rejected', reason: 'tenant_not_found', mutationBlocked: true, outboundAllowed: false }

    const claimKey = `${context.integrationId}:${identity.eventId}`
    if (claims.has(claimKey)) return { status: 'duplicate', reason: 'duplicate_event', tenantId: context.tenantId, mutationBlocked: true, outboundAllowed: false }
    claims.add(claimKey)

    const intent = classifyIntent(fixture.text)
    const result = {
      status: 'shadow_completed',
      tenantId: context.tenantId,
      integrationId: context.integrationId,
      instance: context.instance,
      eventId: identity.eventId,
      intent,
      proposedReply: `QA proposal for ${intent}`,
      mutationAllowed: false,
      outboundAllowed: false,
      mutationBlocked: true,
    }
    shadowRuns.push(result)
    return result
  }

  return { process, claims, shadowRuns, outbound, bookingWrites, customerWrites }
}

const processor = createProcessor()

for (const key of ['services_query', 'price_query', 'availability_query', 'booking_intent']) {
  const result = processor.process(fixtures[key])
  assert.equal(result.status, 'shadow_completed')
  assert.equal(result.tenantId, 'E2E_QA_BARBERIA_A')
  assert.equal(result.mutationAllowed, false)
  assert.equal(result.outboundAllowed, false)
  assert.equal(result.mutationBlocked, true)
}

assert.equal(processor.process(fixtures.fromMe).reason, 'from_me_ignored')
assert.equal(processor.process(fixtures.invalid).reason, 'invalid_identity')
assert.equal(processor.process(fixtures.unknownTenant).reason, 'tenant_not_found')
assert.equal(processor.process(fixtures.incompleteIdentity).reason, 'invalid_identity')
assert.equal(processor.process(fixtures.loop).reason, 'from_me_ignored')
assert.equal(processor.process(fixtures.duplicate).status, 'shadow_completed')
assert.equal(processor.process(fixtures.duplicate).status, 'duplicate')

const crossedTenant = processor.process({ ...fixtures.services_query, eventId: 'E2E_QA_HARNESS_CROSS_TENANT', instance: 'e2e-qa-a', receiver: '5491100000002' })
assert.equal(crossedTenant.reason, 'tenant_not_found')
assert.equal(processor.outbound.length, 0)
assert.equal(processor.bookingWrites.length, 0)
assert.equal(processor.customerWrites.length, 0)
assert.ok(processor.shadowRuns.every((run) => run.tenantId === 'E2E_QA_BARBERIA_A'))

const templateText = await fs.readFile(path.join(root, 'integrations/templates/WhatsApp Multi Tenant - Contract Template.json'), 'utf8')
const template = JSON.parse(templateText)
assert.equal(template.active, false)
assert.doesNotMatch(templateText, /sendText|crear_reserva_whatsapp|editar.*reserva|cancelar.*reserva/i)
assert.doesNotMatch(templateText, /miwsp|barber[ií]a central|barberia_id\s*[=:]\s*1/i)

console.log(JSON.stringify({
  fixtures: Object.keys(fixtures).length,
  accepted_shadow_cases: processor.shadowRuns.length,
  duplicate_rejected: true,
  from_me_rejected: true,
  cross_tenant_rejected: true,
  outbound_calls: processor.outbound.length,
  booking_writes: processor.bookingWrites.length,
  customer_writes: processor.customerWrites.length,
  mutation_allowed: false,
  outbound_allowed: false,
  template_active: template.active,
}, null, 2))
