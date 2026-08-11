import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const QA_PREFIX = 'E2E_QA_'
const mode = process.argv[2] || '--dry-run'
const repoRoot = path.resolve(process.cwd())
const defaultBackupRoot = path.join(os.tmpdir(), 'austral-saas-qa-backups')
const backupRoot = path.resolve(process.env.QA_BACKUP_DIR || defaultBackupRoot)

const scopedTables = [
  'barberia_members',
  'servicios',
  'barberos',
  'horarios_barbero',
  'bloqueos_agenda',
  'clientes',
  'turnos',
  'mensajes',
  'conversaciones',
  'notas',
  'config',
  'pagos',
  'saas_suscripciones',
  'saas_integraciones',
  'crm_negocios',
]

function fail(message) {
  throw new Error(message)
}

function assertSafePath(target) {
  const resolved = path.resolve(target)
  const relative = path.relative(repoRoot, resolved)
  if (!relative.startsWith('..') || path.isAbsolute(relative)) fail('Backup path must stay outside the repository.')
  if (resolved.includes(`${path.sep}docs${path.sep}`) || resolved.includes(`${path.sep}.git${path.sep}`)) fail('Backup path cannot be inside docs or .git.')
  return resolved
}

function loadConfig() {
  const env = process.env
  const projectRef = String(env.E2E_SUPABASE_PROJECT_REF || '').trim()
  const allowedRef = String(env.E2E_ALLOWED_PROJECT_REF || '').trim()
  const url = String(env.E2E_SUPABASE_URL || '').trim().replace(/\/$/, '')
  const environment = String(env.E2E_ENVIRONMENT || '').trim().toLowerCase()
  const prefix = String(env.E2E_TEST_PREFIX || '').trim()
  const reasons = []

  if (env.E2E_REAL_SUPABASE !== '1') reasons.push('E2E_REAL_SUPABASE must be 1')
  if (projectRef !== QA_PROJECT_REF) reasons.push('project ref is not the QA ref')
  if (allowedRef !== QA_PROJECT_REF) reasons.push('E2E_ALLOWED_PROJECT_REF is not the QA ref')
  if (projectRef === PRODUCTION_PROJECT_REF || url.includes(PRODUCTION_PROJECT_REF)) reasons.push('production ref is forbidden')
  if (!['qa', 'sandbox'].includes(environment)) reasons.push('environment must be qa or sandbox')
  if (prefix !== QA_PREFIX) reasons.push('E2E_TEST_PREFIX must be E2E_QA_')
  if (url !== `https://${QA_PROJECT_REF}.supabase.co`) reasons.push('Supabase URL does not match QA ref')
  if (!env.E2E_SUPABASE_SERVICE_ROLE_KEY) reasons.push('service role key is missing from the local environment')
  if (mode === '--restore-test' && env.E2E_ALLOW_QA_RESTORE !== '1') reasons.push('E2E_ALLOW_QA_RESTORE must be 1 for restore-test')

  const forbiddenSecrets = ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'PAYPAL_CLIENT_SECRET', 'EVOLUTION_API_KEY', 'EVOLUTION_WEBHOOK_SECRET', 'DEEPSEEK_API_KEY', 'N8N_BASIC_AUTH_PASSWORD']
  if (forbiddenSecrets.some((name) => String(env[name] || '').trim())) reasons.push('external provider secret present in process environment')
  if (reasons.length > 0) fail(`QA backup guard blocked: ${reasons.join('; ')}`)

  return {
    projectRef,
    url,
    environment,
    prefix,
    serviceRoleKey: env.E2E_SUPABASE_SERVICE_ROLE_KEY,
    anonKey: env.E2E_SUPABASE_ANON_KEY,
    qaPassword: env.E2E_QA_PASSWORD,
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const sensitiveKey = /secret|token|password|api[_-]?key|authorization|cookie|private[_-]?key|client[_-]?secret|access[_-]?token/i

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveKey.test(key)).map(([key, item]) => [key, sanitize(item)]))
  }
  return value
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

async function readRows(admin, table, column, ids) {
  if (!ids.length) return []
  const { data, error } = await admin.from(table).select('*').in(column, ids)
  if (error) fail(`Could not snapshot ${table}: ${error.code || 'unknown'}`)
  return data || []
}

