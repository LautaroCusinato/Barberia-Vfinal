import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const read = (...parts) => readFileSync(resolve(...parts), 'utf8')

// El navegador nunca debe conocer el webhook de n8n: cualquier VITE_* termina
// en el bundle público y permitiría enviar WhatsApp sin sesión.
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (
  entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]
))
for (const file of walk(resolve('src')).filter((name) => /\.(jsx?|tsx?)$/.test(name))) {
  const source = readFileSync(file, 'utf8')
  assert.doesNotMatch(source, /N8N_SEND_WEBHOOK/, `${file} no debe leer el webhook de n8n desde el navegador`)
  assert.doesNotMatch(source, /panel-enviar-wsp/, `${file} no debe llamar al webhook de n8n directamente`)
}
assert.doesNotMatch(read('.env.example'), /^VITE_N8N_SEND_WEBHOOK_URL=/m, '.env.example no debe proponer el webhook como variable pública')

const app = read('src', 'App.jsx')
assert.match(app, /functions\.invoke\(WHATSAPP_PANEL_SEND_FUNCTION/, 'El panel debe enviar por la edge function autenticada')
assert.match(app, /cliente_id: clienteId/, 'El panel envía el cliente, no el teléfono')

const panelSend = read('supabase', 'functions', 'whatsapp-panel-send', 'index.ts')
assert.match(panelSend, /authenticate\(request, admin\)/, 'La función debe exigir sesión')
assert.match(panelSend, /from\('barberia_members'\)/, 'La función debe verificar la membresía del tenant')
assert.match(panelSend, /\.eq\('barberia_id', tenantId\)[\s\S]*telefono/, 'El teléfono sale de la ficha del tenant')
assert.doesNotMatch(panelSend, /body\.telefono/, 'El teléfono nunca se toma del body')
// La lógica de validación vive en un módulo puro (probado en
// verify-whatsapp-panel-send.mjs); index.ts sólo lo conecta con la base y n8n.
const panelSendLogic = read('supabase', 'functions', '_shared', 'whatsappPanelSend.mjs')
assert.match(panelSend, /handlePanelSend\(\{ user, body, store, deliver, settings \}\)/, 'La función debe delegar en el módulo validado')
assert.doesNotMatch(panelSendLogic, /body\??\.(telefono|barberia_id|instance)/, 'El módulo nunca toma teléfono, negocio ni instancia del body')
const sendRoles = panelSendLogic.match(/export const PANEL_SEND_ROLES = new Set\(\[([^\]]*)\]\)/)?.[1] || ''
assert.ok(sendRoles, 'El módulo debe declarar los roles que pueden enviar')
assert.doesNotMatch(sendRoles, /readonly/, 'Un miembro readonly no puede enviar WhatsApp')
// Orden en el camino normal (contrato 2): validaciones, guardado, controles
// que dependen de otros envíos y recién después el reenvío a n8n.
const handler = panelSendLogic.slice(panelSendLogic.indexOf('export async function resolvePanelSendContext'))
const sendPath = handler.slice(handler.indexOf('export async function handlePanelSend'))
const order = [
  [handler, 'PANEL_SEND_ROLES.has(String(membership.role))'],
  [handler, 'store.accessState(tenantId)'],
  [handler, 'const blocked = integrationBlock(integration)'],
  [handler, 'const wrongSender = senderBlock(integration, settings)'],
  [handler, 'evaluateBotPause('],
  [handler, 'canonicalArgentineMobile(cliente.telefono)'],
]
let previous = -1
for (const [source, marker] of order) {
  const index = source.indexOf(marker)
  assert.ok(index > previous, `El módulo debe validar en orden antes de enviar: ${marker}`)
  previous = index
}
previous = -1
// Con la migración: reserva atómica (idempotencia, texto repetido, límite y
// pausa del bot en una transacción) antes del envío; sin ella, el camino por
// tablas de 7fba130 hace lo mismo sin atomicidad.
for (const marker of ['resolvePanelSendContext(', 'store.reserve(', 'reserveWithTables(', 'await safeDeliver(deliver']) {
  const index = sendPath.indexOf(marker)
  assert.ok(index > previous, `El envío debe guardar y controlar antes de reenviar: ${marker}`)
  previous = index
}
assert.match(panelSend, /rpc\('barberia_access_state', \{ p_barberia_id: tenantId \}\)/, 'Un tenant sin plan habilitado no envía')
assert.match(panelSend, /from\('saas_integraciones'\)[\s\S]*select\('estado, external_instance_id'\)[\s\S]*\.eq\('barberia_id', tenantId\)/, 'La conexión y su instancia se leen del tenant')
assert.match(panelSend, /Deno\.env\.get\('WHATSAPP_PANEL_SEND_INSTANCE'\)/, 'La instancia del webhook se declara en el servidor')
assert.match(panelSend, /Deno\.env\.get\('WHATSAPP_PANEL_SEND_ROUTING'\)/, 'El modo de remitente se declara en el servidor')
assert.match(panelSend, /return classifyWebhookResponse\(response\.status, parsed\)/, 'El resultado del webhook distingue recepción, aceptación, rechazo e incierto')
assert.match(panelSend, /rpc\(manual \? 'reservar_envio_panel_qa_manual' : 'reservar_envio_panel', \{[\s\S]*p_barberia_id: tenantId,[\s\S]*p_rate_limit: s\.rateLimit/, 'La reserva general y la manual usan el tenant resuelto y los límites del servidor')
assert.match(panelSend, /manual \? \{ allowedRecipients: manualQaPhoneList/, 'La lista de prueba se obtiene del servidor, nunca del navegador')
assert.match(panelSend, /manual \? \{ p_allowed_phones: s\.allowedRecipients/, 'La reserva manual recibe la lista validada en el servidor')
assert.doesNotMatch(panelSend, /p_rate_limit: body|p_barberia_id: body/, 'Ni límites ni tenant desde el body')

// Migración aditiva: sólo service_role ejecuta las RPC; estados validados sin
// revisar filas históricas; lock por negocio; "entregado" sólo con evidencia.
const migration = read('supabase', 'migrations', '20261005120000_whatsapp_panel_send_atomic.sql')
for (const fn of ['reservar_envio_panel', 'completar_envio_panel', 'recuperar_envios_panel_pendientes', 'telefono_whatsapp_canonico']) {
  assert.match(migration, new RegExp('revoke all on function public\\.' + fn + '\\([^)]*\\) from public, anon, authenticated;'), fn + ' no se expone al navegador')
  assert.match(migration, new RegExp('grant execute on function public\\.' + fn + '\\([^)]*\\) to service_role;'), fn + ' sólo para service_role')
  assert.doesNotMatch(migration, new RegExp('grant execute on function public\\.' + fn + '\\([^)]*\\) to (anon|authenticated)'), fn + ' no se otorga al navegador')
}
assert.match(migration, /add column if not exists client_message_id uuid/)
assert.match(migration, /create unique index if not exists uq_mensajes_barberia_client_message[\s\S]*\(barberia_id, client_message_id\)/, 'identificador único por negocio')
assert.match(migration, /check \(estado_envio in \('enviado', 'pendiente', 'recibido_n8n', 'aceptado', 'entregado', 'incierto', 'fallido'\)\)\s*not valid/, 'estados validados para filas nuevas sin bloquear históricas')
assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\('austral_panel_send:' \|\| p_barberia_id::text, 0\)\)/, 'lock por negocio')
assert.match(migration, /p_resultado not in \('recibido_n8n', 'aceptado', 'incierto', 'fallido'\)/, 'completar nunca marca entregado')
assert.doesNotMatch(migration, /alter column|drop column|drop table|alter type/i, 'la migración no cambia ni borra columnas existentes')
const rollback = read('scripts', 'sql', 'whatsapp-panel-send', 'rollback.sql')
for (const object of ['reservar_envio_panel', 'completar_envio_panel', 'recuperar_envios_panel_pendientes', 'mensajes_estado_envio_valido', 'client_message_id']) assert.match(rollback, new RegExp(object), 'el rollback quita ' + object)
assert.doesNotMatch(rollback, /delete from|truncate|drop table/i, 'el rollback conserva los mensajes')
assert.match(panelSend, /deleteMensaje[\s\S]*\.eq\('barberia_id', tenantId\)/, 'El borrado tras un rechazo queda acotado al tenant')

for (const fn of ['whatsapp-booking-mutation', 'whatsapp-agent-outbound-pilot', 'whatsapp-qa-outbound-one-shot']) {
  assert.match(read('supabase', 'functions', fn, 'index.ts'), /await requireOperator\(request, /, `${fn} debe validar al operador además del header Bearer`)
}

console.log('Panel send boundary checks passed')
