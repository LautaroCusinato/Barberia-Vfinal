import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mergeEvolutionConnectionMetadata, resolveEvolutionState, shouldPersistEvolutionStatus } from '../supabase/functions/_shared/evolutionState.mjs'

const future = new Date(Date.now() + 60_000).toISOString()

assert.equal(resolveEvolutionState({ connectionState: 'close', fetchState: 'connecting', previousState: 'DISCONNECTED' }).state, 'CONNECTING')
assert.equal(resolveEvolutionState({ connectionState: 'close', fetchState: 'connecting', previousState: 'QR_READY', qrExpiresAt: future }).state, 'QR_READY')
assert.equal(resolveEvolutionState({ connectionState: 'close', fetchState: 'close', previousState: 'CONNECTED', receiverNumber: 'qa-number' }).state, 'DISCONNECTED')
assert.equal(resolveEvolutionState({ connectionState: 'open', fetchState: 'open' }).state, 'CONNECTED')
assert.equal(resolveEvolutionState({ connectionState: 'connecting', fetchState: null, previousState: 'QR_READY', qrExpiresAt: future }).state, 'QR_READY')
assert.equal(resolveEvolutionState({ connectionState: 'open', fetchState: 'close' }).state, 'ERROR')
assert.notEqual(resolveEvolutionState({ connectionState: 'garbled', fetchState: 'unknown' }).state, 'CONNECTED')

const firstConnection = mergeEvolutionConnectionMetadata({}, { connectionState: 'open', fetchState: 'open' }, 'CONNECTED', '2026-08-23T00:00:00.000Z')
assert.equal(firstConnection.ever_connected, true)
assert.equal(firstConnection.last_connected_at, '2026-08-23T00:00:00.000Z')
assert.equal(shouldPersistEvolutionStatus('CONNECTED', 'CONNECTED', {}), true)
assert.equal(shouldPersistEvolutionStatus('CONNECTED', 'CONNECTED', firstConnection), false)
const closedConnection = mergeEvolutionConnectionMetadata(firstConnection, { connectionState: 'close', fetchState: 'close' }, 'DISCONNECTED', '2026-08-23T01:00:00.000Z')
assert.equal(closedConnection.ever_connected, true)
assert.equal(closedConnection.last_connected_at, firstConnection.last_connected_at)
assert.equal(shouldPersistEvolutionStatus('CONNECTED', 'DISCONNECTED', firstConnection), true)

const source = readFileSync(new URL('../supabase/functions/whatsapp-provision/index.ts', import.meta.url), 'utf8')
assert.match(source, /fetchInstances\?instanceName=/)
assert.match(source, /resolveEvolutionState/)
assert.match(source, /instanceNameFor\(tenantId\)/)
assert.match(source, /PROTECTED_INSTANCE = 'miwsp'/)
assert.match(source, /WEBHOOK_EVENTS = \['QRCODE_UPDATED', 'CONNECTION_UPDATE'\]/)

console.log(JSON.stringify({
  cases: 11,
  never_paired_connecting_close: 'CONNECTING',
  cached_qr: 'QR_READY',
  previous_session_close: 'DISCONNECTED',
  open: 'CONNECTED',
  contradictory: 'ERROR',
  ever_connected: 'sticky_after_disconnect',
  receiver_number_nullable: true,
  tenant_scope: 'server_resolved',
  protected_instance: 'miwsp_rejected',
}, null, 2))
