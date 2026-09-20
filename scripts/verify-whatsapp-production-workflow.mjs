import assert from 'node:assert/strict'
import fs from 'node:fs'
import { validateProductionWorkflow } from './lib/whatsappProductionWorkflowValidator.mjs'

const file = 'integrations/templates/Austral WhatsApp Production - Controlled.json'
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'))
const report = validateProductionWorkflow(workflow)
assert.deepEqual(report.errors, [])
assert.equal(report.valid, true)

function mutation(name, mutate, expectedCode) {
  const candidate = structuredClone(workflow)
  mutate(candidate)
  const result = validateProductionWorkflow(candidate)
  assert.equal(result.valid, false, `${name} must fail validation`)
  assert.ok(result.errors.some((error) => error.code === expectedCode), `${name} must report ${expectedCode}`)
}

const node = (candidate, name) => candidate.nodes.find((item) => item.name === name)
mutation('active workflow', (candidate) => { candidate.active = true }, 'WORKFLOW_ACTIVE')
mutation('embedded credential', (candidate) => { node(candidate, 'Llamar DeepSeek').credentials = { httpHeaderAuth: { id: 'credential-id', name: 'Production key' } } }, 'CREDENTIALS_EMBEDDED')
mutation('QA credential instruction', (candidate) => { node(candidate, 'Llamar DeepSeek').notes = 'Bind QA DeepSeek Header Auth credential.' }, 'QA_CREDENTIAL_REFERENCE')
mutation('QA endpoint', (candidate) => { node(candidate, 'Resolver tenant').parameters.url = 'https://cmsymmszlzikqpvfqjre.supabase.co/rest/v1/rpc/resolve_whatsapp_runtime_context' }, 'PROTECTED_OR_QA_HARDCODE')
mutation('hardcoded tenant', (candidate) => { node(candidate, 'Resolver tenant').parameters.jsonBody = "={{ { p_environment: 'production', tenant_id: 42 } }}" }, 'TENANT_ID_HARDCODED')
mutation('fromMe guard removed', (candidate) => { node(candidate, 'Validar identidad e idempotencia').parameters.jsCode = node(candidate, 'Validar identidad e idempotencia').parameters.jsCode.replace('key.fromMe === false', 'true') }, 'INBOUND_GUARD_MISSING')
mutation('event id guard removed', (candidate) => { node(candidate, 'Validar identidad e idempotencia').parameters.jsCode = node(candidate, 'Validar identidad e idempotencia').parameters.jsCode.replaceAll('validEventId', 'eventAccepted') }, 'INBOUND_GUARD_MISSING')
mutation('outbound guard removed', (candidate) => { node(candidate, 'Outbound habilitado para conexión').parameters = {} }, 'OUTBOUND_GUARD_MISSING')
mutation('outbound duplicate sends', (candidate) => { candidate.connections['Outbound nuevo'].main[1] = [{ node: 'Enviar respuesta Evolution', type: 'main', index: 0 }] }, 'OUTBOUND_DUPLICATE_ROUTE_INVALID')
mutation('booking mutation added', (candidate) => { node(candidate, 'Bloquear mutación de reserva').parameters.jsCode = 'return crear_reserva_whatsapp($json)' }, 'MUTATION_OR_BILLING_PRESENT')
mutation('unsafe retry', (candidate) => { node(candidate, 'Enviar respuesta Evolution').retryOnFail = true }, 'NODE_NOT_FAIL_CLOSED')

console.log(JSON.stringify({
  suite: 'whatsapp-production-workflow',
  active: workflow.active,
  nodes: workflow.nodes.length,
  credentials_embedded: false,
  inbound_guard: 'PASS',
  tenant_resolution: 'SERVER_SIDE',
  booking_mutation: 'BLOCKED',
  outbound: 'DOUBLE_GATED_AND_IDEMPOTENT',
  adversarial_mutations_rejected: 11,
  result: 'PASS',
}))
