import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as pause } from 'node:timers/promises'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const bin = process.env.PG_BIN || 'C:/Program Files/PostgreSQL/18/bin'
const port = '54784'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'austral-qa-web-'))
const data = path.join(temp, 'data')
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG/i.test(key))), PGCLIENTENCODING: 'UTF8' }
function run(tool, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(bin, `${tool}.exe`), args, { env, stdio: ['pipe','pipe','pipe'], windowsHide: true })
    let stdout = '', stderr = ''
    child.stdout.on('data', text => { stdout += text }); child.stderr.on('data', text => { stderr += text })
    child.on('error', reject)
    child.on('exit', code => code ? reject(new Error(`${tool} ${code}: ${stderr.slice(-1600)}`)) : resolve(stdout.trim()))
    child.stdin.end(input)
  })
}
const sql = text => run('psql', ['-X','-At','-h','127.0.0.1','-p',port,'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], text)
const file = relative => fs.readFileSync(path.join(root, relative), 'utf8')
let started = false
try {
  await run('initdb', ['-D',data,'-U','postgres','-A','trust','-E','UTF8','--no-locale'])
  await run('pg_ctl', ['-D',data,'-o',`-p ${port} -c listen_addresses=127.0.0.1`,'-l',path.join(temp,'pg.log'),'-w','start'])
  started = true
  await sql(file('scripts/sql/whatsapp-cliente-unico/stub.sql'))
  await sql(file('scripts/sql/qa928-web-customer/fixture.sql'))
  await sql(file('supabase/migrations/20261002092000_public_booking_hardening.sql'))
  await sql(file('supabase/migrations/20261009121000_qa928_whatsapp_messages.sql'))
  const book = (phone, name, day = 1, hour = '10:00') => `set role anon;select * from public.crear_reserva_publica('austral-prueba-lautaro',71,65,current_date+${day},'${hour}','${name}','${phone}',null);`
  await sql("set role service_role;select public.registrar_mensaje_whatsapp_qa928(48,'web:baseline','paciente','5491155550107','Hola',now(),'baseline');")
  await sql(book('5491155550107','Nombre real'))
  assert.equal(await sql("select nombre from public.clientes where barberia_id=928 and telefono='5491155550107';"), 'Contacto WhatsApp · …0107')
  console.log('BASELINE: la RPC web real deja el nombre provisional, reproducido')
  const migration = file('supabase/migrations/20261009140000_qa928_promote_web_customer.sql')
  await sql(migration); await sql(migration)
  console.log(await sql(file('scripts/sql/qa928-web-customer/tests.sql')))
  // Dos sesiones reales: el equipo edita el nombre mientras la reserva espera.
  await sql("set role service_role;select public.registrar_mensaje_whatsapp_qa928(48,'web:race','paciente','5491155550407','Hola',now(),'race');")
  const editing = sql("begin;set application_name='qa928-name-race';update public.clientes set nombre='Equipo concurrente' where barberia_id=928 and telefono='5491155550407';select pg_sleep(1.5);commit;")
  const deadline = Date.now() + 5000
  while (await sql("select exists(select 1 from pg_stat_activity where application_name='qa928-name-race' and wait_event='PgSleep');") !== 't') {
    if (Date.now() > deadline) throw Error('El editor no alcanzó la espera verificada')
    await pause(60)
  }
  await sql(book('5491155550407','Nombre del formulario',5,'14:00')); await editing
  assert.equal(await sql("select nombre from public.clientes where barberia_id=928 and telefono='5491155550407';"), 'Equipo concurrente')
  console.log('CONCURRENCIA: reserva web espera y conserva la edición del equipo PASS')
  const counts = await sql('select (select count(*) from public.clientes)::text||\'/\'||(select count(*) from public.turnos)::text;')
  await sql(file('scripts/sql/qa928-web-customer/rollback.sql'))
  assert.equal(await sql('select (select count(*) from public.clientes)::text||\'/\'||(select count(*) from public.turnos)::text;'), counts)
  assert.equal(await sql("select to_regprocedure('public.promover_nombre_web_qa928()') is null;"), 't')
  await sql(migration)
  console.log('QA928 WEB SQL LOCAL PASS: RPC real, scope, concurrencia, rollback sin borrar datos y reaplicación')
} finally {
  if (started) await run('pg_ctl', ['-D',data,'-m','fast','-w','stop'])
  const resolved = path.resolve(temp), parent = path.resolve(os.tmpdir())
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('austral-qa-web-')) {
    console.error('Ruta de limpieza inesperada; directorio conservado'); process.exitCode = 1
  } else fs.rmSync(resolved, { recursive: true, force: true })
}
