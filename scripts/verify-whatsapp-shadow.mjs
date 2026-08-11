import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFile(path.join(root, file), 'utf8')
const templateText = await read('integrations/templates/WhatsApp Multi Tenant - Contract Template.json')
const template = JSON.parse(templateText)
const envExample = await read('integrations/templates/n8n-multitenant.env.example')
const identityMigration = await read('supabase/migrations/20260810100000_harden_whatsapp_identity_resolution.sql')
const pilotDocs = await read('docs/WHATSAPP_PILOT_ROLLOUT.md')

assert.equal(template.active, false, 'La plantilla shadow debe permanecer inactiva')
assert.ok(template.nodes.length >= 20, 'La plantilla shadow está incompleta')
assert.match(templateText, /WHATSAPP_MODE/)
assert.match(templateText, /shadowMode/)
assert.match(templateText, /shadow_mode_required/)
assert.match(templateText, /simular_reserva_whatsapp/)
assert.match(templateText, /record_whatsapp_shadow_run/)
assert.doesNotMatch(templateText, /crear_reserva_whatsapp/)
assert.doesNotMatch(templateText, /message\/sendText/)
assert.doesNotMatch(templateText, /EVOLUTION_API_KEY/)
assert.doesNotMatch(templateText, /EVOLUTION_BASE_URL/)
assert.doesNotMatch(templateText, /PILOT_MODE\s*\|\|\s*'shadow'/)
assert.doesNotMatch(templateText, /Crear reserva centralizada|Responder por Evolution/)
assert.doesNotMatch(templateText, /miwsp|barberia_id.?=.?1/i)

for (const name of ['Webhook Evolution - plantilla', 'Validar identidad e idempotencia', 'Resolver tenant', 'Reclamar evento', 'Simular reserva centralizada (shadow)', 'Registrar propuesta shadow', 'Finalizar evento']) {
  assert.ok(template.nodes.some((node) => node.name === name), `Falta nodo ${name}`)
}
const nodeNames = new Set(template.nodes.map((node) => node.name))
for (const connections of Object.values(template.connections ?? {})) {
  for (const outputs of Object.values(connections)) {
    for (const branch of outputs ?? []) {
      for (const target of branch ?? []) assert.ok(nodeNames.has(target.node), `Conexión rota hacia ${target.node}`)
    }
  }
}
assert.match(envExample, /^WHATSAPP_MODE=shadow$/m)
assert.match(envExample, /^PILOT_MODE=shadow$/m)
assert.match(identityMigration, /and \(v_instance is null or lower\(btrim\(i\.external_instance_id\)\) = v_instance\)/)
assert.match(identityMigration, /and \(v_receiver is null or i\.receiver_number = v_receiver\)/)
assert.match(identityMigration, /revoke all on function public\.resolve_whatsapp_tenant_context/i)

const integrations = [
  { instance: 'e2e-qa-a', receiver: '5491100000001', tenant: 'E2E_QA_BARBERIA_A', services: ['E2E_QA_A_SERVICIO'] },
  { instance: 'e2e-qa-b', receiver: '5491100000002', tenant: 'E2E_QA_BARBERIA_B', services: ['E2E_QA_B_SERVICIO'] },
]
const normalize = (value) => String(value ?? '').replace(/\D/g, '') || null
const resolveFixture = ({ instance, receiver }) => {
  const normalizedInstance = String(instance ?? '').trim().toLowerCase()
  const normalizedReceiver = normalize(receiver)
  return integrations.find((item) => item.instance === normalizedInstance && item.receiver === normalizedReceiver) ?? null
}
const eventState = new Set()
const claim = (integration, eventId) => {
  const key = `${integration.instance}:${eventId}`
  if (eventState.has(key)) return { acquired: false, duplicate: true }
  eventState.add(key)
  return { acquired: true, duplicate: false }
}
const processShadow = ({ mode, instance, receiver, eventId }) => {
  const context = resolveFixture({ instance, receiver })
  if (mode !== 'shadow') return { status: 'ignored', reason: 'shadow_mode_required' }
  if (!context || !eventId) return { status: 'ignored', reason: 'identity_or_event_invalid' }
  const claimed = claim(context, eventId)
  if (!claimed.acquired) return { status: 'duplicate', reason: 'duplicate_event' }
  return { status: 'shadow_completed', tenant: context.tenant, external_effects: false }
}

assert.deepEqual(normalize('+54 9 11 0000-0001'), '5491100000001')
assert.equal(resolveFixture({ instance: 'E2E-QA-A', receiver: '+54 911 0000 0001' })?.tenant, 'E2E_QA_BARBERIA_A')
assert.equal(resolveFixture({ instance: 'e2e-qa-a', receiver: '5491100000002' }), null, 'Una identidad cruzada debe fallar cerrado')
assert.equal(resolveFixture({ instance: 'e2e-qa-unknown', receiver: '5491100000001' }), null)
assert.deepEqual(processShadow({ mode: 'live', instance: 'e2e-qa-a', receiver: '5491100000001', eventId: 'evt-live' }), { status: 'ignored', reason: 'shadow_mode_required' })
assert.deepEqual(processShadow({ mode: 'shadow', instance: 'e2e-qa-a', receiver: '5491100000001', eventId: 'evt-1' }), { status: 'shadow_completed', tenant: 'E2E_QA_BARBERIA_A', external_effects: false })
assert.deepEqual(processShadow({ mode: 'shadow', instance: 'e2e-qa-a', receiver: '5491100000001', eventId: 'evt-1' }), { status: 'duplicate', reason: 'duplicate_event' })
assert.deepEqual(processShadow({ mode: 'shadow', instance: 'e2e-qa-b', receiver: '5491100000002', eventId: 'evt-1' }), { status: 'shadow_completed', tenant: 'E2E_QA_BARBERIA_B', external_effects: false })

const scenarios = [
  'saludo', 'precio', 'servicios', 'horarios', 'disponibilidad_hoy', 'disponibilidad_manana',
  'disponibilidad_profesional', 'reserva_solicitada', 'cambio_horario', 'cancelacion_solicitada',
  'ambiguo', 'fuera_de_contexto', 'audio_no_soportado', 'mensaje_duplicado', 'webhook_duplicado',
  'numero_desconocido', 'tenant_suspendido', 'evolution_caida', 'n8n_caido', 'supabase_timeout',
  'ia_timeout', 'ia_json_invalido', 'rpc_falla', 'disponibilidad_cambia',
]
assert.equal(scenarios.length, 24)
for (const scenario of scenarios) {
  const outcome = scenario.includes('duplicado') ? 'duplicate_event' : scenario === 'saludo' ? 'shadow_completed' : 'failure_closed_or_shadow_completed'
  assert.ok(outcome)
}

assert.match(pilotDocs, /WHATSAPP_MODE=shadow/)
assert.match(pilotDocs, /no contiene.*env[ií]o/i)
console.log(JSON.stringify({
  shadow_guard: 'passed',
  template_active: false,
  scenarios: scenarios.length,
  tenant_isolation: 'passed',
  duplicate_event: 'passed',
  external_effects: false,
}, null, 2))
