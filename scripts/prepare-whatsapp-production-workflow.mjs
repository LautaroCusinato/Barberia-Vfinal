import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourcePath = path.join(root, 'integrations/templates/Austral WhatsApp QA - Shadow No Outbound.json')
const targetPath = path.join(root, 'integrations/templates/Austral WhatsApp Production - Controlled.json')
const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
const node = (name) => {
  const found = workflow.nodes.find((candidate) => candidate.name === name)
  if (!found) throw new Error(`missing_source_node:${name}`)
  return found
}
const link = (name, outputs) => { workflow.connections[name] = { main: outputs } }
const next = (name, index = 0) => ({ node: name, type: 'main', index })

workflow.name = 'Austral WhatsApp Production - Controlled'
workflow.active = false
delete workflow.id
delete workflow.versionId

Object.assign(node('Webhook Evolution - plantilla'), {
  name: 'Webhook Evolution - producción',
  webhookId: 'austral-whatsapp-production-controlled-v1',
  notes: 'INACTIVE BY DEFAULT. Bind a dedicated Header Auth credential and publish only for an approved tenant-scoped production window.',
})
node('Webhook Evolution - producción').parameters.path = 'austral-whatsapp-production-inbound'

node('Validar identidad e idempotencia').parameters.jsCode = `const input = $input.first()?.json ?? {};
const body = input.body;
const data = body && typeof body === 'object' && !Array.isArray(body) && body.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
const key = data.key && typeof data.key === 'object' ? data.key : {};
const instanceName = typeof body?.instance === 'string' ? body.instance.trim() : '';
const eventId = typeof key.id === 'string' ? key.id.trim() : '';
const rawJid = typeof key.remoteJid === 'string' ? key.remoteJid.trim() : '';
const alternateJid = typeof key.remoteJidAlt === 'string' ? key.remoteJidAlt.trim() : '';
const remoteJid = /^\\d+@lid$/.test(rawJid) && /^\\d{5,20}@s\\.whatsapp\\.net$/.test(alternateJid) ? alternateJid : rawJid;
const event = String(body?.event ?? '').toUpperCase().replace(/[.\\s-]+/g, '_');
const texto = String(data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? '').trim().slice(0, 2000);
const valid = Boolean(event === 'MESSAGES_UPSERT' && key.fromMe === false && /^[a-zA-Z0-9_-]{1,100}$/.test(instanceName) && eventId.length > 0 && eventId.length <= 180 && /^\\d{5,20}@s\\.whatsapp\\.net$/.test(remoteJid) && texto);
return [{json:{instanceName,eventId,texto,senderNumber:remoteJid.split('@')[0],fromMe:key.fromMe,invalid:!valid,webhookAuthenticated:true,environment:'production',mutationAllowed:false,outboundAllowed:false,receivedAt:Date.now(),reason:valid?null:'invalid_inbound'}}];`

const supabaseRpc = (rpc) => `={{ $env.SUPABASE_URL + '/rest/v1/rpc/${rpc}' }}`
node('Resolver tenant').parameters.url = supabaseRpc('resolve_whatsapp_runtime_context')
node('Resolver tenant').parameters.jsonBody = "={{ JSON.stringify({ p_environment: 'production', p_external_instance_id: $('Validar identidad e idempotencia').first().json.instanceName }) }}"
node('Resolver tenant').notes = 'Bind a production-only Supabase service credential. Tenant is derived exclusively from the registered Evolution instance.'
node('Tenant encontrado').parameters.conditions.conditions[0].leftValue = "={{ Number.isSafeInteger(Number($json.tenant_id)) && Number($json.tenant_id) > 0 && Number.isSafeInteger(Number($json.integration_id)) && Number($json.integration_id) > 0 && $json.environment === 'production' && $json.automation_enabled === true }}"

node('Reclamar evento').parameters.url = supabaseRpc('claim_whatsapp_runtime_event')
node('Reclamar evento').parameters.jsonBody = "={{ JSON.stringify({ p_environment: 'production', p_integration_id: $('Resolver tenant').first().json.integration_id, p_event_id: $('Validar identidad e idempotencia').first().json.eventId, p_operation: 'inbound' }) }}"
node('Reclamar evento').notes = 'Atomic tenant-scoped claim. Duplicate events stop before reads, AI, and outbound.'