async function snapshotQa(admin, config) {
  const { data: tenants, error: tenantError } = await admin.from('barberias').select('*').like('nombre', `${config.prefix}%`)
  if (tenantError) fail(`Could not read QA tenants: ${tenantError.code || 'unknown'}`)
  if (!tenants?.length) fail('No QA tenants were found.')
  if (tenants.some((tenant) => !String(tenant.nombre || '').startsWith(config.prefix) || !String(tenant.slug || '').startsWith(config.prefix.toLowerCase().replaceAll('_', '-')) || tenant.metadata?.e2e_prefix !== config.prefix || !['qa', 'sandbox'].includes(tenant.metadata?.environment))) fail('A candidate tenant is missing the complete QA marker set.')

  const tenantIds = tenants.map((tenant) => tenant.id)
  const tables = {}
  for (const table of scopedTables.filter((name) => name !== 'crm_negocios')) tables[table] = await readRows(admin, table, 'barberia_id', tenantIds)

  const barberoIds = tables.barberos.map((row) => row.id)
  const servicioIds = tables.servicios.map((row) => row.id)
  if (barberoIds.length && servicioIds.length) {
    const { data, error } = await admin.from('barbero_servicios').select('*').in('barbero_id', barberoIds).in('servicio_id', servicioIds)
    if (error) fail(`Could not snapshot barbero_servicios: ${error.code || 'unknown'}`)
    tables.barbero_servicios = data || []
  } else tables.barbero_servicios = []

  const { data: businesses, error: businessError } = await admin.from('crm_negocios').select('*').in('barberia_id', tenantIds)
  if (businessError) fail(`Could not snapshot crm_negocios: ${businessError.code || 'unknown'}`)
  tables.crm_negocios = businesses || []

  const negocioIds = tables.crm_negocios.map((row) => row.id)
  const crmTables = ['crm_leads', 'crm_interacciones', 'crm_investigaciones', 'crm_actividades', 'crm_notas', 'crm_adjuntos', 'crm_acciones']
  const crm = {}
  if (negocioIds.length) {
    const { data: leads, error: leadError } = await admin.from('crm_leads').select('*').in('negocio_id', negocioIds)
    if (leadError) fail(`Could not snapshot crm_leads: ${leadError.code || 'unknown'}`)
    crm.crm_leads = leads || []
    const leadIds = crm.crm_leads.map((row) => row.id)
    for (const table of crmTables.filter((name) => name !== 'crm_leads')) {
      const column = table === 'crm_interacciones' ? 'lead_id' : 'negocio_id'
      const ids = column === 'lead_id' ? leadIds : negocioIds
      const { data, error } = await admin.from(table).select('*').in(column, ids)
      if (error && error.code !== '42P01') fail(`Could not snapshot ${table}: ${error.code || 'unknown'}`)
      crm[table] = data || []
    }
  } else {
    crm.crm_leads = []
    for (const table of crmTables.filter((name) => name !== 'crm_leads')) crm[table] = []
  }
  tables.crm = crm

  const authUsers = []
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) fail('Could not audit QA Auth users.')
    for (const user of data.users || []) {
      if (String(user.email || '').startsWith('e2e_qa_') && String(user.email || '').endsWith('@e2e-qa.invalid') && user.user_metadata?.e2e_prefix === config.prefix) authUsers.push({
        id: user.id,
        email: user.email,
        email_confirmed_at: user.email_confirmed_at,
        user_metadata: {
          e2e_prefix: user.user_metadata.e2e_prefix,
          environment: user.user_metadata.environment,
          qa_role: user.user_metadata.qa_role,
        },
      })
    }
    if (!data.users || data.users.length < 1000) break
    page += 1
  }

  const { data: buckets, error: bucketError } = await admin.storage.listBuckets()
  if (bucketError) fail('Could not audit Storage buckets.')
  const storage = []
  for (const bucket of buckets || []) {
    const { data: objects, error } = await admin.storage.from(bucket.id).list('', { limit: 1000 })
    if (error) fail(`Could not audit Storage bucket ${bucket.id}.`)
    const qaObjects = (objects || []).filter((object) => String(object.name || '').startsWith(config.prefix))
    storage.push({ id: bucket.id, name: bucket.name, public: bucket.public, objects: qaObjects.map((object) => ({ name: object.name, id: object.id, updated_at: object.updated_at })) })
  }

  const snapshot = sanitize({
    format_version: 1,
    generated_at: new Date().toISOString(),
    project_ref: config.projectRef,
    environment: config.environment,
    prefix: config.prefix,
    tenants,
    tables,
    auth_users: authUsers,
    storage,
  })
  const digest = crypto.createHash('sha256').update(canonicalJson(snapshot)).digest('hex')
  return { ...snapshot, integrity_sha256: digest }
}

