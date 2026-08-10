import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { getQaConfig, printGuardError } from './e2e-sandbox-guards.mjs'

const execute = process.argv.includes('--execute')
let config
try {
  config = getQaConfig({ requireCleanup: execute })
} catch (error) {
  printGuardError(error)
  process.exit(2)
}

const admin = createClient(config.supabaseUrl, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const { data: tenants, error: tenantError } = await admin.from('barberias').select('id,nombre,slug,metadata').like('nombre', `${config.testPrefix}%`)
if (tenantError) throw new Error(`No se pudieron leer los tenants QA: HTTP ${tenantError.code || 'unknown'}`)

const invalidTenants = (tenants || []).filter((tenant) => (
  !String(tenant.nombre || '').startsWith(config.testPrefix)
  || !String(tenant.slug || '').startsWith(config.testPrefix.toLowerCase().replaceAll('_', '-'))
  || tenant.metadata?.environment !== config.environment
  || tenant.metadata?.e2e_prefix !== config.testPrefix
))
if (invalidTenants.length > 0) throw new Error('Cleanup abortado: se detectó un tenant candidato sin todas las marcas QA esperadas.')

let authUsers = []
let page = 1
while (true) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) throw new Error('Cleanup abortado: no se pudo auditar Auth QA.')
  authUsers = authUsers.concat(data.users || [])
  if (!data.users || data.users.length < 1000) break
  page += 1
}

const qaUsers = authUsers.filter((user) => {
  const email = String(user.email || '').toLowerCase()
  return email.startsWith('e2e_qa_') && email.endsWith('@e2e-qa.invalid') && user.user_metadata?.e2e_prefix === config.testPrefix
})
const candidateTenantIds = (tenants || []).map((tenant) => tenant.id)

async function assertPrefixedRows(table, columns, predicate, label) {
  if (candidateTenantIds.length === 0) return
  const { data, error } = await admin.from(table).select(columns).in('barberia_id', candidateTenantIds)
  if (error) throw new Error(`Cleanup abortado: no se pudo auditar ${label}.`)
  const invalid = (data || []).filter((row) => !predicate(row))
  if (invalid.length > 0) throw new Error(`Cleanup abortado: ${label} contiene registros fuera de las marcas QA.`)
}

await assertPrefixedRows('servicios', 'nombre', (row) => String(row.nombre || '').startsWith(config.testPrefix), 'servicios')
await assertPrefixedRows('barberos', 'nombre', (row) => String(row.nombre || '').startsWith(config.testPrefix), 'empleados')
await assertPrefixedRows('clientes', 'nombre,telefono,email', (row) => String(row.nombre || '').startsWith(config.testPrefix) && String(row.email || '').endsWith('@e2e-qa.invalid'), 'clientes')
await assertPrefixedRows('turnos', 'paciente,motivo', (row) => String(row.paciente || '').startsWith(config.testPrefix) && String(row.motivo || '').startsWith(config.testPrefix), 'turnos')
await assertPrefixedRows('bloqueos_agenda', 'motivo', (row) => String(row.motivo || '').startsWith(config.testPrefix), 'bloqueos')
await assertPrefixedRows('saas_integraciones', 'referencia_externa,metadata', (row) => String(row.referencia_externa || '').startsWith(config.testPrefix) && row.metadata?.e2e_prefix === config.testPrefix, 'integraciones')
if (candidateTenantIds.length > 0) {
  const { data: configs, error: configError } = await admin.from('config').select('clave,valor').in('barberia_id', candidateTenantIds)
  if (configError) throw new Error('Cleanup abortado: no se pudo auditar la configuración QA.')
  if ((configs || []).some((row) => {
    try {
      return JSON.parse(row.valor || '{}')?.e2e_prefix !== config.testPrefix
    } catch {
      return true
    }
  })) throw new Error('Cleanup abortado: configuración QA sin marca de fixture.')
}
await assertPrefixedRows('crm_negocios', 'nombre,metadata', (row) => String(row.nombre || '').startsWith(config.testPrefix) && row.metadata?.e2e_prefix === config.testPrefix, 'negocios CRM')
if (candidateTenantIds.length > 0) {
  const { data: businesses, error: businessError } = await admin.from('crm_negocios').select('id').in('barberia_id', candidateTenantIds)
  if (businessError) throw new Error('Cleanup abortado: no se pudieron auditar los negocios CRM.')
  const businessIds = (businesses || []).map((business) => business.id)
  if (businessIds.length > 0) {
    const { data: leads, error: leadError } = await admin.from('crm_leads').select('nombre_contacto,email,dedupe_key,metadata').in('negocio_id', businessIds)
    if (leadError) throw new Error('Cleanup abortado: no se pudieron auditar los leads CRM.')
    if ((leads || []).some((row) => !String(row.nombre_contacto || '').startsWith(config.testPrefix) || !String(row.email || '').endsWith('@e2e-qa.invalid') || !String(row.dedupe_key || '').startsWith(config.testPrefix.toLowerCase()) || row.metadata?.e2e_prefix !== config.testPrefix)) throw new Error('Cleanup abortado: leads CRM fuera de las marcas QA.')
  }
}

if (candidateTenantIds.length > 0) {
  const qaUserIds = new Set(qaUsers.map((user) => user.id))
  const { data: members, error: memberError } = await admin.from('barberia_members').select('user_id').in('barberia_id', candidateTenantIds)
  if (memberError) throw new Error('Cleanup abortado: no se pudo auditar los miembros de los tenants QA.')
  if ((members || []).some((member) => !qaUserIds.has(member.user_id))) throw new Error('Cleanup abortado: un tenant QA tiene un miembro Auth fuera del conjunto QA.')
}

console.log(JSON.stringify({ dry_run: !execute, tenant_count: candidateTenantIds.length, auth_user_count: qaUsers.length, prefix: config.testPrefix }, null, 2))

if (!execute) process.exit(0)

if (candidateTenantIds.length > 0) {
  const { error } = await admin.from('barberias').delete().in('id', candidateTenantIds)
  if (error) throw new Error(`No se pudieron limpiar tenants QA: ${error.code || 'unknown'}`)
}

for (const user of qaUsers) {
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) throw new Error('No se pudo limpiar un usuario QA marcado.')
}

console.log(JSON.stringify({ cleanup: 'completed', tenant_count: candidateTenantIds.length, auth_user_count: qaUsers.length, audit: 'sanitized_stdout' }, null, 2))
