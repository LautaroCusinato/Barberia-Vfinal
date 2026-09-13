// Existing n8n container only. No Evolution endpoints; no real WhatsApp input.
// Creates/updates ONLY a reserved inactive QA CLI harness, derived from QA shadow.
const fs = require('node:fs')
const cp = require('node:child_process')
if (!process.argv.includes('--execute')) {
  console.log('PLAN_ONLY: synthetic QA event -> native n8n credentials -> QA Supabase -> DeepSeek -> shadow audit; no sends')
  process.exit(0)
}
const dir = fs.mkdtempSync('/dev/shm/austral-qa-runtime-')
fs.chmodSync(dir, 0o700)
const file = dir + '/qa.json'
const eventId = 'E2E_QA_CLI_' + Date.now()
const question = process.argv.includes('--price-only') ? '¿Cuánto sale el Corte clásico?' : '¿Qué servicios tienen?'
function parseResult(raw) {
  for (let start = raw.indexOf('{'); start >= 0; start = raw.indexOf('{', start + 1)) {
    let depth = 0, string = false, escape = false
    for (let i = start; i < raw.length; i++) {
      const c = raw[i]
      if (string) { if (escape) escape = false; else if (c === '\\') escape = true; else if (c === '"') string = false; continue }
      if (c === '"') string = true
      else if (c === '{') depth++
      else if (c === '}' && --depth === 0) {
        try { const result = JSON.parse(raw.slice(start, i + 1)); if (result.data?.resultData) return result } catch { /* diagnostic text, not JSON */ }
        break
      }
    }
  }
  return null
}
try {
  if (new URL(process.env.SUPABASE_URL).hostname !== 'cmsymmszlzikqpvfqjre.supabase.co') throw new Error('wrong_target')
  cp.spawnSync('n8n', ['export:workflow', '--id=4q45z4wI3fozB2VC', '--output=' + file], { encoding: 'utf8' })
  const draft = JSON.parse(fs.readFileSync(file))[0]
  if (globalThis.qaRuntimeArtifact) {
    const artifact = globalThis.qaRuntimeArtifact
    if (artifact.name !== draft.name || artifact.active || artifact.nodes.length !== 25) throw new Error('artifact_guard')
    const bindings = new Map(draft.nodes.map(n => [n.name, n.credentials]))
    draft.nodes = artifact.nodes.map(n => ({ ...n, ...(bindings.get(n.name) ? { credentials: bindings.get(n.name) } : {}) }))
    draft.connections = artifact.connections
  }
  if (draft.id !== '4q45z4wI3fozB2VC' || /sendText|crear_reserva_whatsapp/.test(JSON.stringify(draft.nodes))) throw new Error('unsafe_workflow')
  draft.id = 'australQaRuntimeHarness'
  draft.name = 'Austral QA Runtime Harness - No Send'
  draft.active = false
  for (const k of ['activeVersionId', 'activeVersion', 'versionId', 'shared']) delete draft[k]
  const trigger = draft.nodes.find(n => n.type === 'n8n-nodes-base.webhook')
  trigger.type = 'n8n-nodes-base.code'
  trigger.typeVersion = 2
  delete trigger.credentials
  delete trigger.webhookId
  trigger.parameters = { jsCode: 'return [{json:{body:' + JSON.stringify({ event: 'MESSAGES_UPSERT', instance: 'austral-qa-tenant-819', data: { key: { id: eventId, fromMe: false, remoteJid: '5491100000099@s.whatsapp.net' }, message: { conversation: question } } }) + '}}];' }
  draft.nodes.push({ id: 'qa-manual-entry', name: 'QA Manual Entry', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {}, position: [-200, 0] })
  draft.connections['QA Manual Entry'] = { main: [[{ node: trigger.name, type: 'main', index: 0 }]] }
  fs.writeFileSync(file, JSON.stringify([draft]), { mode: 0o600 })
  const imported = cp.spawnSync('n8n', ['import:workflow', '--input=' + file, '--projectId=Q9uDHC6C8iINsjNk'], { encoding: 'utf8' })
  if (!/Successfully/.test(imported.stdout)) throw new Error('import_failed')
  const run = cp.spawnSync('n8n', ['execute', '--id=' + draft.id, '--rawOutput'], { encoding: 'utf8', timeout: 150000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, N8N_RUNNERS_BROKER_PORT: '56791' } })
  const data = parseResult(run.stdout)?.data?.resultData
  const error = data?.error
  const safeMessage = String(error?.message || '').replace(/https?:\S+|Bearer\s+\S+|eyJ\S+|sk-\S+/g, '[redacted]').slice(0, 180)
  console.log(JSON.stringify({ eventId, cli_status: run.status, last_node: data?.lastNodeExecuted, error_node: error?.node?.name, error_name: error?.name, message: safeMessage, parameter: error?.context?.parameter, error_keys: error ? Object.keys(error) : [], parsed: !!data, result: data && !error ? 'PASS' : 'FAIL', whatsapp_sends: 0 }))
  if (!data || error) process.exitCode = 1
} catch {
  console.log('QA_RUNTIME_HARNESS_FAILED_NO_SECRET_OUTPUT')
  process.exitCode = 1
} finally {
  if (fs.existsSync(file)) fs.unlinkSync(file)
  fs.rmdirSync(dir)
}
