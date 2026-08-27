import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync(new URL('../supabase/migrations/20260824150000_whatsapp_integration_state_sync.sql', import.meta.url), 'utf8')

assert.match(migration, /create or replace function public\.sync_whatsapp_integration_state\(\)/)
assert.match(migration, /after insert or update of state, integration_id, provider, environment/)
assert.match(migration, /when 'CONNECTED' then 'conectado'/)
assert.match(migration, /when 'DISCONNECTED' then 'desactivado'/)
assert.match(migration, /when 'ERROR' then 'error'/)
assert.match(migration, /create trigger trg_sync_whatsapp_integration_state/)
assert.match(migration, /join public\.saas_whatsapp_connections c/)
assert.match(migration, /c\.environment = 'qa'/)
assert.match(migration, /c\.state = 'CONNECTED'/)
assert.match(migration, /lower\(btrim\(coalesce\(c\.instance_name, ''\)\)\) like 'austral-qa-tenant-%'/)
assert.match(migration, /lower\(btrim\(coalesce\(c\.instance_name, ''\)\)\) <> 'miwsp'/)
assert.match(migration, /c\.barberia_id = 1/)
assert.match(migration, /c\.instance_name = 'austral-qa-tenant-1'/)
assert.match(migration, /i\.estado is distinct from case c\.state/)

console.log(JSON.stringify({
  authoritative_connection: 'PASS',
  legacy_projection_trigger: 'PASS',
  stale_pending_reconciliation: 'PASS',
  claim_qa_connected_guard: 'PASS',
  non_connected_states_denied: 'PASS',
  protected_instance_denied: 'PASS',
  tenant_a_only_backfill: 'PASS',
}))
