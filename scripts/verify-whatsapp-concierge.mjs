import assert from 'node:assert/strict'
import fs from 'node:fs'
import {createMemoryDb, harnessEnv, loadEdgeFunction} from './lib/edgeFunctionHarness.mjs'
import {qaManualMessageRpc} from './lib/qaManualMessageHarness.mjs'
import {CONCIERGE_ROUTE, conciergeGoal, redactLanguageInput, validateLanguageResult} from '../supabase/functions/_shared/whatsappConcierge.mjs'

const phone='5491155559999'
const services=[{id:71,barberia_id:928,nombre:'Corte clásico',precio:15000,duracion_min:30,activo:true},{id:72,barberia_id:928,nombre:'Barba',precio:10000,duracion_min:30,activo:true},{id:73,barberia_id:928,nombre:'Corte + barba',precio:22000,duracion_min:60,activo:true}]
const barbers=[{id:65,barberia_id:928,nombre:'Mateo',activo:true},{id:66,barberia_id:928,nombre:'Lucas',activo:true}]
const env={SUPABASE_URL:'https://cmsymmszlzikqpvfqjre.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'harness',WHATSAPP_PROVISIONING_ENV:'qa',WHATSAPP_MODE:'shadow',PILOT_MODE:'shadow',WHATSAPP_PROVISIONING_ADAPTER:'evolution',WHATSAPP_QA_MANUAL_TENANT_IDS:'928',WHATSAPP_QA_MANUAL_CONCIERGE_ENABLED:'1',EVOLUTION_WEBHOOK_SECRET:'harness-secret',EVOLUTION_BASE_URL:'https://evolution.cuchitron.lat',EVOLUTION_API_KEY:'harness',WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED:'0',WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED:'0'}
for(const [key,value]of Object.entries(env))harnessEnv.set(key,value)
const fixture=(known=true)=>({saas_whatsapp_connections:[{id:6,barberia_id:928,integration_id:48,provider:'evolution',environment:'qa',state:'CONNECTED',instance_name:'austral-qa-tenant-928',automation_enabled:true,outbound_enabled:true,booking_enabled:true}],saas_integraciones:[{id:48,barberia_id:928,proveedor:'evolution',integration_type:'whatsapp',estado:'conectado'}],barberias:[{id:928,nombre:'Barbería QA',slug:'austral-prueba-lautaro',moneda:'ARS',reservas_publicas:true,zona_horaria:'America/Argentina/Buenos_Aires'}],servicios:services,barberos:barbers,horarios_barbero:[],bloqueos_agenda:[],clientes:known?[{id:1,barberia_id:928,nombre:'Lautaro QA',telefono:phone,whatsapp_nombre_pendiente:false}]:[]})
const rpc={...qaManualMessageRpc,horarios_disponibles_reserva_publica:()=>[65,66].flatMap(id=>['09:00:00','10:00:00','16:00:00'].map(hora=>({barbero_id:id,barbero_nombre:id===65?'Mateo':'Lucas',hora,duracion_min:30}))),crear_reserva_whatsapp:(args,db)=>{
 const done=db.tables.saas_automation_events.find(r=>r.event_id===args.p_event_id&&r.status==='completed')
 if(done)return[{turno_id:Number(done.result_reference),fecha:args.p_fecha,hora:args.p_hora,duracion_min:30}]
 const cliente=db.tables.clientes.find(c=>c.barberia_id===928&&c.telefono===args.p_telefono)
 const service=db.tables.servicios.find(s=>s.id===args.p_servicio_id)
 const row={id:800+db.tables.turnos.length,barberia_id:928,cliente_id:cliente.id,barbero_id:args.p_barbero_id,servicio_id:service.id,motivo:service.nombre,paciente:args.p_nombre,telefono:args.p_telefono,precio:service.precio,fecha:args.p_fecha,hora:args.p_hora,estado:'confirmado',origen:'whatsapp'}
 db.tables.turnos.push(row);db.tables.saas_automation_events.push({integration_id:48,event_id:args.p_event_id,status:'completed',result_reference:String(row.id)})
 return[{turno_id:row.id,fecha:row.fecha,hora:row.hora,duracion_min:30}]
}}
const sent=[],routes=[],language=[]
let modelResult={goal:'unclear',confidence:0}, failModel=false
const originalFetch=globalThis.fetch
globalThis.fetch=async(url,options)=>{
 if(String(url)===CONCIERGE_ROUTE){language.push(JSON.parse(options.body));if(failModel)throw Error('timeout');return new Response(JSON.stringify(modelResult))}
 if(String(url).includes('/webhook/austral-qa-manual-928')){routes.push(JSON.parse(options.body));return new Response('{}')}
 if(String(url).includes('/message/sendText/')){sent.push(JSON.parse(options.body));return new Response(JSON.stringify({key:{id:'PROVIDER'+sent.length},status:'PENDING'}),{status:201})}
 throw Error('Unexpected external URL in offline test')
}
const webhook=await loadEdgeFunction('whatsapp-evolution-webhook'),book=await loadEdgeFunction('whatsapp-booking-mutation'),outbound=await loadEdgeFunction('whatsapp-agent-outbound-pilot')
const operator={authorization:'Bearer harness-only'}
let counter=0
async function say(message,id='concierge'+(++counter),expectedStatus=200){
 const response=await webhook({event:'messages.upsert',instance:'austral-qa-tenant-928',data:{key:{id,remoteJid:phone+'@s.whatsapp.net',fromMe:false},message:{conversation:message},messageType:'conversation',messageTimestamp:Math.floor(Date.now()/1000)}},{'X-Austral-Webhook-Secret':'harness-secret'})
 assert.equal(response.status,expectedStatus,JSON.stringify(response.body))
 return {...response,id}
}
async function runRoute(){
 const event=routes.at(-1)
 if(!event.ready_for_booking_mutation)return outbound({event_id:event.event_id},operator)
 const result=await book({event_id:event.event_id},operator)
 if(result.body.booking_follow_up===true)return outbound({event_id:event.event_id},operator)
 assert.equal(result.body.booking_created,true,JSON.stringify(result.body))
 return outbound({event_id:event.event_id,kind:'booking_confirmation'},operator)
}
let db=createMemoryDb(fixture(),{rpc})
await say('Hola');assert.match(db.tables.saas_automation_shadow_runs.at(-1).metadata.proposed_reply,/Lautaro/)
let result=await say('Por acá');assert.match(result.body.proposed_reply,/A nombre|a nombre/)
result=await say('soy yo');assert.match(result.body.proposed_reply,/1\. Barba/)
assert.equal(db.tables.saas_automation_shadow_runs.at(-1).metadata.conversation_state.customer_name,'Lautaro QA')
await say('1');result=await say('mañana');assert.match(result.body.proposed_reply,/09:00.*\n.*10:00/s)
await say('2');result=await say('1');assert.match(result.body.proposed_reply,/Lautaro QA/);assert.match(result.body.proposed_reply,/10\.000/);assert.match(result.body.proposed_reply,/Lucas/)
assert.equal(db.tables.turnos.length,0)
await say('¿Cuánto sale?');assert.equal(db.tables.turnos.length,0)
result=await say('Sí');assert.match(result.body.proposed_reply,/Antes de agendar/);assert.equal(db.tables.turnos.length,0)
result=await say('Sí');assert.equal((await runRoute()).body.sent,true)
assert.equal(db.tables.turnos.length,1);assert.equal(db.tables.turnos[0].paciente,'Lautaro QA');assert.equal(db.tables.turnos[0].barbero_id,66)
assert.match(sent.at(-1).text,/Lautaro QA/);assert.match(sent.at(-1).text,/Lucas/);assert.match(sent.at(-1).text,/10\.000/)
const beforeReplay=sent.length;await say('Sí',result.id,202);assert.equal((await runRoute()).body.duplicate,true);assert.equal(sent.length,beforeReplay)
result=await say('Cómo me llamo?');assert.match(result.body.proposed_reply,/Lautaro QA/)
result=await say('Decime vos');assert.match(result.body.proposed_reply,/Lautaro QA/)
result=await say('Hola');assert.match(result.body.proposed_reply,/reserva sigue agendada/)
result=await say('Mi turno');assert.match(result.body.proposed_reply,/Barba/);assert.match(result.body.proposed_reply,/10:00/)

// Nombre nuevo, sin duplicar ficha; nombre de una reserva no cambia un contacto existente.
db=createMemoryDb(fixture(false),{rpc});await say('Hola');await say('Por acá');result=await say('Lucía Pérez')
assert.match(result.body.proposed_reply,/Lucía/);assert.equal(db.tables.clientes.length,1);assert.equal(db.tables.clientes[0].nombre,'Lucía Pérez')
db=createMemoryDb(fixture(false),{rpc});result=await say('Cómo me llamo?');assert.match(result.body.proposed_reply,/Todavía no tengo tu nombre/)
result=await say('Lucía Pérez');assert.match(result.body.proposed_reply,/Lucía Pérez/);assert.equal(db.tables.clientes[0].nombre,'Lucía Pérez');assert.equal(db.tables.turnos.length,0)
db=createMemoryDb(fixture(false),{rpc});await say('Hola');await say('Por acá');await say('Mateo');assert.equal(db.tables.saas_automation_shadow_runs.at(-1).metadata.conversation_state.barber_id,null)
db=createMemoryDb(fixture(false),{rpc});await say('Hola');await say('Por acá');await say('Me llamo Barba');assert.equal(db.tables.clientes[0].nombre,'Barba');assert.equal(db.tables.saas_automation_shadow_runs.at(-1).metadata.conversation_state.service_id,null)
db=createMemoryDb(fixture(),{rpc});await say('Hola');await say('Por acá');await say('Juan Pérez');await say('Barba');await say('mañana');await say('09:00');await say('Cualquiera');await say('Sí');await runRoute()
assert.equal(db.tables.clientes[0].nombre,'Lautaro QA');assert.equal(db.tables.turnos[0].paciente,'Juan Pérez')

// Un cambio de precio no reserva con condiciones distintas de las confirmadas.
db=createMemoryDb(fixture(),{rpc});await say('Hola');await say('Por acá');await say('soy yo');await say('Barba');await say('mañana');await say('09:00');await say('Cualquiera')
db.tables.servicios.find(s=>s.id===72).precio=12500
await say('Sí');assert.equal((await runRoute()).body.sent,true);assert.equal(db.tables.turnos.length,0)
assert.match(sent.at(-1).text,/12\.500/);assert.match(sent.at(-1).text,/cambiaron/)
await say('Sí');await runRoute();assert.equal(db.tables.turnos.length,1);assert.equal(db.tables.turnos[0].precio,12500)

// El modelo entiende el texto, pero jamás elige una mutación, nombre o destinatario.
db=createMemoryDb(fixture(),{rpc});modelResult={goal:'booking',confidence:.95,service_id:71,barber_id:999,phone:'foreign',name:'Inventado',confirmation_state:'confirmed',reply:'Turno reservado'}
result=await say('me podés emparejar el pelo?');assert.match(result.body.proposed_reply,/nombre/)
assert.equal(db.tables.turnos.length,0);assert.equal(db.tables.saas_automation_shadow_runs.at(-1).metadata.conversation_state.barber_id,null)
assert.ok(language.length>0);assert.ok(!JSON.stringify(language.at(-1)).includes('Lautaro QA'));assert.ok(!JSON.stringify(language.at(-1)).includes(phone))
db=createMemoryDb(fixture(),{rpc});failModel=true;result=await say('xyzzy frobnicate');assert.match(result.body.proposed_reply,/Reservar un turno|reservar en la web/)
assert.equal(db.tables.turnos.length,0)
assert.equal(conciergeGoal('decime vos',{last_information_topic:'identity'}),'identity')
assert.ok(!redactLanguageInput('Mi mail es a@b.com y mi teléfono +54 9 11 5555 9999').includes('a@b.com'))
const unsafe=validateLanguageResult({goal:'booking',confidence:.99,service_id:999,time:'99:90',date:'2020-01-01',ready_for_booking_mutation:true},{services,barbers,today:'2026-10-09'})
assert.deepEqual(unsafe.fields,{pending_intent:'booking_intent'})
const flow=JSON.parse(fs.readFileSync(new URL('../integrations/templates/Austral WhatsApp QA - Lenguaje 928.json',import.meta.url),'utf8'))
assert.equal(flow.active,false);assert.equal(flow.settings.saveDataSuccessExecution,'none');assert.equal(flow.nodes[0].parameters.authentication,'headerAuth')
assert.ok(!flow.nodes.some(n=>String(n.parameters.url||'').includes('sendText')))
globalThis.fetch=originalFetch
console.log('Concierge QA928: identidad, nombre confirmado, menús, horarios, resumen, reserva, replay, ficha única, datos reales y modelo sin autoridad PASS (offline)')
