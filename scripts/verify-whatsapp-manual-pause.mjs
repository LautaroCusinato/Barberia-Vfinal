// Regresión: el workflow productivo debe respetar la pausa por atención humana
// (config.bot_activo, apagado por pause_whatsapp_bot_for_manual_reply).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { MANUAL_PAUSE_NODE_NAMES as N, applyManualPauseGate } from './lib/whatsappManualPauseGate.mjs'
import { validateProductionWorkflow } from './lib/whatsappProductionWorkflowValidator.mjs'

const file = 'integrations/templates/Austral WhatsApp Production - Controlled.json'
const workflow = JSON.parse(fs.readFileSync(file, 'utf8'))
const node = (name) => workflow.nodes.find((candidate) => candidate.name === name)
const targets = (name, branch = 0) => (workflow.connections[name]?.main?.[branch] || []).map((edge) => edge.node)

assert.deepEqual(validateProductionWorkflow(workflow).errors, [])
for (const name of Object.values(N)) assert.ok(node(name), `falta el nodo ${name}`)

// Consulta tenant-scoped y fail-closed.
for (const name of [N.lookup, N.recheck]) {
  const lookup = node(name)
  assert.equal(lookup.type, 'n8n-nodes-base.httpRequest')
  assert.equal(lookup.onError, 'stopWorkflow')
  assert.notEqual(lookup.retryOnFail, true)
  assert.equal(lookup.alwaysOutputData, true, 'una fila ausente debe llegar al evaluador como item vacío')
  assert.match(lookup.parameters.url, /\$env\.SUPABASE_PRODUCTION_URL \+ '\/rest\/v1\/config'/)
  const query = Object.fromEntries(lookup.parameters.queryParameters.parameters.map((item) => [item.name, item.value]))
  assert.equal(query.barberia_id, "={{ 'eq.' + $('Resolver tenant').first().json.tenant_id }}", 'la pausa se lee del tenant resuelto en el servidor')
  assert.equal(query.clave, 'eq.bot_activo')
  assert.equal(query.select, 'barberia_id,clave,valor')
  assert.ok(!lookup.credentials, 'sin credenciales embebidas')
}

// Rutas: pausa antes de la IA y otra vez antes del outbound.
assert.deepEqual(targets('Evento nuevo'), [N.lookup], 'el evento nuevo debe pasar primero por la pausa')
assert.deepEqual(targets(N.lookup), [N.evaluate])
assert.deepEqual(targets(N.evaluate), [N.gate])
assert.deepEqual(targets(N.gate, 0).sort(), ['Cargar bloqueos', 'Cargar empleados bajo demanda', 'Cargar horarios y pausas', 'Cargar servicios bajo demanda'])
assert.deepEqual(targets(N.gate, 1), [N.finishPaused], 'en pausa no se llama a la IA ni se envía')
assert.deepEqual(targets(N.finishPaused), [N.logPaused])
assert.deepEqual(targets('Registrar propuesta minimizada'), [N.recheck])
assert.deepEqual(targets(N.recheck), [N.reevaluate])
assert.deepEqual(targets(N.reevaluate), ['Outbound habilitado para conexión'])
const outboundCondition = node('Outbound habilitado para conexión').parameters.conditions.conditions[0].leftValue
assert.match(outboundCondition, /outbound_enabled === true/)
assert.match(outboundCondition, new RegExp(`\\$\\('${N.reevaluate}'\\)\\.first\\(\\)\\.json\\.botActive === true`))
assert.match(node(N.finishPaused).parameters.jsonBody, /manual_handoff_paused/)
assert.doesNotMatch(JSON.stringify(node(N.logPaused).parameters), /senderNumber|texto|remoteJid/)

// Ningún camino desde la rama "pausado" alcanza la IA o el envío.
const reachable = (start) => {
  const seen = new Set()
  const stack = [start]
  while (stack.length) {
    const current = stack.pop()
    if (seen.has(current)) continue
    seen.add(current)
    for (const branch of workflow.connections[current]?.main || []) for (const edge of branch || []) stack.push(edge.node)
  }
  return seen
}
const pausedPath = reachable(N.finishPaused)
for (const forbidden of ['Llamar DeepSeek', 'Enviar respuesta Evolution', 'Reclamar outbound']) assert.ok(!pausedPath.has(forbidden), `la rama pausada no debe alcanzar ${forbidden}`)

// Ejecuta la lógica real del nodo Code con distintas respuestas de PostgREST.
const runEvaluator = (name, rows, tenantId = 42) => new Function('$', node(name).parameters.jsCode)((ref) => {
  if (ref === 'Resolver tenant') return { first: () => ({ json: { tenant_id: tenantId } }) }
  const lookupName = name === N.evaluate ? N.lookup : N.recheck
  if (ref === lookupName) return { all: () => rows.map((json) => ({ json })) }
  throw new Error(`unexpected node reference ${ref}`)
})[0].json

for (const name of [N.evaluate, N.reevaluate]) {
  assert.equal(runEvaluator(name, [{}]).botActive, true, 'sin fila (item vacío) = activo')
  assert.equal(runEvaluator(name, []).botActive, true, 'sin items = activo')
  assert.equal(runEvaluator(name, [{ barberia_id: 42, clave: 'bot_activo', valor: 'true' }]).botActive, true)
  assert.equal(runEvaluator(name, [{ barberia_id: 42, clave: 'bot_activo', valor: 'false' }]).botActive, false, 'pausa manual = no responder')
  assert.equal(runEvaluator(name, [{ barberia_id: 42, clave: 'bot_activo', valor: 'garbage' }]).botActive, false, 'valor desconocido = pausado')
  assert.throws(() => runEvaluator(name, [{ barberia_id: 7, clave: 'bot_activo', valor: 'true' }]), /manual_pause_lookup_invalid/, 'fila de otro tenant = fail closed')
  assert.throws(() => runEvaluator(name, [{ message: 'JWT expired', code: 'PGRST301' }]), /manual_pause_lookup_invalid/, 'respuesta de error = fail closed')
  assert.throws(() => runEvaluator(name, [{ barberia_id: 42, clave: 'bot_activo', valor: 'true' }, { barberia_id: 42, clave: 'bot_activo', valor: 'false' }]), /manual_pause_lookup_ambiguous/)
  assert.throws(() => runEvaluator(name, [{}], null), /manual_pause_tenant_invalid/)
}

// El generador aplica el mismo gate y es idempotente.
const generator = fs.readFileSync('scripts/prepare-whatsapp-production-workflow.mjs', 'utf8')
assert.match(generator, /applyManualPauseGate\(workflow\)/)
const twice = applyManualPauseGate(structuredClone(workflow))
assert.equal(twice.nodes.length, workflow.nodes.length, 'aplicar el gate dos veces no duplica nodos')

// Guardas negativas: quitar la pausa debe detectarse.
const broken = structuredClone(workflow)
broken.connections['Evento nuevo'].main[0] = [{ node: 'Cargar servicios bajo demanda', type: 'main', index: 0 }]
assert.notDeepEqual(broken.connections['Evento nuevo'].main[0].map((edge) => edge.node), [N.lookup])

console.log(JSON.stringify({
  suite: 'whatsapp-manual-pause',
  checks: ['before_ai', 'before_outbound'],
  missing_row: 'ACTIVE',
  paused_value: 'NO_REPLY',
  lookup_error: 'FAIL_CLOSED',
  result: 'PASS',
}))
