import assert from 'node:assert/strict'
import fs from 'node:fs'

const file = 'integrations/templates/Austral WhatsApp Production - Controlled.json'
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'))
const serialized = JSON.stringify(workflow)
const nodes = new Map(workflow.nodes.map((node) => [node.name, node]))
const required = [
  'Webhook Evolution - producción', 'Validar identidad e idempotencia', 'Resolver tenant',
  'Reclamar evento', 'Evento nuevo', 'Bloquear mutación de reserva',
  'Outbound habilitado para conexión', 'Reclamar outbound', 'Outbound nuevo',
  'Enviar respuesta Evolution', 'Validar ACK Evolution', 'Finalizar outbound',
]

assert.equal(workflow.name, 'Austral WhatsApp Production - Controlled')
assert.equal(workflow.active, false)
assert.equal(workflow.settings?.saveDataSuccessExecution, 'none')
assert.equal(workflow.settings?.saveDataErrorExecution, 'none')
assert.equal(workflow.settings?.saveManualExecutions, false)
assert.ok(workflow.settings?.executionTimeout > 0 && workflow.settings.executionTimeout <= 120)
for (const name of required) assert.ok(nodes.has(name), `Missing required node: ${name}`)

const allowedTypes = new Set([
  'n8n-nodes-base.webhook', 'n8n-nodes-base.code', 'n8n-nodes-base.if',
  'n8n-nodes-base.httpRequest', 'n8n-nodes-base.merge',
])
for (const node of workflow.nodes) {
  assert.ok(allowedTypes.has(node.type), `Disallowed node type: ${node.type}`)
  assert.equal(node.continueOnFail, undefined, `${node.name} must fail closed`)
  assert.ok(!node.credentials || Object.keys(node.credentials).length === 0, `${node.name} embeds credentials`)
}

const code = nodes.get('Validar identidad e idempotencia').parameters.jsCode
assert.match(code, /key\.fromMe === false/)
assert.match(code, /MESSAGES_UPSERT/)
assert.match(code, /\{1,180\}/)
assert.match(code, /5 \* 60 \* 1000/)
assert.match(code, /2 \* 60 \* 1000/)
assert.match(code, /mutationAllowed:false,outboundAllowed:false/)
assert.match(nodes.get('Resolver tenant').parameters.url, /resolve_whatsapp_runtime_context/)
assert.match(JSON.stringify(nodes.get('Reclamar evento').parameters), /claim_whatsapp_runtime_event/)
assert.match(JSON.stringify(nodes.get('Reclamar outbound').parameters), /claim_whatsapp_runtime_event/)
assert.match(JSON.stringify(nodes.get('Outbound habilitado para conexión').parameters), /outbound_enabled/)
assert.match(nodes.get('Bloquear mutación de reserva').parameters.jsCode, /mutationAllowed:false/)
assert.match(nodes.get('Enviar respuesta Evolution').parameters.url, /message\/sendText/)
assert.match(nodes.get('Validar ACK Evolution').parameters.jsCode, /evolution_ack_missing_no_retry/)

function destinations(name, branch = 0) {
  return (workflow.connections?.[name]?.main?.[branch] || []).map((edge) => edge.node)
}
assert.deepEqual(destinations('Webhook Evolution - producción'), ['Validar identidad e idempotencia'])
assert.ok(destinations('Outbound habilitado para conexión', 0).includes('Reclamar outbound'))
assert.ok(destinations('Outbound habilitado para conexión', 1).includes('Finalizar evento'))
assert.ok(destinations('Outbound nuevo', 0).includes('Enviar respuesta Evolution'))
assert.ok(destinations('Outbound nuevo', 1).includes('Finalizar evento'))
assert.ok(destinations('Horario válido', 0).includes('Bloquear mutación de reserva'))

assert.doesNotMatch(serialized, /miwsp|barberia central|austral-qa-tenant-|cmsymmszlzikqpvfqjre|ssagttjdgtypxjcgdnrw/i)
assert.doesNotMatch(serialized, /crear_reserva|cancelar_reserva|reprogramar_reserva|createPayment|mercadopago/i)
assert.doesNotMatch(serialized, /api[_-]?key\s*[:=]\s*["'][^$={]/i)

console.log(JSON.stringify({
  suite: 'whatsapp-production-workflow', active: workflow.active, nodes: workflow.nodes.length,
  credentials_embedded: false, inbound_guard: 'PASS', tenant_resolution: 'SERVER_SIDE',
  booking_mutation: 'BLOCKED', outbound: 'DOUBLE_GATED_AND_IDEMPOTENT', result: 'PASS',
}))
