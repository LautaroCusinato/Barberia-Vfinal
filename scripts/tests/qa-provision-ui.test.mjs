import assert from 'node:assert/strict'
import test from 'node:test'
import { qaProvisionCorsOrigin, publicQaCapabilities } from '../../supabase/functions/_shared/qaProvisionUi.mjs'

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
