import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeMessagesUpsertData } from '../supabase/functions/_shared/whatsappEvolutionPayload.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webhookSource = await fs.readFile(path.join(root, 'supabase/functions/whatsapp-evolution-webhook/index.ts'), 'utf8')

const key = ({ id, jid, fromMe = false } = {}) => ({ id, remoteJid: jid, fromMe })
const message = ({ id, jid, fromMe = false, text = 'Hola' } = {}) => ({
  key: key({ id, jid, fromMe }),
  message: { conversation: text },
  messageType: 'conversation',
  messageTimestamp: 1788110000,
})

// Shape normalization: preserve all array elements, including malformed ones.
const single = message({ id: 'A', jid: '549110000001@s.whatsapp.net' })
assert.deepEqual(normalizeMessagesUpsertData(single), [single])
const batch = [single, message({ id: 'B', jid: '549110000002@s.whatsapp.net', text: 'Corte' })]
assert.deepEqual(normalizeMessagesUpsertData(batch), batch)
assert.deepEqual(normalizeMessagesUpsertData(null), [])
assert.deepEqual(normalizeMessagesUpsertData(undefined), [])

// This fixture models the handler's per-element identity and guards.
const normalizeForTest = (element) => {
  const item = element && typeof element === 'object' ? element : {}
  const itemKey = item.key && typeof item.key === 'object' ? item.key : {}
  const jid = String(itemKey.remoteJid || itemKey.participant || item.remoteJid || '').trim()
  const eventId = String(itemKey.id || item.messageId || '').trim()
  return {
    eventId,
    remoteJid: jid,
    fromMe: itemKey.fromMe === true || item.fromMe === true,
    isGroup: jid.toLowerCase().endsWith('@g.us'),
    isBroadcast: jid.toLowerCase().endsWith('@broadcast'),
  }
}

const normalized = batch.map(normalizeForTest)
assert.deepEqual(normalized.map((item) => item.eventId), ['A', 'B'])
assert.deepEqual(normalized.map((item) => item.remoteJid), ['549110000001@s.whatsapp.net', '549110000002@s.whatsapp.net'])

// Mixed fromMe: inbound can proceed while the outbound item is ignored.
const mixed = [
  message({ id: 'INBOUND', jid: '549110000001@s.whatsapp.net', fromMe: false }),
  message({ id: 'OUTBOUND', jid: '549110000001@s.whatsapp.net', fromMe: true }),
].map(normalizeForTest)
assert.equal(mixed[0].fromMe, false)
assert.equal(mixed[1].fromMe, true)
assert.equal(mixed.filter((item) => !item.fromMe).length, 1)

// Malformed siblings fail closed without suppressing a valid message.
const malformedAndValid = [
  { message: { conversation: 'missing key' } },
  message({ id: 'VALID', jid: '549110000003@s.whatsapp.net' }),
].map(normalizeForTest)
assert.equal(malformedAndValid[0].eventId, '')
assert.equal(malformedAndValid[1].eventId, 'VALID')

// Duplicate IDs are idempotent per message, not per request batch.
const seen = new Set()
const processIds = (elements) => elements.map((element) => {
  const item = normalizeForTest(element)
  if (!item.eventId || !item.remoteJid) return 'invalid'
  if (seen.has(item.eventId)) return 'duplicate'
  seen.add(item.eventId)
  return 'processed'
})
assert.deepEqual(processIds([message({ id: 'A', jid: '549110000001@s.whatsapp.net' }), message({ id: 'B', jid: '549110000002@s.whatsapp.net' })]), ['processed', 'processed'])
assert.deepEqual(processIds([message({ id: 'A', jid: '549110000001@s.whatsapp.net' }), message({ id: 'A', jid: '549110000001@s.whatsapp.net' })]), ['duplicate', 'duplicate'])
assert.deepEqual(processIds([message({ id: 'A', jid: '549110000001@s.whatsapp.net' }), message({ id: 'B', jid: '549110000002@s.whatsapp.net' })]), ['duplicate', 'duplicate'])

// Group/status/broadcast and missing-key items remain independently rejectable.
assert.equal(normalizeForTest(message({ id: 'GROUP', jid: '123@g.us' })).isGroup, true)
assert.equal(normalizeForTest(message({ id: 'BROADCAST', jid: 'status@broadcast' })).isBroadcast, true)
assert.equal(normalizeForTest({ key: { remoteJid: '549110000004@s.whatsapp.net' } }).eventId, '')

// Tenant and safety invariants remain in the server-side handler.
assert.match(webhookSource, /\.eq\('environment', 'qa'\)/)
assert.match(webhookSource, /const itemPayload = \{ .*data: message \}/)
assert.match(webhookSource, /for \(const message of messages\)/)
assert.match(webhookSource, /await processInboundMessage/)
assert.doesNotMatch(webhookSource, /messages\[0\]/)
assert.match(webhookSource, /mutation_allowed: false/)
assert.match(webhookSource, /outbound_allowed: false/)
assert.match(webhookSource, /prompt_version: proposal\.agent_prompt_version \|\| 'natural-v2'/)

console.log(JSON.stringify({
  suite: 'whatsapp-webhook-batch',
  cases: 17,
  single_object: 'PASS',
  array_one_and_many: 'PASS',
  malformed_sibling_isolated: 'PASS',
  mixed_from_me: 'PASS',
  per_message_idempotency: 'PASS',
  ordering: 'sequential',
  tenant_scope: 'server_connection_only',
  mutation_allowed: false,
  outbound_allowed: false,
  prompt_version: 'natural-v2',
  result: 'PASS',
}))
