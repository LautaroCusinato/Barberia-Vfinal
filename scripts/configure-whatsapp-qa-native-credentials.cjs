// Run inside the existing n8n container. Default: read-only plan.
// --apply imports only three NEW QA credentials and binds only the inactive QA draft.
// Values stay server-side. Temporary files are mode 600 in a mode 700 RAM directory.
const fs = require('node:fs')
const cp = require('node:child_process')
const crypto = require('node:crypto')
const QA = '4q45z4wI3fozB2VC'
const PROJECT = 'Q9uDHC6C8iINsjNk'
const HOST = 'cmsymmszlzikqpvfqjre.supabase.co'
const specs = [
  { id: 'australQaWebhookNative', name: 'Austral QA Webhook Header', type: 'httpHeaderAuth' },
  { id: 'australQaSupabaseNative', name: 'Austral QA Supabase Headers', type: 'httpCustomAuth' },
  { id: 'australQaDeepSeekNative', name: 'Austral QA DeepSeek Header', type: 'httpHeaderAuth' },
]
const dir = fs.mkdtempSync('/dev/shm/austral-qa-native-')
fs.chmodSync(dir, 0o700)
const files = []
function file(name, value) {
  const path = dir + '/' + name
  if (!files.includes(path)) files.push(path)
  fs.writeFileSync(path, value, { mode: 0o600 })
  return path
}
function cli(args) {
  const result = cp.spawnSync('n8n', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  // Never print captured CLI output: it could include credential validation data.
  if (result.status !== 0 || !/Successfully/.test(result.stdout)) throw new Error('official_cli_failed')
}
function read(kind, selector, name) {
  const path = file(name, '')
  cli(['export:' + kind, selector, '--output=' + path])
  return JSON.parse(fs.readFileSync(path, 'utf8'))
}
function fingerprint(w) {
  return crypto.createHash('sha256').update(JSON.stringify({ nodes: w.nodes, connections: w.connections, settings: w.settings, active: w.active })).digest('hex')
}
try {
  if (new URL(process.env.SUPABASE_URL).hostname !== HOST) throw new Error('wrong_qa_target')
  for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'DEEPSEEK_API_KEY', 'EVOLUTION_WEBHOOK_SECRET']) {
    if (!process.env[name]) throw new Error('required_server_secret_missing')
  }
  const draft = read('workflow', '--id=' + QA, 'qa.json')[0]
  if (draft.id !== QA || draft.active || draft.nodes.length !== 25) throw new Error('qa_draft_guard')
  if (!draft.shared.some(s => s.projectId === PROJECT && s.role === 'workflow:owner')) throw new Error('project_guard')
  if (/sendText|crear_reserva_whatsapp|\$env\b/.test(JSON.stringify(draft.nodes))) throw new Error('unsafe_node_guard')
  const protectedIds = ['gRTZDLTXvGgNq4BZ', '5UQMp5vAMfBfJtSy']
  const before = protectedIds.map(id => fingerprint(read('workflow', '--id=' + id, id + '.json')[0]))
  const existing = read('credentials', '--projectId=' + PROJECT, 'credentials.json')
  const collisions = existing.filter(c => specs.some(s => s.id === c.id || s.name === c.name))
  if (collisions.length) throw new Error('existing_native_credentials_require_readback_not_overwrite')
  if (!process.argv.includes('--apply')) {
    console.log(JSON.stringify({ mode: 'plan', qa_draft: QA, native_credentials_to_create: specs.map(s => s.name), target_qa: true }))
  } else {
    const values = [
      { name: 'X-Austral-Webhook-Secret', value: process.env.EVOLUTION_WEBHOOK_SECRET },
      { json: JSON.stringify({ headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY } }) },
      { name: 'Authorization', value: 'Bearer ' + process.env.DEEPSEEK_API_KEY },
    ]
    cli(['import:credentials', '--projectId=' + PROJECT, '--input=' + file('native.json', JSON.stringify(specs.map((s, i) => ({ ...s, data: values[i] }))))])
    fs.unlinkSync(dir + '/native.json')
    for (const n of draft.nodes) {
      let s
      if (n.type === 'n8n-nodes-base.webhook') s = specs[0]
      else if (n.type === 'n8n-nodes-base.httpRequest') {
        s = n.name === 'Llamar DeepSeek' ? specs[2] : specs[1]
        if (s === specs[1] && !n.parameters.url.includes(HOST)) throw new Error('http_target_guard')
        if (s === specs[2] && !n.parameters.url.includes('api.deepseek.com')) throw new Error('model_target_guard')
      }
      if (s) n.credentials = { [s.type]: { id: s.id, name: s.name } }
    }
    draft.settings = { ...draft.settings, executionTimeout: 120, timezone: 'America/Argentina/Buenos_Aires', saveDataErrorExecution: 'none', saveDataSuccessExecution: 'none', saveManualExecutions: false }
    cli(['import:workflow', '--projectId=' + PROJECT, '--input=' + file('bound.json', JSON.stringify([draft]))])
    const after = read('workflow', '--id=' + QA, 'after.json')[0]
    if (after.active || after.nodes.filter(n => n.credentials).length !== draft.nodes.filter(n => n.credentials).length) throw new Error('binding_readback_failed')
    protectedIds.forEach((id, i) => {
      if (before[i] !== fingerprint(read('workflow', '--id=' + id, id + '.json')[0])) throw new Error('protected_workflow_changed')
    })
    console.log(JSON.stringify({ result: 'PASS', native_credentials_created: specs.map(s => s.name), bound_nodes: after.nodes.filter(n => n.credentials).length, active: after.active, protected_workflows_unchanged: true, env_access_protection_unchanged: true }))
  }
} catch (error) {
  console.error(JSON.stringify({ result: 'BLOCKED', reason: /^[a-z_]+$/.test(error.message) ? error.message : 'safe_runtime_error' }))
  process.exitCode = 1
} finally {
  for (const path of files) if (fs.existsSync(path)) fs.unlinkSync(path)
  fs.rmdirSync(dir)
}
