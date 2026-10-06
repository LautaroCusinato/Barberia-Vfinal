// Tarea 38 (P1): plantilla n8n "Austral Panel Send - Instance Routed".
// Verifica la estructura y ejecuta el código de sus nodos Code con entradas de
// prueba. No importa ni activa nada en n8n.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyWebhookResponse } from '../supabase/functions/_shared/whatsappPanelSend.mjs'

const file = 'integrations/templates/Austral Panel Send - Instance Routed.json'
const raw = readFileSync(file, 'utf8')
const workflow = JSON.parse(raw)
const node = (name) => {
  const found = workflow.nodes.find((candidate) => candidate.name === name)
  assert.ok(found, `falta el nodo ${name}`)
  return found
}
const targets = (name, branch = 0) => (workflow.connections[name]?.main?.[branch] || []).map((edge) => edge.node)

// Sin secretos, credenciales embebidas ni la instancia productiva fija.
assert.equal(workflow.active, false, 'la plantilla se importa desactivada')
assert.doesNotMatch(raw, /miwsp/i, 'la plantilla no fija ninguna instancia')
assert.doesNotMatch(raw, /PONE-ACA|apikey"\s*:\s*"[^=]|service_role|eyJ[a-zA-Z0-9_-]{10,}/, 'sin claves embebidas')
for (const candidate of workflow.nodes) assert.ok(!candidate.credentials, `${candidate.name} no debe traer credenciales`)
assert.equal(workflow.settings.saveDataSuccessExecution, 'none', 'no guarda textos ni teléfonos de ejecuciones exitosas')
assert.equal(workflow.settings.saveDataErrorExecution, 'none')

// Webhook autenticado que responde después de Evolution.
const webhook = node('Recibir envío del panel')
assert.equal(webhook.parameters.httpMethod, 'POST')
assert.equal(webhook.parameters.authentication, 'headerAuth', 'el webhook exige el secreto del servidor')
assert.equal(webhook.parameters.responseMode, 'responseNode', 'responde desde los nodos de respuesta, no al recibir')
assert.ok(!webhook.parameters.options?.allowedOrigins, 'sin CORS abierto: lo llama sólo la Edge Function')

// La instancia se lee de Supabase por el negocio validado y se compara.
const lookup = node('Leer integración del negocio')
const query = Object.fromEntries(lookup.parameters.queryParameters.parameters.map((item) => [item.name, item.value]))
assert.match(lookup.parameters.url, /\$env\.PANEL_SEND_SUPABASE_URL \+ '\/rest\/v1\/saas_integraciones'/)
assert.equal(query.barberia_id, "={{ 'eq.' + $('Validar solicitud').first().json.tenantId }}")
assert.equal(query.proveedor, 'eq.evolution')
assert.equal(lookup.onError, 'continueErrorOutput')
assert.notEqual(lookup.retryOnFail, true)

const evolution = node('Enviar por Evolution')
assert.equal(evolution.parameters.url, "={{ $env.EVOLUTION_BASE_URL + '/message/sendText/' + encodeURIComponent($('Autorizar instancia').first().json.instance) }}", 'sólo la instancia autorizada')
assert.doesNotMatch(JSON.stringify(evolution.parameters), /body\.instance|\$json\.body/, 'nunca la instancia del body')
assert.equal(evolution.onError, 'continueErrorOutput', 'un timeout se responde como incierto')
assert.notEqual(evolution.retryOnFail, true, 'sin reintento automático (pudo haber salido)')
assert.equal(evolution.parameters.options.response.response.neverError, true)
assert.equal(evolution.parameters.options.response.response.fullResponse, true)

// Rutas: Evolution sólo después de validar y autorizar; todo termina respondiendo.
assert.deepEqual(targets('Recibir envío del panel'), ['Validar solicitud'])
assert.deepEqual(targets('Solicitud válida', 0), ['Leer integración del negocio'])
assert.deepEqual(targets('Solicitud válida', 1), ['Responder rechazo'])
assert.deepEqual(targets('Leer integración del negocio', 1), ['Responder rechazo'], 'sin integración legible no se envía')
assert.deepEqual(targets('Instancia autorizada', 0), ['Enviar por Evolution'])
assert.deepEqual(targets('Instancia autorizada', 1), ['Responder rechazo'])
assert.deepEqual(targets('Enviar por Evolution', 0), ['Clasificar respuesta de Evolution'])
assert.deepEqual(targets('Enviar por Evolution', 1), ['Responder incierto'])
const incoming = new Map()
for (const [from, value] of Object.entries(workflow.connections)) for (const branch of value.main) for (const edge of branch || []) incoming.set(edge.node, [...(incoming.get(edge.node) || []), from])
assert.deepEqual(incoming.get('Enviar por Evolution'), ['Instancia autorizada'], 'Evolution tiene una sola entrada')
for (const candidate of workflow.nodes) {
  const outgoing = (workflow.connections[candidate.name]?.main || []).flat()
  if (!outgoing.length) assert.equal(candidate.type, 'n8n-nodes-base.respondToWebhook', `${candidate.name} termina sin responder`)
}
assert.equal(node('Responder incierto').parameters.options.responseCode, 502)
assert.equal(node('Responder rechazo').parameters.options.responseCode, 422)

