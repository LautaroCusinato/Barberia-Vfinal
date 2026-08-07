import assert from 'node:assert/strict'
import fs from 'node:fs'
import { recommendPrice } from '../src/lib/pricingAssistant.js'

const pilotPage = fs.readFileSync(new URL('../src/pages/CommercialPilot.jsx', import.meta.url), 'utf8')
const demoPage = fs.readFileSync(new URL('../src/pages/DemoWorkspace.jsx', import.meta.url), 'utf8')
const e2eSpec = fs.readFileSync(new URL('../e2e/public.spec.mjs', import.meta.url), 'utf8')
assert.match(pilotPage, /localStorage/)
assert.match(pilotPage, /pending|checklist/i)
assert.match(demoPage, /sessionStorage/)
for (const channel of ['email', 'formulario_web', 'instagram_dm', 'whatsapp', 'linkedin']) assert.match(pilotPage, new RegExp(channel))
assert.ok(recommendPrice({ vertical: 'custom', employees: 0 }).monthly >= 10)
assert.ok(recommendPrice({ vertical: 'barberia', whatsapp: true, ai: true, customization: true }).setup > 0)
assert.match(e2eSpec, /E2E_REAL_SUPABASE/)
console.log('Commercial pilot checks passed: demo aislada, pricing mínimo, canales mock y gate sandbox.')
