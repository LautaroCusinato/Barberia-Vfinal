import assert from 'node:assert/strict'
import test from 'node:test'
import { qaProvisionCorsOrigin, publicQaCapabilities } from '../../supabase/functions/_shared/qaProvisionUi.mjs'
import { disconnectQaSession } from '../../supabase/functions/_shared/qaDisconnect.mjs'

const emptyPending={name:'austral-qa-tenant-928',ownerJid:null,number:null,_count:{Message:0,Chat:0,Contact:0}}
const pendingSignals=async()=>({connectionState:'connecting',fetchState:'connecting'})
test('cancela sólo QR nuevo y vacío de QA928 y confirma que desapareció', async()=>{
  let deleted=false
  await disconnectQaSession({instanceName:emptyPending.name,signals:pendingSignals,request:async path=>{
    if(path.includes('/logout/'))throw Error('no session')
    if(path.includes('/delete/')){deleted=true;return {status:'SUCCESS'}}
    return deleted?[]:[emptyPending]
  }})
  assert.equal(deleted,true)
})
test('no borra propietario, historial, otro tenant ni señales abiertas o desconocidas', async()=>{
  for(const patch of [{ownerJid:'existing@s.whatsapp.net'},{number:'5491155550107'},{_count:{Message:1,Chat:0,Contact:0}},{_count:{Message:0,Chat:0,Contact:1}},{_count:null},{name:'austral-qa-tenant-927'},{signals:{connectionState:'open',fetchState:'connecting'}}]){
    let deleted=false
    const row={...emptyPending,...patch}
    await assert.rejects(disconnectQaSession({instanceName:row.name,signals:async()=>patch.signals||await pendingSignals(),request:async path=>{
      if(path.includes('/logout/'))throw Error('logout failed')
      if(path.includes('/delete/'))deleted=true
      return [row]
    }}))
    assert.equal(deleted,false)
  }
})
test('un error de logout sólo se acepta con cierre o ausencia confirmados', async()=>{
  let deleted=false
  await disconnectQaSession({instanceName:emptyPending.name,signals:async()=>({connectionState:'close',fetchState:'close'}),request:async path=>{
    if(path.includes('/logout/'))throw Error('cleanup failed')
    if(path.includes('/delete/'))deleted=true
    return [{...emptyPending,ownerJid:'existing@s.whatsapp.net'}]
  }})
  assert.equal(deleted,false)
  await disconnectQaSession({instanceName:emptyPending.name,signals:async()=>{throw Error('not needed')},request:async path=>{
    if(path.includes('/logout/'))throw Error('already absent')
    return []
  }})
})
test('no afirma desconexión si logout o eliminación no dejaron cerrado el canal', async()=>{
  await assert.rejects(disconnectQaSession({instanceName:emptyPending.name,signals:async()=>({connectionState:'open',fetchState:'open'}),request:async()=>({status:'SUCCESS'})}),error=>error.code==='evolution_disconnect_not_confirmed')
  await assert.rejects(disconnectQaSession({instanceName:emptyPending.name,signals:pendingSignals,request:async path=>{
    if(path.includes('/logout/'))throw Error('no session')
    return path.includes('/delete/')?{status:'SUCCESS'}:[emptyPending]
  }}),error=>error.code==='evolution_disconnect_not_confirmed')
})

const qa = { appBaseUrl: 'https://barberia-qa.cuchitron.lat', projectRef: 'cmsymmszlzikqpvfqjre', environment: 'qa' }

test('keeps QA web and existing 4173 preview; enables only the two explicit local 5196 origins', () => {
  for (const origin of [qa.appBaseUrl, 'http://127.0.0.1:4173', 'http://localhost:4173', 'http://127.0.0.1:5196', 'http://localhost:5196']) {
    assert.equal(qaProvisionCorsOrigin(origin, qa), origin)
  }
})
test('does not trust host suffixes, other ports, HTTPS local, paths, null or missing origins', () => {
  for (const origin of ['', 'null', null, 'http://127.0.0.1:5197', 'http://localhost:5196.attacker.invalid', 'http://localhost.attacker.invalid:5196', 'https://localhost:5196', 'http://localhost:5196/path', 'https://attacker.invalid']) {
    assert.equal(qaProvisionCorsOrigin(origin, qa), null)
  }
})
test('local access requires both the QA project and QA environment', () => {
  for (const config of [{ ...qa, projectRef: 'ssagttjdgtypxjcgdnrw' }, { ...qa, environment: 'production' }, { ...qa, environment: '' }]) {
    assert.equal(qaProvisionCorsOrigin('http://127.0.0.1:5196', config), null)
  }
})
test('capabilities stay false until connected, even when authorized in storage', () => {
  const row = { automation_enabled: true, outbound_enabled: true, booking_enabled: true, handoff_enabled: true }
  for (const state of ['NOT_CONFIGURED', 'QR_READY', 'CONNECTING', 'DISCONNECTED', 'ERROR', null]) {
    assert.ok(Object.values(publicQaCapabilities(row, state)).every(value => value === false))
  }
})
test('a connected number does not imply that outbound or bookings are enabled', () => {
  assert.deepEqual(publicQaCapabilities({ automation_enabled: true, outbound_enabled: false, booking_enabled: 'true' }, 'CONNECTED'), {
    automation_enabled: true, outbound_enabled: false, booking_enabled: false, handoff_enabled: false,
  })
  assert.ok(Object.values(publicQaCapabilities(null, 'CONNECTED')).every(value => value === false))
})
