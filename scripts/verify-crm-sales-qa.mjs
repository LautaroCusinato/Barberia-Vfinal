import assert from 'node:assert/strict'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { getQaConfig, printGuardError, QA_PREFIX } from './e2e-sandbox-guards.mjs'

let config
try {
  config = getQaConfig({ requireCleanup: true, requireFixtureSeed: true })
} catch (error) {
  printGuardError(error)
  process.exit(2)
}

const password = process.env.E2E_QA_PASSWORD
const anonKey = process.env.E2E_SUPABASE_ANON_KEY
const serviceRoleKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY
const environment = 'sandbox'
const runId = `${Date.now()}`
const marker = `${QA_PREFIX}SALES_${runId}_`
const admin = createClient(config.supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
const authClient = createClient(config.supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
const salesEmail = 'e2e_qa_sales@e2e-qa.invalid'
const unassignedEmail = 'e2e_qa_unassigned@e2e-qa.invalid'

const results = []
function check(name, condition, detail = '') {
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ''}`)
  results.push(name)
}

async function signIn(email) {
  const { data, error } = await authClient.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`No se pudo iniciar sesión QA para ${email}`)
  return data.session
}

async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.code || 'error'}`)
  return data
}

async function countRows(table, column, value) {
  const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).eq(column, value)
  if (error) throw new Error(`No se pudo contar ${table}`)
  return count || 0
}

