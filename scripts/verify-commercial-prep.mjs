import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260807040000_commercial_operations_foundation.sql')
const checklist = read('supabase/migrations/20260807041000_public_catalog_and_checklist.sql')
const guards = read('supabase/migrations/20260807042000_commercial_action_guards.sql')
const settings = read('src/components/TenantSettings.jsx')
const landing = read('src/pages/Landing.jsx')
const agent = read('src/pages/CommercialAgent.jsx')
const main = read('src/main.jsx')

for (const name of ['barberia_invitaciones', 'crm_agent_drafts', 'saas_product_events', 'tenant-logos', 'get_tenant_settings', 'update_tenant_settings', 'accept_barberia_invitation', 'transfer_barberia_ownership']) assert.match(migration, new RegExp(name), `falta contrato ${name}`)
for (const name of ['get_public_saas_catalog', 'get_onboarding_status', 'reservas_publicas', 'anticipacion_minutos']) assert.match(checklist, new RegExp(name), `falta contrato público ${name}`)
assert.match(guards, /set_crm_agent_draft_status/)
for (const name of ['update_tenant_settings', 'storage.from', 'create_barberia_invitation']) assert.match(settings, new RegExp(name), `falta UI ${name}`)
for (const name of ['get_public_saas_catalog', 'application/ld\\+json', '14 días', 'faq']) assert.match(landing, new RegExp(name), `falta landing ${name}`)
for (const name of ['pending_approval', 'crm_agent_drafts', 'do_not_contact']) assert.match(agent, new RegExp(name), `falta control de agente ${name}`)
assert.match(main, /Landing/)
assert.match(main, /InvitationPage/)
assert.doesNotMatch(migration + landing + agent, /(sk_live_|sk_test_|service_role_key\s*=\s*['"][^$])/i)
console.log('Commercial preparation checks passed: settings, storage, invitations, landing, catalog, checklist y aprobación humana.')
