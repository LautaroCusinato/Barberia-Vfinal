import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recommendPrice } from '../src/lib/pricingAssistant.js'

const pilotPage = fs.readFileSync(new URL('../src/pages/CommercialPilot.jsx', import.meta.url), 'utf8')
const demoPage = fs.readFileSync(new URL('../src/pages/DemoWorkspace.jsx', import.meta.url), 'utf8')
const demoStore = fs.readFileSync(new URL('../src/lib/demoStore.js', import.meta.url), 'utf8')
const e2eSpec = fs.readFileSync(new URL('../e2e/qa-authenticated.spec.mjs', import.meta.url), 'utf8')
assert.match(pilotPage, /localStorage/)
assert.match(pilotPage, /pending|checklist/i)
assert.match(demoPage, /getDemoSession|demoStore/)
assert.match(demoStore, /localStorage/)
for (const channel of ['email', 'formulario_web', 'instagram_dm', 'whatsapp', 'linkedin']) assert.match(pilotPage, new RegExp(channel))
assert.deepEqual(recommendPrice({ employees: 0 }).currency, 'ARS')
assert.equal(recommendPrice({ employees: 0 }).monthly, 30000)
assert.equal(recommendPrice({ employees: 4, whatsapp: true }).monthly, 60000)
assert.equal(recommendPrice({ employees: 12, customization: true }).monthly, 100000)
assert.match(e2eSpec, /E2E_REAL_SUPABASE/)
console.log('Commercial pilot checks passed: demo aislada, pricing mínimo, canales mock y gate sandbox.')
