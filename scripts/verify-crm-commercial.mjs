import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260807050000_crm_commercial_operations.sql')
const importMigration = read('supabase/migrations/20260807051000_crm_import_environment.sql')
const stageMigration = read('supabase/migrations/20260807052000_crm_stage_compatibility.sql')
const page = read('src/components/CRMLeadsWorkspace.jsx')
const csv = read('src/lib/csv.js')
const provider = read('src/lib/commercialDraftProvider.js')
const agent = read('src/pages/CommercialAgent.jsx')

for (const contract of ['crm_investigaciones', 'crm_actividades', 'crm_acciones', 'crm_importaciones', 'crm_merge_log', 'calculate_crm_lead_score', 'import_crm_leads', 'merge_crm_leads', 'get_crm_pipeline_metrics', 'export_crm_leads', 'set_crm_lead_do_not_contact', 'platform_can_export', 'environment', 'crm_agent_draft_guard']) assert.match(migration, new RegExp(contract), `falta contrato ${contract}`)
assert.match(importMigration, /p_environment\s+text/, 'importación debe separar entornos')
assert.match(stageMigration, /en_conversacion/, 'compatibilidad de qualified no documentada')
for (const contract of ['PAGE_SIZE', 'Importar CSV', 'Descargar errores', 'Exportar', 'set_crm_lead_stage', 'calculate_crm_lead_score', 'do_not_contact', 'merge_crm_leads']) assert.match(page, new RegExp(contract), `falta interfaz ${contract}`)
for (const contract of ['parseLeadsCsv', 'isDangerousCsvValue', 'FIELD_ALIASES', 'warnings']) assert.match(csv, new RegExp(contract), `falta parser ${contract}`)
for (const contract of ['DRAFT_PROVIDERS', 'createMockDraft', 'generateCommercialDraft', 'maxLength']) assert.match(provider, new RegExp(contract), `falta proveedor ${contract}`)
for (const contract of ['approved', 'rejected', 'Editar borrador', 'pending_approval']) assert.match(agent, new RegExp(contract), `falta revisión ${contract}`)
assert.doesNotMatch(migration + page + provider, /(sk_live_|sk_test_|service_role_key\s*=\s*['"][^$])/i)
console.log('CRM commercial checks passed: pagination, CSV seguro, scoring, pipeline, DNC, merge, métricas y aprobación humana.')