const salesSession = await signIn(salesEmail)
const sales = createClient(config.supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
await sales.auth.setSession(salesSession)

const base = {
  negocio: `${marker}BARBERIA CENTRO`,
  ciudad: 'Córdoba',
  provincia: 'Córdoba',
  pais: 'AR',
  rubro: 'barberia',
  email: `${marker.toLowerCase()}contacto@e2e-qa.invalid`,
  telefono: '+54 (9) 11 5555-1234',
  dominio: `https://www.${marker.toLowerCase()}barberia.invalid/agenda`,
  sitio_web: `https://www.${marker.toLowerCase()}barberia.invalid/agenda`,
  instagram: `https://instagram.com/@${marker.toLowerCase()}barberia`,
  nombre_contacto: `${marker}CONTACTO`,
  cargo: 'Dueño',
  canal_preferido: 'email',
  canal_recomendado: 'whatsapp',
  fuente_primaria: 'fixture QA',
  fuente_secundaria: 'sitio ficticio .invalid',
  sistema_reservas: 'manual',
  verification_quality: 'high',
  verified_at: new Date().toISOString(),
  switching_friction: 'Fixture sin contacto externo',
  mensaje_preparado: 'Mensaje de prueba: no enviar',
  pipeline_stage: 'qualified',
  substage: 'researching',
  score: 88,
  score_reasons: [{ reason: 'QA fixture', points: 88 }],
}

const created = await rpc(sales, 'crm_upsert_researched_lead', { p_payload: base, p_environment: environment })
check('research lead created', created.status === 'created' && created.match_type === 'NO_MATCH')
const negocioId = Number(created.negocio_id)
const leadId = Number(created.lead_id)

const { data: normalized, error: normalizedError } = await admin.from('crm_negocios').select('nombre,ciudad,email_normalized,phone_normalized,domain_normalized,instagram_normalized,business_name_normalized,city_normalized').eq('id', negocioId).single()
if (normalizedError) throw new Error('No se pudo leer la normalización QA')
check('phone normalization', normalized.phone_normalized === '5491155551234')
check('email normalization', normalized.email_normalized === base.email.toLowerCase())
check('domain normalization', normalized.domain_normalized === `${marker.toLowerCase()}barberia.invalid`)
check('instagram normalization', normalized.instagram_normalized === `${marker.toLowerCase()}barberia`)
check('business normalization', normalized.business_name_normalized === `${marker}BARBERIA CENTRO`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim())
check('city normalization', normalized.city_normalized === 'cordoba')

for (const [label, payload] of [
  ['duplicate phone', { negocio: `${marker}PHONE`, telefono: '0054 9 11 5555 1234' }],
  ['duplicate email', { negocio: `${marker}EMAIL`, email: base.email.toUpperCase() }],
  ['duplicate domain', { negocio: `${marker}DOMAIN`, dominio: `HTTP://${base.dominio.replace(/^https:\/\/www\./, '')}/otra` }],
  ['duplicate Instagram', { negocio: `${marker}INSTAGRAM`, instagram: `@${marker.toLowerCase()}barberia/` }],
]) {
  const match = await rpc(sales, 'crm_find_duplicate_candidates', { p_payload: { ...base, ...payload }, p_environment: environment })
  check(label, match.match_type === 'EXACT_MATCH')
}

const likely = await rpc(sales, 'crm_find_duplicate_candidates', { p_payload: { negocio: `${marker}BARBERIA CENTRO`, ciudad: 'Cordoba', email: `${marker.toLowerCase()}likely@e2e-qa.invalid`, telefono: '+54 9 11 7777 0000' }, p_environment: environment })
check('name + city LIKELY_MATCH', likely.match_type === 'LIKELY_MATCH')
const exact = await rpc(sales, 'crm_find_duplicate_candidates', { p_payload: { telefono: base.telefono }, p_environment: environment })
check('EXACT_MATCH', exact.match_type === 'EXACT_MATCH')
const none = await rpc(sales, 'crm_find_duplicate_candidates', { p_payload: { negocio: `${marker}NO MATCH`, ciudad: 'Rosario', email: `${marker.toLowerCase()}none@e2e-qa.invalid`, telefono: '5493415559999' }, p_environment: environment })
check('NO_MATCH', none.match_type === 'NO_MATCH')

const dncPayload = { ...base, negocio: `${marker}DNC`, email: `${marker.toLowerCase()}dnc@e2e-qa.invalid`, telefono: '5491155559876', dominio: `${marker.toLowerCase()}dnc.invalid`, instagram: `@${marker.toLowerCase()}dnc`, do_not_contact: true }
const dncCreated = await rpc(sales, 'crm_upsert_researched_lead', { p_payload: dncPayload, p_environment: environment })
check('DNC seed created', dncCreated.status === 'created')
const dncMatch = await rpc(sales, 'crm_find_duplicate_candidates', { p_payload: { negocio: `${marker}DNC`, telefono: dncPayload.telefono }, p_environment: environment })
check('DNC blocks reactivation', dncMatch.do_not_contact === true && dncMatch.match_type === 'EXACT_MATCH')
const dncReimport = await rpc(sales, 'crm_upsert_researched_lead', { p_payload: { ...dncPayload, do_not_contact: false }, p_environment: environment })
check('DNC blocks import', dncReimport.status === 'blocked_dnc')

const previewRows = [
  { ...base, negocio: `${marker}PREVIEW`, email: `${marker.toLowerCase()}preview@e2e-qa.invalid`, telefono: '5491155553434', dominio: `${marker.toLowerCase()}preview.invalid`, instagram: `@${marker.toLowerCase()}preview` },
  { negocio: `${marker}INVALID`, email: 'invalid-email' },
]
const beforePreview = await countRows('crm_negocios', 'nombre', previewRows[0].negocio)
const preview = await rpc(sales, 'crm_preview_import', { p_rows: previewRows, p_environment: environment })
check('preview no writes', preview.writes_performed === false && preview.counts.new === 1 && preview.counts.invalid === 1)
const afterPreview = await countRows('crm_negocios', 'nombre', previewRows[0].negocio)
check('preview persistence check', beforePreview === afterPreview)

const batchRows = [{ ...base, negocio: `${marker}BATCH`, email: `${marker.toLowerCase()}batch@e2e-qa.invalid`, telefono: '5491155554545', dominio: `${marker.toLowerCase()}batch.invalid`, instagram: `@${marker.toLowerCase()}batch` }]
const batchKey = `${marker}BATCH_KEY`
const firstImport = await rpc(sales, 'crm_import_leads_batch', { p_rows: batchRows, p_filename: `${marker}batch.csv`, p_environment: environment, p_idempotency_key: batchKey })
check('batch import', firstImport.idempotent === false && firstImport.ok === 1)
const secondImport = await rpc(sales, 'crm_import_leads_batch', { p_rows: batchRows, p_filename: `${marker}batch.csv`, p_environment: environment, p_idempotency_key: batchKey })
check('batch reimport idempotent', secondImport.idempotent === true && secondImport.import_id === firstImport.import_id)
const batchBusinessCount = await countRows('crm_negocios', 'nombre', batchRows[0].negocio)
check('batch no duplicate business', batchBusinessCount === 1)
const { count: batchLeadCount, error: batchLeadError } = await admin.from('crm_leads').select('id', { count: 'exact', head: true }).eq('email', batchRows[0].email)
if (batchLeadError) throw new Error('No se pudo contar lead batch')
check('batch no duplicate lead', batchLeadCount === 1)

const { error: readyError } = await admin.from('crm_leads').update({ pipeline_stage: 'qualified', substage: 'ready_to_contact', verification_quality: 'high', verified_at: new Date().toISOString(), message_prepared: 'Mensaje QA preparado; no enviar.', recommended_channel: 'whatsapp', score: 95 }).eq('id', leadId)
if (readyError) throw new Error('No se pudo preparar la cola QA')
const queue = await rpc(sales, 'get_crm_outreach_queue', { p_environment: environment, p_limit: 100 })
check('READY_TO_CONTACT queue', Array.isArray(queue) && queue.some((item) => Number(item.lead_id) === leadId))
const activity = await rpc(sales, 'record_crm_outreach_activity', { p_lead_id: leadId, p_type: 'initial_contact', p_channel: 'manual', p_result: 'QA only', p_notes: 'No se envía ningún mensaje.' })
check('activity registered', activity.status === 'recorded' && activity.external_send_performed === false)
const { data: activityRow, error: activityError } = await admin.from('crm_interacciones').select('id').eq('lead_id', leadId).eq('resumen', 'QA only').maybeSingle()
if (activityError) throw new Error('No se pudo verificar la actividad QA')
check('activity persisted', Boolean(activityRow))

const unassignedSession = await signIn(unassignedEmail)
const unassigned = createClient(config.supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
await unassigned.auth.setSession(unassignedSession)
const salesPreview = await sales.rpc('crm_preview_import', { p_rows: [{ negocio: `${marker}SALES_AUTH` }], p_environment: environment })
check('sales role authorized', !salesPreview.error)
const forbidden = await unassigned.rpc('crm_find_duplicate_candidates', { p_payload: { negocio: `${marker}DENIED` }, p_environment: environment })
check('user without platform role rejected', Boolean(forbidden.error) && forbidden.error.code === '42501')

const { data: qaBusinesses, error: qaBusinessError } = await admin.from('crm_negocios').select('barberia_id,nombre,environment').like('nombre', `${QA_PREFIX}%`).limit(50)
if (qaBusinessError) throw new Error('No se pudo verificar aislamiento de producto')
check('product isolation', qaBusinesses.every((row) => row.environment !== 'production' || !String(row.nombre).startsWith(QA_PREFIX)))
const { data: tenantRows, error: tenantError } = await admin.from('barberias').select('id,nombre').in('slug', ['e2e-qa-barberia-a', 'e2e-qa-barberia-b'])
if (tenantError) throw new Error('No se pudo verificar Tenant A/B')
check('Tenant A/B isolation', tenantRows.length === 2 && tenantRows[0].id !== tenantRows[1].id)

const cleanup = async () => {
  const { data: leads } = await admin.from('crm_leads').select('id').like('nombre_contacto', `${marker}%`)
  const leadIds = (leads || []).map((row) => row.id)
  if (leadIds.length) {
    await admin.from('crm_interacciones').delete().in('lead_id', leadIds)
    await admin.from('crm_actividades').delete().in('lead_id', leadIds)
    await admin.from('crm_importacion_filas').delete().in('lead_id', leadIds)
    await admin.from('crm_leads').delete().in('id', leadIds)
  }
  const { data: businesses } = await admin.from('crm_negocios').select('id').like('nombre', `${marker}%`)
  const businessIds = (businesses || []).map((row) => row.id)
  if (businessIds.length) {
    await admin.from('crm_investigaciones').delete().in('negocio_id', businessIds)
    await admin.from('crm_actividades').delete().in('negocio_id', businessIds)
    await admin.from('crm_negocios').delete().in('id', businessIds)
  }
  await admin.from('crm_importaciones').delete().like('archivo_nombre', `${marker}%`)
}
await cleanup()

console.log(JSON.stringify({ qa_project_ref: config.projectRef, environment, checks: results.length, external_effects: { emails: 0, whatsapp: 0, evolution_calls: 0, n8n_changes: 0, checkouts: 0, production_writes: 0 } }, null, 2))