// Ejecución del código de los nodos Code con un $input/$ mínimos.
const runCode = (name, input, refs = {}) => {
  const code = node(name).parameters.jsCode
  const $input = { first: () => ({ json: input[0] }), all: () => input.map((json) => ({ json })) }
  const $ = (ref) => ({ first: () => ({ json: refs[ref] }) })
  return new Function('$input', '$', code)($input, $)[0].json
}
const validRequest = { telefono: '5491122334455', texto: ' Hola ', barberia_id: 7, instance: 'Austral-QA-Tenant-7', client_message_id: '11111111-1111-4111-8111-111111111111' }
const validated = runCode('Validar solicitud', [{ body: validRequest }])
assert.deepEqual(validated, { valid: true, telefono: '5491122334455', texto: 'Hola', tenantId: 7, instance: 'austral-qa-tenant-7', clientMessageId: '11111111-1111-4111-8111-111111111111', reason: null })
for (const bad of [{ telefono: '1122334455' }, { texto: '   ' }, { texto: 'x'.repeat(4097) }, { barberia_id: 'siete' }, { barberia_id: -1 }, { instance: '../miwsp' }, { instance: '' }, { client_message_id: 'x' }]) {
  assert.equal(runCode('Validar solicitud', [{ body: { ...validRequest, ...bad } }]).valid, false, JSON.stringify(bad))
}

const authorize = (rows, instance = 'austral-qa-tenant-7') => runCode('Autorizar instancia', rows, { 'Validar solicitud': { ...validated, instance } })
assert.deepEqual(authorize([{ external_instance_id: 'Austral-QA-Tenant-7', estado: 'conectado' }]), { authorized: true, instance: 'austral-qa-tenant-7', reason: null })
assert.equal(authorize([{ external_instance_id: 'miwsp', estado: 'conectado' }]).authorized, false, 'otra instancia que la registrada del negocio')
assert.equal(authorize([{ external_instance_id: 'austral-qa-tenant-7', estado: 'desactivado' }]).authorized, false, 'conexión pausada')
assert.equal(authorize([{}]).authorized, false, 'sin integración (alwaysOutputData)')
assert.equal(authorize([{ external_instance_id: 'austral-qa-tenant-7', estado: 'conectado' }, { external_instance_id: 'austral-qa-tenant-7', estado: 'conectado' }]).authorized, false, 'respuesta ambigua')

const classify = (statusCode, body) => runCode('Clasificar respuesta de Evolution', [{ statusCode, body }])
assert.deepEqual(classify(201, { key: { id: 'EVO-1' } }), { result: 'accepted', message_id: 'EVO-1', httpStatus: 200, provider_status: 201 })
assert.equal(classify(200, {}).result, 'uncertain', '2xx sin id de Evolution no prueba la aceptación')
for (const status of [400, 401, 404, 429]) assert.equal(classify(status, {}).result, 'rejected', String(status))
for (const status of [408, 500, 502, 503]) assert.equal(classify(status, {}).result, 'uncertain', String(status))
assert.equal(classify(undefined, null).result, 'uncertain')

// La función interpreta igual lo que responde la plantilla.
assert.equal(classifyWebhookResponse(200, { result: 'accepted', message_id: 'EVO-1' }).outcome, 'accepted')
assert.equal(classifyWebhookResponse(422, { result: 'rejected', reason: 'instance_not_authorized' }).outcome, 'rejected')
assert.equal(classifyWebhookResponse(502, { result: 'uncertain' }).outcome, 'uncertain')
assert.equal(classifyWebhookResponse(502, { result: 'uncertain', reason: 'evolution_no_response' }).outcome, 'uncertain')

console.log('WhatsApp panel send workflow checks passed')
