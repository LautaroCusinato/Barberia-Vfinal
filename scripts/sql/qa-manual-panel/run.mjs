import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin'
const port = String(process.env.PG_QA_PANEL_PORT || 54783)
assert.match(port,/^\d{4,5}$/)
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'austral-qa-panel-'))
const data = path.join(temp,'data')
const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key)))
const env = {...inherited,PGHOST:'127.0.0.1',PGPORT:port,PGUSER:'postgres',PGDATABASE:'postgres',PGCLIENTENCODING:'UTF8'}
function run(tool,args,input,extra={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(path.join(bin,tool+'.exe'),args,{env:{...env,...extra},stdio:['pipe','pipe','pipe'],windowsHide:true})
    let stdout='',stderr=''
    child.stdout.on('data',s=>stdout+=s); child.stderr.on('data',s=>stderr+=s)
    child.on('error',reject);child.on('exit',code=>code?reject(new Error(`${tool} ${code}: ${stderr.slice(-1500)}`)):resolve(stdout.trim()))
    child.stdin.end(input)
  })
}
const sql=(query,extra)=>run('psql',['-X','-At','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],query,extra)
const file=relative=>fs.readFileSync(path.join(root,relative),'utf8')
let started=false
try {
  await run('initdb',['-D',data,'-U','postgres','-A','trust','-E','UTF8','--no-locale'])
  await run('pg_ctl',['-D',data,'-o',`-p ${port} -c listen_addresses=127.0.0.1`,'-l',path.join(temp,'pg.log'),'-w','start']);started=true
  await sql(file('scripts/sql/whatsapp-panel-send/stub.sql'))
  await sql(file('supabase/migrations/20261005120000_whatsapp_panel_send_atomic.sql'))
  // Esquema local para el guard del negocio, antes de crear la nueva RPC.
  await sql("alter table public.barberias add column slug text, add column metadata jsonb default '{}'::jsonb;")
  const migration=file('supabase/migrations/20261009120000_qa_manual_panel_recipient_lock.sql')
  await sql(migration);await sql(migration)
  const tests=file('scripts/sql/qa-manual-panel/tests.sql').replace("alter table public.barberias add column slug text, add column metadata jsonb default '{}'::jsonb;",'')
  console.log(await sql(tests))
  const client=await sql('select id from public.clientes where barberia_id=928;')
  // A cambia teléfono y conserva el lock. B vio el teléfono permitido antes
  // de A; el wrapper espera y rechaza el nuevo teléfono ya confirmado.
  const editing=sql(`begin;update public.clientes set telefono='5491155559999' where id=${client};select pg_sleep(1.4);commit;`,{PGAPPNAME:'qa928-phone-change'})
  const deadline=Date.now()+5000
  while(await sql("select exists(select 1 from pg_stat_activity where application_name='qa928-phone-change' and wait_event='PgSleep');")!=='t') {
    if(Date.now()>deadline)throw Error('Concurrent editor did not reach the verified wait')
    await pause(80)
  }
  const before=Date.now()
  const result=await sql(`set role service_role;select public.reservar_envio_panel_qa_manual(928,${client},'1214d733-1164-4487-b6f5-d89210c041f9','Cambio concurrente',array['5491155550107'])->>'status';`)
  await editing
  assert.equal(result.split('\n').at(-1),'qa_recipient_not_allowed')
  assert.ok(Date.now()-before>500,'The reservation must wait for the editor lock')
  assert.equal(await sql('select count(*) from public.mensajes where barberia_id=928;'),'0')
  assert.equal(await sql('select count(*) from public.config where barberia_id=928;'),'0','blocked target does not pause the bot')
  console.log('Two real sessions: phone change waits, rejects recipient, zero rows/pauses PASS')
  await sql(file('scripts/sql/qa-manual-panel/rollback.sql'))
  assert.equal(await sql("select to_regprocedure('public.reservar_envio_panel_qa_manual(bigint,bigint,uuid,text,text[],text,boolean,integer,integer,integer,integer)') is null;"),'t')
  assert.equal(await sql("select to_regprocedure('public.reservar_envio_panel(bigint,bigint,uuid,text,text,boolean,integer,integer,integer,integer)') is not null;"),'t')
  console.log('Rollback keeps the general task38 RPC PASS')
} finally {
  if(started)await run('pg_ctl',['-D',data,'-m','fast','-w','stop'])
  // Sólo el directorio nuevo creado por mkdtemp dentro del temp del sistema.
  const resolved=path.resolve(temp),allowed=path.resolve(os.tmpdir())+path.sep
  if(!resolved.startsWith(allowed)||!path.basename(resolved).startsWith('austral-qa-panel-')) {
    console.error('Cleanup path guard failed; local directory preserved')
    process.exitCode=1
  } else {
    fs.rmSync(resolved,{recursive:true,force:true})
  }
}