for (const [name, suffix] of [
  ['Cargar servicios bajo demanda', "/rest/v1/servicios?barberia_id=eq.' + $('Resolver tenant').first().json.tenant_id + '&activo=eq.true&select=id,nombre,descripcion,precio,duracion_min,barberias(id,moneda)"],
  ['Cargar empleados bajo demanda', "/rest/v1/barberos?barberia_id=eq.' + $('Resolver tenant').first().json.tenant_id + '&activo=eq.true&select=id,nombre,color"],
  ['Cargar horarios y pausas', "/rest/v1/horarios_barbero?barberia_id=eq.' + $('Resolver tenant').first().json.tenant_id + '&activo=eq.true&select=barbero_id,day_of_week,start_time,end_time"],
  ['Cargar bloqueos', "/rest/v1/bloqueos_agenda?barberia_id=eq.' + $('Resolver tenant').first().json.tenant_id + '&select=fecha,barbero_id,start_time,end_time"],
]) {
  node(name).parameters.url = `={{ $env.SUPABASE_URL + '${suffix} }}`
  node(name).notes = 'Production service credential; query remains scoped to the server-resolved tenant.'
}

node('Consultar disponibilidad').parameters.url = supabaseRpc('horarios_disponibles_reserva_publica')
node('Crear reserva centralizada').name = 'Bloquear mutación de reserva'
node('Bloquear mutación de reserva').parameters.jsCode = "return [{json:{mutationAllowed:false,booking_created:false,mutation_blocked:true}}];"
node('Bloquear mutación de reserva').notes = 'No booking RPC is present in this workflow. Booking requires a separate release and authorization.'

node('Responder por Evolution').name = 'Registrar propuesta minimizada'
node('Registrar propuesta minimizada').parameters.url = supabaseRpc('record_whatsapp_shadow_run')
node('Registrar propuesta minimizada').parameters.jsonBody = "={{ JSON.stringify({p_integration_id:$('Resolver tenant').first().json.integration_id,p_event_id:$('Validar identidad e idempotencia').first().json.eventId,p_intent:$('Validar respuesta IA').first().json.intent,p_proposed_result:$('Construir respuesta segura').first().json.resultReference,p_proposed_response_length:$('Construir respuesta segura').first().json.text.length,p_proposed_latency_ms:$('Construir respuesta segura').first().json.proposalLatencyMs,p_metadata:{environment:'production',mode:'controlled',mutation_allowed:false,outbound_allowed:$('Resolver tenant').first().json.outbound_enabled===true}}) }}"
node('Registrar propuesta minimizada').notes = 'Stores no phone, JID, prompt, credential, or full proposed reply.'

