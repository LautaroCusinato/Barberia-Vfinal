import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const workflow=JSON.parse(fs.readFileSync(new URL('../integrations/templates/Austral WhatsApp QA - Shadow No Outbound.json',import.meta.url),'utf8'))
const node=name=>workflow.nodes.find(n=>n.name===name)
const run=(name,input={},values={})=>new vm.Script(`(function(){${node(name).parameters.jsCode}\n})()`).runInNewContext({
  $json:input,$input:{first:()=>({json:input})},$:n=>{
    if(!Object.hasOwn(values,n)) throw new Error('unexecuted_node:'+n)
    return {first:()=>({json:values[n][0]}),all:()=>values[n].map(json=>({json}))}
  },Date,JSON},{timeout:1000})[0].json
let cases=0
const check=fn=>{fn();cases++}
const source={body:{event:'messages.upsert',instance:'e2e-disposable',data:{key:{id:'E2E_QA_EVENT',fromMe:false,remoteJid:'5491100000099@s.whatsapp.net'},message:{conversation:'¿Qué servicios tienen?'}}}}
const identity=run('Validar identidad e idempotencia',source)
check(()=>assert.equal(identity.invalid,false))
check(()=>assert.equal(identity.texto,'¿Qué servicios tienen?'))
check(()=>assert.equal(Object.hasOwn(identity,'body'),false))
for(const fromMe of [true,'false',null,undefined,0]) {
 const payload=structuredClone(source);payload.body.data.key.fromMe=fromMe
 check(()=>assert.equal(run('Validar identidad e idempotencia',payload).invalid,true))
}
for(const patch of [{event:'connection.update'},{instance:''},{data:[]},{data:{key:{id:'x',fromMe:false,remoteJid:'status@broadcast'}}}]) check(()=>assert.equal(run('Validar identidad e idempotencia',{body:{...source.body,...patch}}).invalid,true))
const values={
 'Resolver tenant':[{tenant_id:819,integration_id:36,slug:'qa-fixture',business_name:'E2E_QA_819',timezone:'America/Argentina/Buenos_Aires',currency:'ARS'}],
 'Validar identidad e idempotencia':[identity],
 'Cargar servicios bajo demanda':[{id:43,nombre:'Corte clásico',precio:30000,duracion_min:30}],
 'Cargar empleados bajo demanda':[{id:42,nombre:'E2E_QA_BARBER'}],
 'Cargar horarios y pausas':[{}], 'Cargar bloqueos':[{}],
}
const prompt=run('Armar prompt modular',{},values)
check(()=>assert.equal(prompt.user_message,identity.texto))
check(()=>assert.equal(prompt.system_prompt.includes(identity.senderNumber),false))
const ai=(args,intent='availability')=>({choices:[{message:{content:JSON.stringify({intent,args,reply:'Voy a revisar las opciones.'})}}]})
for(const args of [{tenant_id:2},{service_id:999},{barber_id:999},{fecha:'2030-02-30'},{hora:'25:00'},{tool:'billing'},{service_id:{tenant_id:2}}]) check(()=>assert.throws(()=>run('Validar respuesta IA',ai(args),values)))
const decision=run('Validar respuesta IA',ai({service_id:43,barber_id:42,fecha:'2030-01-07',hora:'16:00'}),values)
check(()=>assert.equal(decision.ai_valid,true))
check(()=>assert.equal(decision.mutationAllowed,false))
values['Validar respuesta IA']=[decision]
values['Consultar disponibilidad']=[{barbero_id:42,hora:'15:30:00',duracion_min:30}]
const response=run('Construir respuesta segura',{},values)
check(()=>assert.match(response.text,/16:00 no están disponibles/))
check(()=>assert.match(response.text,/15:30/))
values['Validar respuesta IA']=[{intent:'chat',args:{},reply:'¡Hola!'}]
delete values['Consultar disponibilidad']
check(()=>assert.equal(run('Construir respuesta segura',{},values).text,'¡Hola!'))
check(()=>assert.equal(run('Crear reserva centralizada').booking_created,false))
check(()=>assert.equal(workflow.active,false))
check(()=>assert.equal(node('Webhook Evolution - plantilla').parameters.authentication,'headerAuth'))
check(()=>assert.equal(workflow.settings.saveDataErrorExecution,'none'))
for(const n of workflow.nodes.filter(n=>n.type==='n8n-nodes-base.httpRequest')) {
 check(()=>assert.equal(n.parameters.authentication,'genericCredentialType'))
 check(()=>assert.equal(n.retryOnFail,false))
 check(()=>assert.equal(n.onError,'stopWorkflow'))
 check(()=>assert.equal(n.executeOnce,true))
 if(n.name.startsWith('Cargar ')) check(()=>assert.match(n.parameters.url,/barberia_id=eq\.['"]?\s*\+\s*\$\('Resolver tenant'\)/))
}
const serialized=JSON.stringify(workflow)
check(()=>assert.doesNotMatch(serialized,/\$env\b|sendText|crear_reserva_whatsapp|EVOLUTION_API_KEY/))
for(const [name,connection] of Object.entries(workflow.connections)) {
 check(()=>assert.ok(node(name)))
 for(const branch of connection.main??[])for(const edge of branch)check(()=>assert.ok(node(edge.node)))
}
console.log(JSON.stringify({suite:'qa-exported-n8n-node-execution',cases,network_calls:0,workflow_executions:0,credential_binding_required:true,result:'PASS'}))
