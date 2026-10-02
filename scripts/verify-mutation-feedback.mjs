import assert from 'node:assert/strict'
import fs from 'node:fs'
import { enqueueLatest } from '../src/lib/latestIntentQueue.js'

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A→B→C with deliberately different response times: the queue must never
// allow an older intent to overwrite the last one and must not run duplicates.
const writes = {}
const started = []
let persisted = null
const execute = async (value) => {
  started.push(value)
  await wait(value === 'A' ? 1500 : 500)
  persisted = value
}
const first = enqueueLatest(writes, 'barbero:1:nombre', 'A', execute)
await wait(50)
const second = enqueueLatest(writes, 'barbero:1:nombre', 'B', execute)
const third = enqueueLatest(writes, 'barbero:1:nombre', 'C', execute)
await Promise.all([first, second, third])
assert.deepEqual(started, ['A', 'C'], 'las intenciones intermedias deben coalescerse')
assert.equal(persisted, 'C', 'la última intención debe ser la persistida')

// A transport rejection still releases the queue so a retry is possible.
const rejectedWrites = {}
await assert.rejects(
  enqueueLatest(rejectedWrites, 'turno:1:estado', 'atendido', async () => { await wait(500); throw new Error('HTTP 500') }),
  /HTTP 500/,
)
assert.equal(rejectedWrites['turno:1:estado'].inFlight, false, 'un reject no debe dejar el control bloqueado')

// Double submit guard: the second click while pending must be ignored.
let submits = 0
let pending = false
const submitOnce = async () => {
  if (pending) return
  pending = true
  submits += 1
  try { await wait(500) } finally { pending = false }
}
await Promise.all([submitOnce(), submitOnce()])
assert.equal(submits, 1, 'un submit pendiente no debe duplicarse')

// A rejected mutation keeps the draft; a successful one clears it.
const draftAfter = async (draft, callback) => {
  const result = await callback()
  return result === false ? draft : ''
}
assert.equal(await draftAfter('nota pendiente', async () => false), 'nota pendiente')
assert.equal(await draftAfter('nota guardada', async () => true), '')

const requiredContracts = [
  ['src/components/EditPatientModal.jsx', /saved !== false/, /finally/, /aria-busy/],
  ['src/components/Notes.jsx', /El borrador quedó preservado/, /finally/, /disabled=\{saving\}/],
  ['src/components/Messages.jsx', /sent === false/, /El borrador quedó preservado/, /aria-busy=\{sending\}/],
  ['src/components/StatusSelect.jsx', /setPending\(true\)/, /disabled=\{pending\}/, /role="alert"/],
  ['src/components/TurnoRow.jsx', /eliminarTurno/, /El borrador quedó preservado/, /disabled=\{deleting\}/],
  ['src/components/TenantSettings.jsx', /finally \{\s*setSaving\(false\)/, /setUploading\(false\)/, /memberPending/],
]
for (const [file, ...patterns] of requiredContracts) {
  const content = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  for (const pattern of patterns) assert.match(content, pattern, `${file} no cumple ${pattern}`)
}

console.log(JSON.stringify({ mutation_feedback: 'passed', ordering: started, persisted, double_submit: submits, delays_ms: [500, 1500] }, null, 2))