async function verifyIntegrity(admin, config, snapshot) {
  const tenants = snapshot.tenants || []
  const ids = tenants.map((tenant) => tenant.id)
  const { data: current, error } = await admin.from('barberias').select('id,nombre,slug,metadata').in('id', ids)
  if (error) fail('Could not verify QA tenants after restore.')
  if ((current || []).length !== ids.length || current.some((tenant) => !String(tenant.nombre || '').startsWith(config.prefix) || tenant.metadata?.e2e_prefix !== config.prefix)) fail('QA tenant integrity verification failed.')

  const tableChecks = ['servicios', 'barberos', 'horarios_barbero', 'bloqueos_agenda', 'clientes', 'turnos', 'config', 'saas_suscripciones', 'saas_integraciones', 'crm_negocios']
  const counts = {}
  for (const table of tableChecks) {
    const { count, error: countError } = await admin.from(table).select('*', { count: 'exact', head: true }).in('barberia_id', ids)
    if (countError) fail(`Could not verify ${table}.`)
    counts[table] = count
  }

  const { data: turns, error: turnsError } = await admin.from('turnos').select('barberia_id,cliente_id,barbero_id,servicio_id').in('barberia_id', ids)
  if (turnsError) fail('Could not verify turn relationships.')
  const { data: clients } = await admin.from('clientes').select('id,barberia_id').in('barberia_id', ids)
  const { data: barbers } = await admin.from('barberos').select('id,barberia_id').in('barberia_id', ids)
  const { data: services } = await admin.from('servicios').select('id,barberia_id').in('barberia_id', ids)
  const clientMap = new Map((clients || []).map((row) => [row.id, row.barberia_id]))
  const barberMap = new Map((barbers || []).map((row) => [row.id, row.barberia_id]))
  const serviceMap = new Map((services || []).map((row) => [row.id, row.barberia_id]))
  if ((turns || []).some((turn) => (turn.cliente_id && clientMap.get(turn.cliente_id) !== turn.barberia_id) || barberMap.get(turn.barbero_id) !== turn.barberia_id || serviceMap.get(turn.servicio_id) !== turn.barberia_id)) fail('Cross-tenant turn relationship detected.')

  const verifyClient = async (email, expectedTenantId) => {
    const client = createClient(config.url, config.anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: authData, error: authError } = await client.auth.signInWithPassword({ email, password: config.qaPassword })
    if (authError || !authData.session) fail(`Could not authenticate QA isolation verifier for ${email}.`)
    const { data: rows, error: rowError } = await client.from('clientes').select('barberia_id,nombre').order('id').limit(100)
    if (rowError) fail(`Could not verify RLS for ${email}.`)
    if ((rows || []).some((row) => row.barberia_id !== expectedTenantId || !String(row.nombre || '').startsWith(config.prefix))) fail(`RLS isolation verification failed for ${email}.`)
  }
  await verifyClient('e2e_qa_owner_a@e2e-qa.invalid', ids[0])
  await verifyClient('e2e_qa_owner_b@e2e-qa.invalid', ids[1])
  return { tenants: ids.length, counts, turn_relationships: (turns || []).length, rls: 'verified' }
}

async function main() {
  const config = loadConfig()
  assertSafePath(backupRoot)
  if (!['--dry-run', '--backup', '--restore-test'].includes(mode)) fail('Usage: --dry-run | --backup | --restore-test')
  const admin = createClient(config.url, config.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  if (mode === '--dry-run') {
    const snapshot = await snapshotQa(admin, config)
    console.log(JSON.stringify({ dry_run: true, project_ref: config.projectRef, tenants: snapshot.tenants.length, auth_users: snapshot.auth_users.length, storage_buckets: snapshot.storage.length, tables: Object.keys(snapshot.tables).length, backup_root: backupRoot }, null, 2))
    return
  }

  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 })
  const directory = path.join(backupRoot, new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z'))
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const snapshot = await snapshotQa(admin, config)
  const snapshotPath = path.join(directory, 'snapshot.json')
  writeJson(snapshotPath, snapshot)
  const initialHash = crypto.createHash('sha256').update(fs.readFileSync(snapshotPath)).digest('hex')
  writeJson(path.join(directory, 'MANIFEST.json'), { project_ref: config.projectRef, environment: config.environment, prefix: config.prefix, snapshot: 'snapshot.json', sha256: initialHash })

  if (mode === '--backup') {
    console.log(JSON.stringify({ backup: 'created', project_ref: config.projectRef, snapshot_path: snapshotPath, tenants: snapshot.tenants.length, auth_users: snapshot.auth_users.length, storage_buckets: snapshot.storage.length }, null, 2))
    return
  }

  const sentinel = snapshot.tables.clientes?.[0]
  if (!sentinel) fail('No QA client sentinel exists for the restore test.')
  const original = { nombre: sentinel.nombre, apellido: sentinel.apellido, telefono: sentinel.telefono, email: sentinel.email, notas: sentinel.notas }
  const mutated = { nombre: `${config.prefix}RESTORE_MUTATED`, notas: `${config.prefix}restore-test` }
  let restored = false
  try {
    const { error: updateError } = await admin.from('clientes').update(mutated).eq('id', sentinel.id).eq('barberia_id', sentinel.barberia_id)
    if (updateError) fail(`Could not apply controlled QA mutation: ${updateError.code || 'unknown'}`)
    const { data: changed } = await admin.from('clientes').select('nombre,notas').eq('id', sentinel.id).maybeSingle()
    if (changed?.nombre !== mutated.nombre) fail('Controlled QA mutation was not observable.')
    const { error: restoreError } = await admin.from('clientes').update(original).eq('id', sentinel.id).eq('barberia_id', sentinel.barberia_id)
    if (restoreError) fail(`Could not restore QA sentinel: ${restoreError.code || 'unknown'}`)
    restored = true
  } finally {
    if (!restored) await admin.from('clientes').update(original).eq('id', sentinel.id).eq('barberia_id', sentinel.barberia_id)
  }
  const verification = await verifyIntegrity(admin, config, snapshot)
  console.log(JSON.stringify({ restore_test: 'passed', project_ref: config.projectRef, snapshot_path: snapshotPath, mutation: 'QA client modified and restored', verification }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'QA backup/restore failed.')
  process.exitCode = 1
})
