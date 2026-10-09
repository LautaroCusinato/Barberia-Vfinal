import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { manualQaEnabled, manualQaRecipient, manualQaCapabilities, manualQaOpenRecipients, manualQaPhoneAllowed } from '../../supabase/functions/_shared/qaManualRuntime.mjs'
const env = { SUPABASE_URL: 'https://cmsymmszlzikqpvfqjre.supabase.co', WHATSAPP_PROVISIONING_ENV: 'qa', WHATSAPP_MODE: 'shadow', PILOT_MODE: 'shadow', WHATSAPP_QA_MANUAL_TENANT_IDS: '928' }
const getter = overrides => key => ({ ...env, ...overrides })[key]
const hash = phone => `sha256:${createHash('sha256').update(`${phone}@s.whatsapp.net`).digest('hex').slice(0, 12)}`
test('la habilitación manual sólo admite QA, tenant 928 y su instancia exacta', () => {
  assert.equal(manualQaEnabled(getter(), 928, 'austral-qa-tenant-928'), true)
  for (const [tenant, instance] of [[927,'austral-qa-tenant-927'],[928,'miwsp'],[928,'austral-qa-tenant-819']]) assert.equal(manualQaEnabled(getter(), tenant, instance), false)
  for (const overrides of [{ SUPABASE_URL: 'https://ssagttjdgtypxjcgdnrw.supabase.co' },{ WHATSAPP_PROVISIONING_ENV: 'production' },{ WHATSAPP_MODE: 'live' },{ WHATSAPP_QA_MANUAL_TENANT_IDS: '' }]) assert.equal(manualQaEnabled(getter(overrides),928,'austral-qa-tenant-928'), false)
  for (const url of ['https://cmsymmszlzikqpvfqjre.supabase.co.example.invalid','http://cmsymmszlzikqpvfqjre.supabase.co','https://u:p@cmsymmszlzikqpvfqjre.supabase.co','https://cmsymmszlzikqpvfqjre.supabase.co/path','https://cmsymmszlzikqpvfqjre.supabase.co?project=qa']) assert.equal(manualQaEnabled(getter({SUPABASE_URL:url}),928,'austral-qa-tenant-928'), false)
})
test('responde sólo al teléfono propio cuyo hash coincide con el evento persistido', async () => {
  const phones = ['5491155550107','5491155552851']
  const get = getter({ WHATSAPP_QA_MANUAL_RECIPIENTS: phones.join(',') })
  for (const phone of phones) assert.deepEqual(await manualQaRecipient(get,hash(phone)), { recipient: phone, recipientHash: hash(phone) })
  assert.equal(await manualQaRecipient(get,hash('5491155559999')), null)
  assert.equal(await manualQaRecipient(getter(),hash(phones[0])), null)
  assert.equal(await manualQaRecipient(getter({ WHATSAPP_QA_MANUAL_RECIPIENTS: [...phones,'5491155559999'].join(',') }),hash(phones[0])), null)
})
test('la ruta y la reserva respetan conexión y capacidades reales', () => {
  const connection = { state:'CONNECTED', automation_enabled:true, outbound_enabled:true, booking_enabled:false }
  assert.equal(manualQaCapabilities(connection), true)
  assert.equal(manualQaCapabilities(connection,{booking:true}), false)
  for (const patch of [{state:'CONNECTING'},{automation_enabled:false},{outbound_enabled:'true'}]) assert.equal(manualQaCapabilities({...connection,...patch}), false)
})

test('QA928 recibe otro cliente, pero sólo responde al remitente persistido cuyo hash coincide', async () => {
  const phone = '5491155559999'
  const get = getter({ WHATSAPP_QA_MANUAL_RECIPIENTS: '5491155550107,5491155552851' })
  assert.equal(manualQaOpenRecipients(get), true)
  assert.equal(manualQaPhoneAllowed(get, phone), true)
  assert.deepEqual(await manualQaRecipient(get, hash(phone), phone), { recipient: phone, recipientHash: hash(phone) })
  assert.equal(await manualQaRecipient(get, hash(phone), '5491155558888'), null, 'un número cambiado no coincide con el origen real')
  assert.equal(await manualQaRecipient(get, hash('5491155550107'), phone), null, 'la lista anterior tampoco puede ocultar una fuente cambiada')
  assert.equal(await manualQaRecipient(get, hash('5491155550107'), '123'), null, 'una fuente inválida no degrada al destino viejo')
  assert.equal(await manualQaRecipient(get, hash(phone)), null, 'sin teléfono de la fuente no se deduce un destino')
  assert.equal(manualQaPhoneAllowed(get, 'grupo@g.us'), false)
  assert.equal(manualQaPhoneAllowed(get, '123'), false)
  for (const overrides of [{SUPABASE_URL:'https://ssagttjdgtypxjcgdnrw.supabase.co'},{WHATSAPP_QA_MANUAL_TENANT_IDS:'927'},{WHATSAPP_PROVISIONING_ENV:'production'},{WHATSAPP_MODE:'live'}]) {
    assert.equal(manualQaOpenRecipients(getter(overrides)), false)
    assert.equal(await manualQaRecipient(getter(overrides), hash(phone), phone), null)
  }
})

test('las plantillas manuales no guardan headers, teléfonos ni textos en ejecuciones', () => {
  for (const file of ['Austral WhatsApp QA - Prueba manual 928.json', 'Austral Panel Send - QA manual 928.json']) {
    const workflow = JSON.parse(readFileSync(new URL(`../../integrations/templates/${file}`, import.meta.url), 'utf8'))
    assert.equal(workflow.active, false, 'activar requiere la preparación del entorno')
    assert.equal(workflow.settings.saveDataSuccessExecution, 'none', file)
    assert.equal(workflow.settings.saveDataErrorExecution, 'none', file)
    assert.equal(workflow.settings.saveManualExecutions, false, file)
    const webhook = workflow.nodes.find(node => node.type === 'n8n-nodes-base.webhook')
    assert.equal(webhook.parameters.authentication, 'headerAuth', 'autenticar antes del HTTP 200, no sólo dentro del workflow')
    assert.equal(webhook.credentials.httpHeaderAuth.id, 'australQa928PanelHeader', 'se reutiliza una credencial existente sin publicar el valor')
  }
})
