// Genera los workflows n8n de WhatsApp administrado para producción a partir
// de las plantillas QA928 verificadas (misma lógica, reintentos y privacidad).
// Cambian sólo: ruta del webhook, proyecto Supabase, credencial de funciones
// y la validación de alcance (cualquier negocio con su instancia
// austral-prod-tenant-<id>, nunca miwsp).
// Uso: node scripts/prepare-whatsapp-managed-workflows.mjs [--check]
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templates = path.join(root, 'integrations', 'templates')
const QA_REF = 'cmsymmszlzikqpvfqjre'
const PROD_REF = 'ssagttjdgtypxjcgdnrw'
export const PROD_FUNCTIONS_CREDENTIAL = { id: 'australProdFnSecret', name: 'Austral Producción Funciones' }

const read = (file) => JSON.parse(fs.readFileSync(path.join(templates, file), 'utf8'))
const byName = (wf, name) => {
  const node = wf.nodes.find((n) => n.name === name)
  if (!node) throw new Error(`nodo faltante: ${name}`)
  return node
}

function retarget(wf, { id, name, webhookNode, webhookPath, webhookId }) {
  const copy = JSON.parse(JSON.stringify(wf))
  copy.id = id
  copy.name = name
  copy.active = false
  const hook = byName(copy, webhookNode)
  hook.parameters.path = webhookPath
  hook.webhookId = webhookId
  for (const node of copy.nodes) {
    if (typeof node.parameters?.url === 'string') node.parameters.url = node.parameters.url.replaceAll(QA_REF, PROD_REF)
    if (node.credentials?.httpCustomAuth?.id === 'australQa36FnSecret') node.credentials.httpCustomAuth = { ...PROD_FUNCTIONS_CREDENTIAL }
  }
  return copy
}

export function buildManagedWorkflows() {
  const route = retarget(read('Austral WhatsApp QA - Prueba manual 928.json'), {
    id: 'australManagedRoute', name: 'Austral WhatsApp administrado - conversación, reserva y confirmación',
    webhookNode: 'Ruta QA 36', webhookPath: 'austral-managed-route', webhookId: 'a7c1e0d2-5b3f-4e61-9a10-0a5a9d1e2f01',
  })
  byName(route, 'Validar ruta QA 36').parameters.jsCode = [
    "const item = $input.first()?.json || {};",
    "const body = item.body || {};",
    "const headers = item.headers || {};",
    "const expected = String($env.EVOLUTION_WEBHOOK_SECRET || '');",
    "const received = String(headers['x-austral-qa-route-secret'] || '');",
    "const tenantId = Number(body.tenant_id);",
    "const eventId = String(body.event_id || '');",
    "if (!expected || received.length !== expected.length || received !== expected) throw new Error('managed_route_unauthorized');",
    "if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || body.instance !== 'austral-prod-tenant-' + tenantId || body.instance === 'miwsp') throw new Error('managed_route_tenant_rejected');",
    "if (!Number.isSafeInteger(Number(body.integration_id)) || Number(body.integration_id) <= 0) throw new Error('managed_route_integration_rejected');",
    "if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(eventId)) throw new Error('managed_route_event_rejected');",
    "return [{ json: { event_id: eventId, tenant_id: tenantId, ready_for_booking_mutation: body.ready_for_booking_mutation === true } }];",
  ].join('\n')

  const language = retarget(read('Austral WhatsApp QA - Lenguaje 928.json'), {
    id: 'australManagedLanguage', name: 'Austral WhatsApp administrado - interpretación de conversación',
    webhookNode: 'Pedido de interpretación QA928', webhookPath: 'austral-managed-language', webhookId: 'managed-language-20261010',
  })
  const languageCheck = byName(language, 'Validar contexto sin datos de contacto')
  const qaScope = "if(body.tenant_id!==928||body.instance!=='austral-qa-tenant-928'||typeof body.text!=='string'||body.text.length>1600)throw new Error('qa928_language_scope_required');"
  if (!languageCheck.parameters.jsCode.includes(qaScope)) throw new Error('la validación QA928 del lenguaje cambió')
  languageCheck.parameters.jsCode = languageCheck.parameters.jsCode.replace(qaScope,
    "if(!Number.isSafeInteger(body.tenant_id)||body.tenant_id<=0||body.instance!=='austral-prod-tenant-'+body.tenant_id||typeof body.text!=='string'||body.text.length>1600)throw new Error('managed_language_scope_required');")

  const panel = retarget(read('Austral Panel Send - QA manual 928.json'), {
    id: 'australManagedPanel', name: 'Austral WhatsApp administrado - envío manual del panel',
    webhookNode: 'Recibir envío del panel', webhookPath: 'austral-managed-panel-send', webhookId: 'c3e9b8a4-7d21-4f0e-8b5c-2a6d9e0f1b02',
  })
  const panelCheck = byName(panel, 'Validar solicitud')
  const qaPanelScope = "const valid = tenantId === 928 && instance === 'austral-qa-tenant-928' && "
  if (!panelCheck.parameters.jsCode.includes(qaPanelScope)) throw new Error('la validación QA928 del panel cambió')
  panelCheck.parameters.jsCode = panelCheck.parameters.jsCode.replace(qaPanelScope, "const valid = instance === 'austral-prod-tenant-' + tenantId && ")

  return {
    'Austral WhatsApp Administrado - Ruta.json': route,
    'Austral WhatsApp Administrado - Lenguaje.json': language,
    'Austral WhatsApp Administrado - Envio panel.json': panel,
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  let stale = false
  for (const [file, workflow] of Object.entries(buildManagedWorkflows())) {
    const target = path.join(templates, file)
    const content = JSON.stringify(workflow, null, 2) + '\n'
    if (check) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) { stale = true; console.error(`desactualizado: ${file}`) }
    } else {
      fs.writeFileSync(target, content)
      console.log(`generado: ${file}`)
    }
  }
  if (stale) process.exit(1)
}
