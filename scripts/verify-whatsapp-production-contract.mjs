import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const migration = read('supabase/migrations/20260913120000_whatsapp_production_runtime_contract.sql')
const preflight = read('scripts/sql/whatsapp-production-preflight.sql')
const runbook = read('docs/WHATSAPP-FIRST-CUSTOMER-RUNBOOK.md')
const generator = read('scripts/prepare-whatsapp-production-workflow.mjs')
const display = read('src/utils/whatsappDisplay.js')
const app = read('src/App.jsx')
const provisioningUi = read('src/lib/whatsappProvisioning.js')
const provisioningFunction = read('supabase/functions/whatsapp-production-provision/index.ts')
const rollback = read('scripts/sql/whatsapp-production-runtime-rollback.sql')
const workflow = JSON.parse(read('integrations/templates/Austral WhatsApp Production - Controlled.json'))
const serializedWorkflow = JSON.stringify(workflow)
const node = (name) => workflow.nodes.find((candidate) => candidate.name === name)

for (const flag of ['automation_enabled', 'outbound_enabled', 'booking_enabled']) {
  assert.match(migration, new RegExp(`add column if not exists ${flag} boolean not null default false`, 'i'))
}
assert.match(migration, /foreign key \(integration_id, barberia_id\)[\s\S]*references public\.saas_integraciones \(id, barberia_id\)/i)
assert.match(migration, /create or replace function public\.resolve_whatsapp_runtime_context\(\s*p_environment text,\s*p_external_instance_id text/i)
assert.match(migration, /create or replace function public\.claim_whatsapp_runtime_event/i)
assert.match(migration, /v_operation not in \('inbound', 'outbound', 'booking'\)/i)
assert.match(migration, /v_operation <> 'outbound' or c\.outbound_enabled/i)
assert.match(migration, /v_operation <> 'booking' or c\.booking_enabled/i)
assert.match(migration, /v_environment <> 'production' or public\.barberia_access_state\(c\.barberia_id\) in \('active', 'trialing', 'past_due'\)/i)
assert.match(migration, /on conflict on constraint saas_automation_events_integration_id_event_id_key do nothing/i)
for (const signature of [
  'resolve_whatsapp_runtime_context\\(text, text\\)',
  'claim_whatsapp_runtime_event\\(text, bigint, text, text, timestamptz\\)',
]) {
  assert.match(migration, new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`, 'i'))
  assert.match(migration, new RegExp(`grant execute on function public\\.${signature} to service_role`, 'i'))
}
assert.doesNotMatch(migration, /cmsymmszlzikqpvfqjre|ssagttjdgtypxjcgdnrw|austral-qa-tenant-|miwsp|barberia_id\s*=\s*\d+/i)

assert.match(preflight, /begin transaction read only/i)
assert.match(preflight, /rollback;/i)
for (const table of ['barberias', 'servicios', 'barberos', 'barbero_servicios', 'horarios_barbero', 'bloqueos_agenda', 'clientes', 'turnos', 'mensajes', 'saas_integraciones', 'saas_whatsapp_connections']) {
  assert.match(preflight, new RegExp(`'${table}'`))
}
assert.doesNotMatch(preflight, /^\s*(insert|update|delete|alter|create|drop|truncate)\b/im)
assert.match(preflight, /'20260806150000'/)
assert.match(preflight, /'20260821090000'/)

assert.match(rollback, /where automation_enabled or outbound_enabled or booking_enabled/i)
assert.match(rollback, /raise exception 'Disable all WhatsApp runtime capabilities before rollback\.'/i)
assert.doesNotMatch(rollback, /delete\s+from|truncate\s+table/i)

assert.equal(workflow.active, false)
assert.equal(workflow.name, 'Austral WhatsApp Production - Controlled')
assert.equal(node('Webhook Evolution - producción')?.parameters?.authentication, 'headerAuth')
assert.equal(node('Webhook Evolution - producción')?.parameters?.path, 'austral-whatsapp-production-inbound')
assert.match(node('Validar identidad e idempotencia')?.parameters?.jsCode || '', /key\.fromMe === false/)
assert.match(node('Validar identidad e idempotencia')?.parameters?.jsCode || '', /eventId\.length > 0/)
assert.match(node('Resolver tenant')?.parameters?.url || '', /resolve_whatsapp_runtime_context/)
assert.match(node('Resolver tenant')?.parameters?.jsonBody || '', /p_environment: 'production'/)
assert.doesNotMatch(node('Resolver tenant')?.parameters?.jsonBody || '', /tenant_id|barberia_id/i)
assert.match(node('Reclamar evento')?.parameters?.url || '', /claim_whatsapp_runtime_event/)
assert.match(node('Reclamar outbound')?.parameters?.url || '', /claim_whatsapp_runtime_event/)
assert.match(node('Enviar respuesta Evolution')?.parameters?.url || '', /EVOLUTION_BASE_URL[\s\S]*message\/sendText/)
assert.match(node('Enviar respuesta Evolution')?.parameters?.jsonBody || '', /senderNumber[\s\S]*Construir respuesta segura/)
assert.match(node('Validar ACK Evolution')?.parameters?.jsCode || '', /evolution_ack_missing_no_retry/)
assert.equal(node('Bloquear mutación de reserva')?.parameters?.jsCode?.includes('mutationAllowed:false'), true)
assert.doesNotMatch(serializedWorkflow, /crear_reserva_whatsapp|cancelar_reserva_whatsapp|reprogramar_reserva_whatsapp/)
assert.doesNotMatch(serializedWorkflow, /cmsymmszlzikqpvfqjre|austral-qa-tenant-|miwsp|Barberia Central/i)
assert.doesNotMatch(serializedWorkflow, /"credentials"\s*:/i)
assert.equal(workflow.settings?.saveDataSuccessExecution, 'none')
assert.equal(workflow.settings?.saveDataErrorExecution, 'none')

assert.match(display, /automationEnabled = false/)
assert.match(display, /Automatización pendiente de habilitación/)
assert.match(display, /whatsappReady = technicallyConnected[\s\S]*runtimeEnabled/)
assert.match(app, /automation_enabled === true/)
assert.match(app, /!connected \|\| !automationEnabled/)
assert.match(app, /MANAGED_WHATSAPP_PROVISIONING/)
assert.match(app, /supabase\.functions\.invoke\(WHATSAPP_PROVISION_FUNCTION/)
assert.match(provisioningUi, /VITE_WHATSAPP_PROVISION_FUNCTION/)
assert.match(provisioningUi, /return action === 'status' \? 'status' : 'prepare'/)

for (const marker of [
  'WHATSAPP_RUNTIME_PROJECT_REF',
  'WHATSAPP_RUNTIME_ENV',
  'WHATSAPP_PROVISIONING_ENABLED',
  'WHATSAPP_N8N_ALLOWED_HOST',
  'WHATSAPP_PROTECTED_INSTANCES',
]) assert.match(provisioningFunction, new RegExp(marker))
assert.match(provisioningFunction, /admin\.auth\.getUser\(token\)/)
assert.match(provisioningFunction, /\['owner', 'admin'\]\.includes/)
assert.match(provisioningFunction, /function instanceName\(tenantId: number\) \{ return `\$\{INSTANCE_PREFIX\}\$\{tenantId\}` \}/)
assert.match(provisioningFunction, /automation_enabled: false, outbound_enabled: false, booking_enabled: false/)
assert.match(provisioningFunction, /const events = \['MESSAGES_UPSERT'\]/)
assert.match(provisioningFunction, /headers: \{ \[WEBHOOK_HEADER\]: config\.webhookSecret \}/)
assert.match(provisioningFunction, /!\['status', 'prepare'\]\.includes\(action\)/)
assert.doesNotMatch(provisioningFunction, /sendText|crear_reserva|cancelar_reserva|reprogramar_reserva|mercadopago|createPayment|createSubscription/i)
assert.doesNotMatch(provisioningFunction, /cmsymmszlzikqpvfqjre|ssagttjdgtypxjcgdnrw|austral-qa-tenant-/i)

for (const phrase of ['Gate 1: production metadata and backup', 'Gate 2: migrations and inactive runtime', 'Gate 3: provision one customer', 'Controlled E2E', 'Remaining human actions']) {
  assert.match(runbook, new RegExp(phrase))
}
assert.match(generator, /workflow\.active = false/)
assert.match(generator, /p_operation:'outbound'/)

console.log(JSON.stringify({
  database_contract: 'PASS_DEFAULT_OFF',
  tenant_resolution: 'SERVER_SIDE',
  webhook_authentication: 'HEADER_AUTH_REQUIRED',
  idempotency: 'ATOMIC_INBOUND_AND_OUTBOUND_CLAIMS',
  booking: 'DISABLED_SEPARATE_RELEASE',
  production_workflow: 'INACTIVE_REPRODUCIBLE_TEMPLATE',
  production_provisioning: 'OWNER_ADMIN_DEFAULT_OFF',
  ui_activation_semantics: 'PASS',
  production_changes: 0,
}, null, 2))
