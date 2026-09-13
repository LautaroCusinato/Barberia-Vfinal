// Opt-in controlled QA bridge. Never enables general outbound or changes sessions.
// Run inside n8n; at most one question and one exact validated answer per run.
const assert = require('node:assert/strict')
const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const cases = { services: '¿Qué servicios tienen?', price: '¿Cuánto sale el Corte clásico?', availability: '¿Hay disponibilidad?' }
const kind = process.argv.find(a => a.startsWith('--case='))?.slice(7) || 'services'
let checkpoint = 'preflight'
if (!process.argv.includes('--execute')) {
  console.log(JSON.stringify({ plan: true, case: kind, max_sends: 2, receiver: 'austral-qa-tenant-819', sender: 'austral-qa-tenant-1', temporary_route: true, general_outbound: false }))
  process.exit(0)
}
async function main() {
  assert.ok(cases[kind], 'unknown_case')
  assert.equal(new URL(process.env.SUPABASE_URL).hostname, 'cmsymmszlzikqpvfqjre.supabase.co')
  const base = process.env.EVOLUTION_BASE_URL.replace(/\/$/, '')
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET
  assert.ok(secret)
  const source = 'austral-qa-tenant-1', target = 'austral-qa-tenant-819'
  async function api(path, body) {
    const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { apikey: process.env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) })
    assert.ok(r.ok, 'evolution_http_' + r.status)
    return r.json()
  }
  const inventory = await api('/instance/fetchInstances')
  const a = inventory.find(i => i.name === source), b = inventory.find(i => i.name === target)
  assert.equal(a?.connectionStatus, 'open'); assert.equal(b?.connectionStatus, 'open')
  for (const i of [a, b]) assert.match(i.ownerJid, /^\d+@s\.whatsapp\.net$/)
  assert.notEqual(a.ownerJid, b.ownerJid)
  const unpack = w => w.webhook || w
  const original = unpack(await api('/webhook/find/' + target))
  const sourceBefore = unpack(await api('/webhook/find/' + source))
  const dto = w => ({ enabled: w.enabled === true, url: w.url, events: w.events, headers: w.headers || {}, byEvents: w.webhookByEvents ?? w.webhook_by_events ?? false, base64: w.webhookBase64 ?? w.base64 ?? false })
  const before = dto(original)
  assert.equal(before.url, 'https://cmsymmszlzikqpvfqjre.supabase.co/functions/v1/whatsapp-evolution-webhook')
  assert.equal(before.enabled, true); assert.equal(before.byEvents, false)
  assert.ok(Object.entries(before.headers).some(([k, v]) => k.toLowerCase() === 'x-austral-webhook-secret' && v === secret), 'webhook_secret_mismatch')
  const dir = fs.mkdtempSync('/dev/shm/austral-qa-e2e-'); fs.chmodSync(dir, 0o700)
  const backup = dir + '/restore.json'; fs.writeFileSync(backup, JSON.stringify({ instance: target, webhook: before }), { mode: 0o600 })
  const path = '/qa-e2e-' + crypto.randomBytes(16).toString('hex')
  let changed = false, restored = false, accepted = false, sends = 0, replyId, sourceId, failure, completed = false, closing = false
  const outgoing = new Set()
  let processing = Promise.resolve()
  const pending = new Set()
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
  async function n8n(payload) {
    const r = await fetch('http://127.0.0.1:5678/webhook/austral-qa-shadow-inbound', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Austral-Webhook-Secret': secret }, body: JSON.stringify(payload), signal: AbortSignal.timeout(125000) })
    assert.equal(r.status, 200, 'n8n_http_' + r.status)
    const data = await r.json(); return Array.isArray(data) ? data[0] : data
  }
  async function forward(raw) {
    const r = await fetch(before.url, { method: 'POST', headers: { ...before.headers, 'Content-Type': 'application/json' }, body: raw, signal: AbortSignal.timeout(30000) })
    assert.ok(r.ok, 'shadow_forward_failed')
  }
  async function processInbound(body) {
    // Wait for the provider ACK; never choose an arbitrary inbound with matching text.
    for (let i = 0; !sourceId && i < 100; i++) await pause(100)
    assert.equal(body.data.key.id, sourceId, 'unexpected_event')
    const result = await n8n(body)
    checkpoint = 'validate_n8n_response'
    console.log(JSON.stringify({ n8n_stage: result.stage ?? null, tenant: result.tenant_id ?? null, event_matches: result.event_id === sourceId, mutation_disabled: result.mutationAllowed === false, outbound_disabled: result.outboundAllowed === false }))
    assert.equal(result.stage, 'completed', 'stage_not_completed'); assert.equal(result.tenant_id, 819, 'tenant_mismatch')
    assert.equal(result.event_id, sourceId, 'event_mismatch'); assert.equal(result.mutationAllowed, false, 'mutation_not_disabled'); assert.equal(result.outboundAllowed, false, 'outbound_not_disabled')
    const text = result.proposed_reply
    assert.equal(typeof text, 'string', 'reply_not_string'); assert.ok(text.length > 0 && text.length <= 1000, 'reply_length_invalid')
    assert.doesNotMatch(text, /USD|Bearer|E2E_QA_A_SERVICIO|reserva confirmada|quedó reservado/i, 'unsafe_reply')
    if (kind !== 'availability') assert.match(text, /Corte clásico/i, 'service_not_named')
    if (kind === 'price') assert.match(text, /ARS\s*30[.,]?000/, 'authoritative_price_not_matched')
    if (kind === 'availability') { assert.match(text, /fecha|día|servicio/i, 'availability_clarification_missing'); assert.doesNotMatch(text, /\d{1,2}:\d{2}/, 'unverified_slot') }
    const duplicate = await n8n(body); assert.notEqual(duplicate.stage, 'completed', 'duplicate_processed')
    // The only reply destination comes from the other authorized QA instance.
    assert.equal(closing, false, 'window_closed'); assert.equal(sends, 1); sends++
    const sent = await api('/message/sendText/' + target, { number: a.ownerJid.split('@')[0], text, linkPreview: false })
    assert.ok(sent.key?.id, 'reply_ack_missing'); replyId = sent.key.id
    console.log(JSON.stringify({ case: kind, event: sourceId.slice(-8), tenant: 819, reply: text, reply_ack: true, duplicate_rejected: true }))
    completed = true
  }
  const server = http.createServer((req, res) => {
    if (req.url !== path || req.method !== 'POST' || req.headers['x-austral-webhook-secret'] !== secret) { res.writeHead(403); res.end(); return }
    let raw = ''
    req.on('data', chunk => { raw += chunk; if (raw.length > 1000000) req.destroy() })
    req.on('end', () => {
      let body; try { body = JSON.parse(raw) } catch { res.writeHead(400); res.end(); return }
      const data = body.data
      const sender = /^\d+@lid$/.test(data?.key?.remoteJid ?? '') ? data?.key?.remoteJidAlt : data?.key?.remoteJid
      const selected = body.instance === target && String(body.event).toUpperCase().replaceAll('.', '_') === 'MESSAGES_UPSERT' && data?.key?.fromMe === false && sender === a.ownerJid && data.message?.conversation === cases[kind]
      if (selected && !accepted) {
        accepted = true; processing = processInbound(body).catch(e => { failure = e.message })
      } else if (!selected) {
        const task = forward(raw).then(() => { res.writeHead(200); res.end('{}') }).catch(e => { failure = e.message; res.writeHead(502); res.end('{}') }); pending.add(task); task.finally(() => pending.delete(task))
        if (data?.key?.fromMe === true) outgoing.add(data.key.id)
        return
      }
      res.writeHead(200); res.end('{}')
    })
  })
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5689, '0.0.0.0', resolve) })
    changed = true // Restore even if the write result is ambiguous.
    await api('/webhook/set/' + target, { webhook: { ...before, url: 'http://n8n:5689' + path } })
    assert.equal(dto(unpack(await api('/webhook/find/' + target))).url, 'http://n8n:5689' + path)
    sends++
    checkpoint = 'send_question'
    const sent = await api('/message/sendText/' + source, { number: b.ownerJid.split('@')[0], text: cases[kind], linkPreview: false })
    assert.ok(sent.key?.id, 'question_ack_missing'); sourceId = sent.key.id
    checkpoint = 'wait_inbound'
    const deadline = Date.now() + 140000
    while (!completed && !failure && Date.now() < deadline) await pause(500)
    assert.ok(completed, failure || 'inbound_or_processing_timeout')
    await processing
    checkpoint = 'verify_delivery'
    let rows = []
    for (let i = 0; i < 20; i++) {
      const found = await api('/chat/findMessages/' + source, { where: { key: { id: replyId } }, page: 1, offset: 5 })
      rows = found.messages?.records || found.records || []
      if (rows.some(r => r.key?.id === replyId && r.key.fromMe === false)) break
      await pause(500)
    }
    assert.ok(rows.some(r => r.key?.id === replyId && r.key.fromMe === false), 'reply_delivery_not_observed')
    checkpoint = 'verify_fromMe_guard'
    const sentRecords = await api('/chat/findMessages/' + target, { where: { key: { id: replyId } }, page: 1, offset: 5 })
    const sentRecord = (sentRecords.messages?.records || []).find(r => r.key?.id === replyId && r.key.fromMe === true)
    assert.ok(sentRecord, 'outgoing_fromMe_not_observed')
    // MESSAGES_UPSERT subscriptions need not emit the outgoing ACK. Check the
    // provider's actual stored event and replay it only into the no-outbound guard.
    const ignored = await n8n({ event: 'messages.upsert', instance: target, data: sentRecord })
    assert.equal(ignored.reason, 'invalid_inbound', 'fromMe_guard_failed')
    console.log(JSON.stringify({ result: 'PASS', real_evolution_inbound: true, n8n_http: true, real_reply_received: true, fromMe: true, fromMe_guard_replay: true, outgoing_callback_observed: outgoing.has(replyId), sends, general_outbound: false, controlled_bridge: true }))
  } finally {
    closing = true
    try { if (changed) {
      await api('/webhook/set/' + target, { webhook: before })
      assert.deepEqual(dto(unpack(await api('/webhook/find/' + target))), before, 'restore_readback_failed')
      restored = true
    } } finally { server.close() }
    await Promise.allSettled([...pending])
    assert.deepEqual(unpack(await api('/webhook/find/' + source)), sourceBefore, 'source_webhook_changed')
    console.log(JSON.stringify({ restored, sends, general_outbound: false }))
    if (restored || !changed) { fs.unlinkSync(backup); fs.rmdirSync(dir) }
  }
}
main().catch(error => { const firstLine = error.message.split('\n')[0]; console.error(JSON.stringify({ result: 'STOPPED', checkpoint, reason: /^[a-z_0-9]+$/.test(firstLine) ? firstLine : 'guard_failed', no_retry: true })); process.exitCode = 1 })
