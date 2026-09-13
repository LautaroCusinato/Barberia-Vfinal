import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const frontend = [
  'src/App.jsx',
  'src/main.jsx',
  'src/lib/supabaseClient.js',
].map(read).join('\n')
const tenantRls = read('supabase/migrations/20260806140000_consolidate_saas_rls.sql')
const qaBaseSchema = read('supabase/migrations/20260810171324_qa_base_schema.sql')
const whatsappContract = read('supabase/migrations/20260806150000_multitenant_whatsapp_contract.sql')
const bookingMutations = read('supabase/migrations/20260806161000_whatsapp_booking_mutations.sql')
const publicBooking = read('supabase/migrations/20260731210000_public_booking.sql')
const provisioningSchema = read('supabase/migrations/20260821090000_whatsapp_tenant_provisioning.sql')
const webhook = read('supabase/functions/whatsapp-evolution-webhook/index.ts')
const provisioning = read('supabase/functions/whatsapp-provision/index.ts')
const bookingFunction = read('supabase/functions/whatsapp-booking-mutation/index.ts')
const outboundFunction = read('supabase/functions/whatsapp-agent-outbound-pilot/index.ts')
const billing = read('supabase/functions/_shared/providers.ts') + '\n' + read('supabase/functions/billing-api/index.ts') + '\n' + read('scripts/billing-production-dry-run.mjs')
const runbook = read('docs/FIRST-CUSTOMER-OPERATIONS.md')

// Browser code must use an anon/publishable key and tenant-filtered reads.
assert.doesNotMatch(frontend, /SUPABASE_SERVICE_ROLE_KEY|service_role/i)
for (const table of ['turnos', 'clientes', 'servicios', 'barberos', 'mensajes']) {
  assert.match(frontend, new RegExp(`from\\(['"]${table}['"]\\)[\\s\\S]{0,240}barberia_id`), `${table} must remain tenant-scoped in the browser`)
}

// Database authority: tenant membership/RLS plus service-role-only automation RPCs.
assert.match(tenantRls, /is_barberia_member/i)
const legacyRls = read('supabase/migrations/20260806050000_harden_legacy_rls.sql')
assert.match(legacyRls, /on public\.mensajes[\s\S]*is_barberia_member\(barberia_id\)/i)
for (const table of ['turnos', 'clientes', 'servicios', 'barberos', 'mensajes']) {
  assert.match(qaBaseSchema, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
  assert.match(qaBaseSchema, new RegExp(`on public\\.${table}[\\s\\S]{0,180}is_barberia_member\\(barberia_id\\)`, 'i'), `${table} must have a tenant membership policy in the reproducible QA schema`)
}
for (const operation of ['crear_reserva_whatsapp', 'cancelar_reserva_whatsapp', 'reprogramar_reserva_whatsapp']) {
  const source = operation === 'crear_reserva_whatsapp' ? whatsappContract : bookingMutations
  assert.match(source, new RegExp(`create or replace function public\\.${operation}`, 'i'))
  assert.match(source, new RegExp(`revoke all on function public\\.${operation}[\\s\\S]*from public, anon, authenticated`, 'i'))
  assert.match(source, new RegExp(`grant execute on function public\\.${operation}[\\s\\S]*to service_role`, 'i'))
}
assert.match(publicBooking, /horarios_disponibles_reserva_publica/i)
assert.match(bookingMutations, /barberia_access_state[\s\S]*active[\s\S]*trialing[\s\S]*past_due/i)
assert.match(provisioningSchema, /unique \(barberia_id, environment\)/i)
assert.match(provisioningSchema, /revoke all on table public\.saas_whatsapp_connections from public, anon, authenticated/i)

// Current deployable automation remains deliberately QA-only/fail-closed.
assert.match(webhook, /qa_project_required/)
assert.match(webhook, /WHATSAPP_MODE.*shadow/)
assert.match(provisioning, /qa_project_required/)
assert.match(provisioning, /PROTECTED_INSTANCE = 'miwsp'/)
assert.match(bookingFunction, /WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED|QA_BOOKING_MUTATION_FLAG/)
assert.match(outboundFunction, /WHATSAPP_AGENT_OUTBOUND_PILOT_ENABLED/)
assert.doesNotMatch(webhook, /message\/sendText/)

// Billing remains a separate, explicit financial gate.
assert.match(billing, /BILLING_PRODUCTION_ENABLED/)
assert.match(billing, /BILLING_GLOBAL_PROVIDER_ENABLED/)
assert.match(billing, /BILLING_PRODUCTION_CHECKOUT_CONFIRMATION/)

for (const heading of ['CURRENT SELLABLE SCOPE', 'WHATSAPP COMMERCIAL GATE', 'FIRST CUSTOMER SEQUENCE', 'ROLLBACK', 'HUMAN ACTIONS']) {
  assert.match(runbook, new RegExp(`## ${heading}`))
}

console.log(JSON.stringify({
  tenant_isolation_contract: 'PASS',
  booking_database_contract: 'READY_FOR_QA',
  onboarding_contract: 'PASS',
  billing_default: 'FAIL_CLOSED',
  production_whatsapp: 'BLOCKED_BY_EXPLICIT_RELEASE_GATE',
  required_manual_gates: [
    'verify the effective production core-table RLS catalog against the QA contract',
    'approve production-safe WhatsApp implementation and deploy',
    'apply only the authorized WhatsApp production migration after backup',
    'provide and pair the first customer WhatsApp account',
    'authorize one tenant-scoped production E2E before enabling automation',
  ],
  status: 'READY_FOR_SALE_MANUAL_STEPS_REMAINING',
}, null, 2))
