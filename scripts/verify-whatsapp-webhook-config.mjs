import assert from 'node:assert/strict'
import {
  buildPatchedConfig,
  buildEvolutionWebhookPayload,
  buildRollbackConfig,
  hasWebhookHeader,
  assertShadowConfiguration,
  sanitizeWebhookConfig,
} from './whatsapp-webhook-config.mjs'

const sentinel = 'offline-only-config-secret-not-real'
const original = {
  enabled: true,
  url: 'https://hooks.example.invalid/evolution',
  events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
  base64: true,
  webhookByEvents: false,
  headers: { 'X-Legacy-Header': 'private-value-never-printed' },
}

const sanitized = sanitizeWebhookConfig(original)
assert.deepEqual(sanitized.events, original.events)
assert.equal(sanitized.base64, true)
assert.equal(sanitized.webhook_by_events, false)
assert.deepEqual(sanitized.header_names, ['X-Legacy-Header'])
assert.equal(JSON.stringify(sanitized).includes('private-value'), false)

const patched = buildPatchedConfig(original, sentinel)
assert.equal(patched.url, original.url)
assert.deepEqual(patched.events, original.events)
assert.equal(patched.base64, original.base64)
assert.equal(patched.webhookByEvents, original.webhookByEvents)
assert.equal(patched.headers['X-Austral-Webhook-Secret'], sentinel)
assert.equal(patched.headers['X-Legacy-Header'], original.headers['X-Legacy-Header'])
assert.deepEqual(buildEvolutionWebhookPayload(patched), {
  webhook: {
    enabled: true,
    url: original.url,
    events: original.events,
    headers: patched.headers,
    byEvents: false,
    base64: true,
  },
})
assert.throws(() => buildPatchedConfig(original, ''), /required/)
assert.throws(() => buildPatchedConfig(original), /required/)

const backupAbsent = { instance: 'miwsp', header_name: 'X-Austral-Webhook-Secret', header_was_present: false }
const rolledBack = buildRollbackConfig(patched, backupAbsent)
assert.equal(rolledBack.headers?.['X-Austral-Webhook-Secret'], undefined)
assert.equal(rolledBack.headers?.['X-Legacy-Header'], original.headers['X-Legacy-Header'])

const backupPresent = { instance: 'miwsp', header_name: 'X-Austral-Webhook-Secret', header_was_present: true }
const preserved = buildRollbackConfig(patched, backupPresent)
assert.equal(preserved.headers['X-Austral-Webhook-Secret'], sentinel)
assert.equal(JSON.stringify(sanitized).includes(sentinel), false)

const lowerCaseExisting = buildPatchedConfig({ headers: { 'x-austral-webhook-secret': 'old-private-value' } }, sentinel)
assert.deepEqual(Object.keys(lowerCaseExisting.headers), ['x-austral-webhook-secret'])
assert.equal(lowerCaseExisting.headers['x-austral-webhook-secret'], sentinel)
assert.equal(hasWebhookHeader(lowerCaseExisting, 'X-Austral-Webhook-Secret'), true)
assert.equal(assertShadowConfiguration({ WHATSAPP_MODE: 'shadow', PILOT_MODE: 'shadow' }), true)
assert.throws(() => assertShadowConfiguration({ WHATSAPP_MODE: 'live', PILOT_MODE: 'shadow' }), /requires/)
assert.throws(() => assertShadowConfiguration({}), /requires/)

console.log(JSON.stringify({
  config_helpers: 'passed',
  fields_preserved: ['url', 'events', 'base64', 'webhookByEvents'],
  header_added: true,
  backup_output_sanitized: true,
  rollback_reversible: true,
  network_calls: 0,
}, null, 2))
