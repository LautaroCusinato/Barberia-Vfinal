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
assert.match(panelSend, /handlePanelSend\(\{ user, body, store, deliver \}\)/, 'La función debe delegar en el módulo validado')
assert.doesNotMatch(panelSendLogic, /body\??\.(telefono|barberia_id)/, 'El módulo nunca toma teléfono ni negocio del body')
const sendRoles = panelSendLogic.match(/export const PANEL_SEND_ROLES = new Set\(\[([^\]]*)\]\)/)?.[1] || ''
assert.ok(sendRoles, 'El módulo debe declarar los roles que pueden enviar')
assert.doesNotMatch(sendRoles, /readonly/, 'Un miembro readonly no puede enviar WhatsApp')
const order = ['PANEL_SEND_ROLES.has(String(membership.role))', 'store.accessState(tenantId)', 'const blocked = integrationBlock(integration)', 'evaluateBotPause(', 'canonicalArgentineMobile(cliente.telefono)', 'store.countRecentPanelSends(', 'store.insertMensaje(row)', 'await deliver(']
let previous = -1
for (const marker of order) {
  const index = panelSendLogic.indexOf(marker)
  assert.ok(index > previous, `El módulo debe validar en orden antes de enviar: ${marker}`)
  previous = index
}
assert.match(panelSend, /rpc\('barberia_access_state', \{ p_barberia_id: tenantId \}\)/, 'Un tenant sin plan habilitado no envía')
assert.match(panelSend, /from\('saas_integraciones'\)[\s\S]*\.eq\('barberia_id', tenantId\)/, 'La conexión se lee del tenant')
assert.match(panelSend, /deleteMensaje[\s\S]*\.eq\('barberia_id', tenantId\)/, 'El borrado tras un envío fallido queda acotado al tenant')

for (const fn of ['whatsapp-booking-mutation', 'whatsapp-agent-outbound-pilot', 'whatsapp-qa-outbound-one-shot']) {
  assert.match(read('supabase', 'functions', fn, 'index.ts'), /await requireOperator\(request, /, `${fn} debe validar al operador además del header Bearer`)
}

console.log('Panel send boundary checks passed')
