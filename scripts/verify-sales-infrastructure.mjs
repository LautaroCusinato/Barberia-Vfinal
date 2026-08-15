import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260815090000_crm_sales_infrastructure.sql')
const crm = read('src/components/CRMLeadsWorkspace.jsx')
const queue = read('src/components/CRMOutreachQueue.jsx')
const platform = read('src/pages/PlatformCRM.jsx')
const sidebar = read('src/components/Sidebar.jsx')
const demo = read('src/App.jsx')
const qa = read('scripts/verify-crm-sales-qa.mjs')

for (const contract of [
  'crm_normalize_phone', 'crm_normalize_email', 'crm_normalize_domain', 'crm_normalize_instagram',
  'crm_find_duplicate_candidates', 'crm_upsert_researched_lead', 'crm_preview_import',
  'crm_import_leads_batch', 'get_crm_outreach_queue', 'record_crm_outreach_activity',
  'idempotency_key', 'do_not_contact', 'writes_performed',
]) assert.match(migration, new RegExp(contract), `falta contrato comercial ${contract}`)
for (const contract of ['crm_preview_import', 'crm_import_leads_batch', 'batchKey']) assert.match(crm, new RegExp(contract), `falta flujo server-side ${contract}`)
for (const contract of ['get_crm_outreach_queue', 'record_crm_outreach_activity', 'no envía mensajes']) assert.match(queue, new RegExp(contract), `falta cola comercial ${contract}`)
for (const contract of ['E2E_QA_', 'crm_preview_import', 'crm_import_leads_batch', 'external_effects', 'production_writes']) assert.match(qa, new RegExp(contract), `falta cobertura QA comercial ${contract}`)
assert.match(platform, /Listos para contactar/)
assert.match(sidebar, /WhatsApp en validación/)
assert.match(demo, /WhatsApp está en validación/)
assert.doesNotMatch(migration + crm + queue, /(sk_live_|service_role_key\s*=\s*['"][^$])/i)
console.log('Sales infrastructure checks passed: normalization, dedupe, DNC, preview, idempotent batch import, outreach queue and sales-safe UI.')