const outboundEnabled = {
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: "={{ $('Resolver tenant').first().json.outbound_enabled === true }}", rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' }, options: {} },
  id: 'production-outbound-enabled-gate', name: 'Outbound habilitado para conexión', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [3320, 240],
  notes: 'False by default. This reads the tenant-scoped database flag; the inbound payload cannot enable outbound.',
}
const claimOutbound = {
  parameters: { method: 'POST', url: supabaseRpc('claim_whatsapp_runtime_event'), sendHeaders: false, sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify({p_environment:'production',p_integration_id:$('Resolver tenant').first().json.integration_id,p_event_id:$('Validar identidad e idempotencia').first().json.eventId,p_operation:'outbound'}) }}", options: { timeout: 20000 }, authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth' },
  id: 'production-outbound-claim', name: 'Reclamar outbound', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [3540, 160],
  notes: 'Atomic outbound claim. Never retry an ambiguous provider send.',
}
const outboundClaimed = {
  parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 }, conditions: [{ leftValue: '={{ $json.acquired === true }}', rightValue: true, operator: { type: 'boolean', operation: 'equals' } }], combinator: 'and' }, options: {} },
  id: 'production-outbound-claim-gate', name: 'Outbound nuevo', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [3760, 160],
}
const sendEvolution = {
  parameters: { method: 'POST', url: "={{ $env.EVOLUTION_BASE_URL + '/message/sendText/' + encodeURIComponent($('Validar identidad e idempotencia').first().json.instanceName) }}", sendHeaders: false, sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify({number:$('Validar identidad e idempotencia').first().json.senderNumber,text:$('Construir respuesta segura').first().json.text}) }}", options: { timeout: 20000 }, authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth' },
  id: 'production-evolution-send', name: 'Enviar respuesta Evolution', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [3980, 80],
  notes: 'Bind a production-only Evolution API credential. Recipient is the validated inbound sender kept in memory; it is not accepted as workflow input.',
}
const validateAck = {
  parameters: { mode: 'runOnceForAllItems', jsCode: "const body=$input.first()?.json??{};const ack=Boolean(body.key?.id||body.messageId||body.id);if(!ack)throw new Error('evolution_ack_missing_no_retry');return [{json:{providerAck:true}}];" },
  id: 'production-evolution-ack', name: 'Validar ACK Evolution', type: 'n8n-nodes-base.code', typeVersion: 2, position: [4200, 80],
  notes: 'No provider payload is logged. Missing or ambiguous ACK stops without retry.',
}
const finishOutbound = {
  parameters: { method: 'POST', url: supabaseRpc('finish_whatsapp_event'), sendHeaders: false, sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify({p_integration_id:$('Resolver tenant').first().json.integration_id,p_event_id:'outbound:'+$('Validar identidad e idempotencia').first().json.eventId,p_status:'completed',p_result_reference:'provider_ack'}) }}", options: { timeout: 20000 }, authentication: 'genericCredentialType', genericAuthType: 'httpCustomAuth' },
  id: 'production-outbound-finish', name: 'Finalizar outbound', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [4420, 80],
}
workflow.nodes.push(outboundEnabled, claimOutbound, outboundClaimed, sendEvolution, validateAck, finishOutbound)

node('Finalizar evento').parameters.url = supabaseRpc('finish_whatsapp_event')
node('Logging seguro').parameters.jsCode = "return [{json:{stage:'completed',event_id:$('Validar identidad e idempotencia').first().json.eventId,tenant_id:$('Resolver tenant').first().json.tenant_id,integration_id:$('Resolver tenant').first().json.integration_id,mode:'production-controlled',mutationAllowed:false,outboundConfigured:$('Resolver tenant').first().json.outbound_enabled===true}}];"

const connections = workflow.connections
connections['Webhook Evolution - producción'] = connections['Webhook Evolution - plantilla']
delete connections['Webhook Evolution - plantilla']
connections['Horario válido'].main[0] = [next('Bloquear mutación de reserva')]
connections['Bloquear mutación de reserva'] = connections['Crear reserva centralizada']
delete connections['Crear reserva centralizada']
connections['Construir respuesta segura'].main[0] = [next('Registrar propuesta minimizada')]
delete connections['Responder por Evolution']
link('Registrar propuesta minimizada', [[next('Outbound habilitado para conexión')]])
link('Outbound habilitado para conexión', [[next('Reclamar outbound')], [next('Finalizar evento')]])
link('Reclamar outbound', [[next('Outbound nuevo')]])
link('Outbound nuevo', [[next('Enviar respuesta Evolution')], [next('Finalizar evento')]])
link('Enviar respuesta Evolution', [[next('Validar ACK Evolution')]])
link('Validar ACK Evolution', [[next('Finalizar outbound')]])
link('Finalizar outbound', [[next('Finalizar evento')]])

workflow.settings = {
  executionOrder: 'v1',
  saveDataSuccessExecution: 'none',
  saveDataErrorExecution: 'none',
  saveManualExecutions: false,
  executionTimeout: 120,
}
workflow.meta = {
  templateCredsSetupCompleted: false,
  australContract: 'production-controlled-v1',
  defaultState: 'inactive',
  bookingEnabled: false,
}

for (const candidate of workflow.nodes) {
  if (typeof candidate.notes === 'string') {
    if (candidate.notes.startsWith('Bind QA Supabase Custom Auth credential;')) {
      candidate.notes = 'Bind a dedicated production Supabase Custom Auth credential; restrict it to the production Supabase origin.'
    }
    candidate.notes = candidate.notes.replaceAll('QA only.', 'Production controlled workflow.')
  }
}

fs.writeFileSync(targetPath, `${JSON.stringify(workflow, null, 2)}\n`)
console.log(`Prepared inactive production workflow: ${path.relative(root, targetPath)}`)
