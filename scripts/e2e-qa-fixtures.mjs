import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { getQaConfig, printGuardError, QA_PREFIX } from './e2e-sandbox-guards.mjs'

const execute = process.argv.includes('--execute')
let config
try {
  config = getQaConfig({ requireFixtureSeed: execute })
} catch (error) {
  printGuardError(error)
  process.exit(2)
}

const tenants = [
  { key: 'A', name: `${QA_PREFIX}BARBERIA_A`, slug: 'e2e-qa-barberia-a' },
  { key: 'B', name: `${QA_PREFIX}BARBERIA_B`, slug: 'e2e-qa-barberia-b' },
]

const users = [
  ['ownerA', 'e2e_qa_owner_a@e2e-qa.invalid', 'owner', 'A'],
  ['adminA', 'e2e_qa_admin_a@e2e-qa.invalid', 'admin', 'A'],
  ['receptionA', 'e2e_qa_reception_a@e2e-qa.invalid', 'recepcionista', 'A'],
  ['employeeA', 'e2e_qa_employee_a@e2e-qa.invalid', 'empleado', 'A'],
  ['readonlyA', 'e2e_qa_readonly_a@e2e-qa.invalid', 'readonly', 'A'],
  ['ownerB', 'e2e_qa_owner_b@e2e-qa.invalid', 'owner', 'B'],
  ['platformOwner', 'e2e_qa_platform_owner@e2e-qa.invalid', 'platform:owner', null],
  ['platformAdmin', 'e2e_qa_platform_admin@e2e-qa.invalid', 'platform:admin', null],
  ['sales', 'e2e_qa_sales@e2e-qa.invalid', 'platform:sales', null],
  ['support', 'e2e_qa_support@e2e-qa.invalid', 'platform:support', null],
  ['platformReadonly', 'e2e_qa_platform_readonly@e2e-qa.invalid', 'platform:readonly', null],
]

if (!execute) {
  console.log(JSON.stringify({ dry_run: true, tenants: tenants.map((tenant) => tenant.slug), users: users.length, external_providers: 'disabled' }, null, 2))
  process.exit(0)
}

const admin = createClient(config.supabaseUrl, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const userIds = new Map()

async function ensureUser(key, email, role) {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (listError) throw new Error('No se pudo auditar Auth QA antes de crear usuarios.')
  const existing = listed.users.find((user) => user.email?.toLowerCase() === email)
  if (existing && existing.user_metadata?.e2e_prefix !== QA_PREFIX) throw new Error(`Usuario QA existente sin marca segura: ${key}`)
  if (existing) {
    if (existing.user_metadata?.environment !== config.environment) throw new Error(`Usuario QA existente en un entorno inesperado: ${key}`)
    const { error: metadataError } = await admin.auth.admin.updateUserById(existing.id, { user_metadata: { ...existing.user_metadata, e2e_prefix: QA_PREFIX, environment: config.environment, qa_role: role } })
    if (metadataError) throw new Error(`No se pudo validar el metadata del usuario QA ${key}.`)
    userIds.set(key, existing.id)
    return existing.id
  }
  const { data, error } = await admin.auth.admin.createUser({ email, password: process.env.E2E_QA_PASSWORD, email_confirm: true, user_metadata: { e2e_prefix: QA_PREFIX, environment: config.environment, qa_role: role } })
  if (error || !data.user) throw new Error(`No se pudo crear usuario QA ${key}.`)
  userIds.set(key, data.user.id)
  return data.user.id
}

for (const [key, email, role] of users) await ensureUser(key, email, role)

for (const [key, email] of users) {
  const userId = userIds.get(key)
  const { error } = await admin.from('profiles').upsert({ id: userId, full_name: `${QA_PREFIX}${key}`, avatar_url: null }, { onConflict: 'id' })
  if (error) throw new Error(`No se pudo preparar el perfil QA ${email}.`)
}

const tenantIds = new Map()
for (const tenant of tenants) {
  const { data, error } = await admin.from('barberias').upsert({
    nombre: tenant.name,
    slug: tenant.slug,
    vertical: 'barberia',
    estado_cuenta: 'trial',
    plan_codigo: 'starter',
    locale: 'es-AR',
    pais: 'QA',
    moneda: 'ARS',
    logo_url: `https://e2e-qa.invalid/${tenant.key.toLowerCase()}-logo.svg`,
    color_principal: tenant.key === 'A' ? '#9B6A2F' : '#3E6F87',
    color_secundario: tenant.key === 'A' ? '#F3E8D6' : '#DDECF2',
    reservas_publicas: true,
    onboarding_completed: true,
    metadata: { environment: config.environment, e2e_prefix: QA_PREFIX, fixture: true, external_providers: 'disabled' },
  }, { onConflict: 'slug' }).select('id,slug').single()
  if (error || !data) throw new Error(`No se pudo preparar el tenant QA ${tenant.slug}.`)
  tenantIds.set(tenant.key, data.id)
}

for (const [key, email, role, tenantKey] of users) {
  const userId = userIds.get(key)
  if (role.startsWith('platform:')) {
    const { error } = await admin.from('platform_members').upsert({ user_id: userId, role: role.split(':')[1] }, { onConflict: 'user_id' })
    if (error) throw new Error(`No se pudo preparar el rol de plataforma ${email}.`)
  } else {
    const { error } = await admin.from('barberia_members').upsert({ barberia_id: tenantIds.get(tenantKey), user_id: userId, role }, { onConflict: 'barberia_id,user_id' })
    if (error) throw new Error(`No se pudo preparar el rol tenant ${email}.`)
  }
}

for (const tenant of tenants) {
  const barberiaId = tenantIds.get(tenant.key)
  const { data: service, error: serviceError } = await admin.from('servicios').upsert({ barberia_id: barberiaId, nombre: `${QA_PREFIX}${tenant.key}_SERVICIO`, descripcion: 'Fixture QA no productivo', precio: 15000, duracion_min: 30, activo: true }, { onConflict: 'barberia_id,nombre' }).select('id').single()
  if (serviceError || !service) throw new Error(`No se pudo preparar el servicio QA ${tenant.key}.`)
  const employeeUserId = tenant.key === 'A' ? userIds.get('employeeA') : null
  const { data: barber, error: barberError } = await admin.from('barberos').upsert({ barberia_id: barberiaId, user_id: employeeUserId, nombre: `${QA_PREFIX}${tenant.key}_EMPLEADO`, especialidad: 'Fixture QA', color: tenant.key === 'A' ? '#9B6A2F' : '#3E6F87', activo: true }, { onConflict: 'barberia_id,nombre' }).select('id').single()
  if (barberError || !barber) throw new Error(`No se pudo preparar el empleado QA ${tenant.key}.`)
  const { error: relationError } = await admin.from('barbero_servicios').upsert({ barbero_id: barber.id, servicio_id: service.id, duracion_min: 30 }, { onConflict: 'barbero_id,servicio_id' })
  if (relationError) throw new Error(`No se pudo preparar la relación empleado-servicio QA ${tenant.key}.`)
  const { error: scheduleError } = await admin.from('horarios_barbero').upsert({ barberia_id: barberiaId, barbero_id: barber.id, day_of_week: 1, start_time: '09:00:00', end_time: '18:00:00', activo: true }, { onConflict: 'barbero_id,day_of_week,start_time,end_time' })
  if (scheduleError) throw new Error(`No se pudo preparar el horario QA ${tenant.key}.`)
  const { error: configError } = await admin.from('config').upsert([
    { barberia_id: barberiaId, clave: 'horarios_default', valor: JSON.stringify({ e2e_prefix: QA_PREFIX, environment: config.environment }) },
    { barberia_id: barberiaId, clave: 'reservas_config', valor: JSON.stringify({ e2e_prefix: QA_PREFIX, environment: config.environment, intervalo_min: 30, anticipacion_horas: 1, max_dias: 60 }) },
    { barberia_id: barberiaId, clave: 'branding', valor: JSON.stringify({ e2e_prefix: QA_PREFIX, environment: config.environment, logo_url: `https://e2e-qa.invalid/${tenant.key.toLowerCase()}-logo.svg` }) },
  ], { onConflict: 'barberia_id,clave' })
  if (configError) throw new Error(`No se pudo preparar la configuración QA ${tenant.key}.`)
  const { data: client, error: clientError } = await admin.from('clientes').upsert({ barberia_id: barberiaId, nombre: `${QA_PREFIX}${tenant.key}_CLIENTE`, apellido: 'Fixture', telefono: tenant.key === 'A' ? '000000000001' : '000000000002', email: `e2e_qa_client_${tenant.key.toLowerCase()}@e2e-qa.invalid`, notas: 'Fixture QA eliminable' }, { onConflict: 'barberia_id,telefono' }).select('id').single()
  if (clientError || !client) throw new Error(`No se pudo preparar el cliente QA ${tenant.key}.`)
  const blockMotivo = `${QA_PREFIX}${tenant.key}_BREAK`
  const { data: existingBlock, error: blockLookupError } = await admin.from('bloqueos_agenda').select('id').eq('barberia_id', barberiaId).eq('barbero_id', barber.id).eq('fecha', '2099-01-02').eq('start_time', '13:00:00').eq('end_time', '14:00:00').eq('motivo', blockMotivo).maybeSingle()
  if (blockLookupError) throw new Error(`No se pudo auditar el break QA ${tenant.key}.`)
  if (!existingBlock) {
    const { error: blockError } = await admin.from('bloqueos_agenda').insert({ barberia_id: barberiaId, barbero_id: barber.id, fecha: '2099-01-02', start_time: '13:00:00', end_time: '14:00:00', motivo: blockMotivo, tipo: 'bloqueo' })
    if (blockError) throw new Error(`No se pudo preparar el break QA ${tenant.key}.`)
  }
  const { data: existingTurn, error: turnLookupError } = await admin.from('turnos').select('id').eq('barberia_id', barberiaId).eq('fecha', '2099-01-02').eq('hora', '10:00').eq('paciente', `${QA_PREFIX}${tenant.key}_CLIENTE`).maybeSingle()
  if (turnLookupError) throw new Error(`No se pudo auditar el turno QA ${tenant.key}.`)
  if (!existingTurn) {
    const { error: turnError } = await admin.from('turnos').insert({ barberia_id: barberiaId, cliente_id: client.id, barbero_id: barber.id, servicio_id: service.id, paciente: `${QA_PREFIX}${tenant.key}_CLIENTE`, telefono: tenant.key === 'A' ? '000000000001' : '000000000002', fecha: '2099-01-02', hora: '10:00', motivo: `${QA_PREFIX}${tenant.key}_SERVICIO`, estado: 'confirmado', precio: 15000, duracion_min: 30, origen: 'panel' })
    if (turnError) throw new Error(`No se pudo preparar el turno QA ${tenant.key}.`)
  }
  const { error: integrationError } = await admin.from('saas_integraciones').upsert({ barberia_id: barberiaId, proveedor: 'evolution', estado: 'desactivado', base_url: 'https://e2e-qa.invalid', referencia_externa: `${QA_PREFIX}${tenant.key}_MOCK`, metadata: { environment: config.environment, e2e_prefix: QA_PREFIX, mode: 'shadow', external_provider: false } }, { onConflict: 'barberia_id,proveedor' })
  if (integrationError) throw new Error(`No se pudo preparar la integración mock QA ${tenant.key}.`)

  const crmEmail = `e2e_qa_business_${tenant.key.toLowerCase()}@e2e-qa.invalid`
  const { data: existingBusiness, error: businessLookupError } = await admin.from('crm_negocios').select('id').eq('barberia_id', barberiaId).maybeSingle()
  if (businessLookupError) throw new Error(`No se pudo auditar el negocio CRM QA ${tenant.key}.`)
  let negocioId = existingBusiness?.id
  if (!negocioId) {
    const { data: business, error: businessError } = await admin.from('crm_negocios').insert({ barberia_id: barberiaId, nombre: `${QA_PREFIX}${tenant.key}_NEGOCIO`, rubro: 'barberia', pais: 'QA', idioma: 'es', zona_horaria: 'America/Argentina/Buenos_Aires', email: crmEmail, canal_origen: 'e2e_qa', etapa: 'prueba', moneda: 'ARS', environment: config.environment, pipeline_stage: 'trial', metadata: { environment: config.environment, e2e_prefix: QA_PREFIX, fixture: true } }).select('id').single()
    if (businessError || !business) throw new Error(`No se pudo preparar el negocio CRM QA ${tenant.key}.`)
    negocioId = business.id
  } else {
    const { error: businessUpdateError } = await admin.from('crm_negocios').update({ nombre: `${QA_PREFIX}${tenant.key}_NEGOCIO`, rubro: 'barberia', pais: 'QA', idioma: 'es', zona_horaria: 'America/Argentina/Buenos_Aires', email: crmEmail, canal_origen: 'e2e_qa', etapa: 'prueba', moneda: 'ARS', environment: config.environment, pipeline_stage: 'trial', metadata: { environment: config.environment, e2e_prefix: QA_PREFIX, fixture: true } }).eq('id', negocioId)
    if (businessUpdateError) throw new Error(`No se pudo actualizar el negocio CRM QA ${tenant.key}.`)
  }
  const leadDedupeKey = `${QA_PREFIX}${tenant.key}_LEAD`.toLowerCase()
  const { data: existingLead, error: leadLookupError } = await admin.from('crm_leads').select('id').eq('dedupe_key', leadDedupeKey).maybeSingle()
  if (leadLookupError) throw new Error(`No se pudo auditar el lead CRM QA ${tenant.key}.`)
  if (!existingLead) {
    const { error: leadError } = await admin.from('crm_leads').insert({ negocio_id: negocioId, nombre_contacto: `${QA_PREFIX}${tenant.key}_CONTACTO`, email: `e2e_qa_lead_${tenant.key.toLowerCase()}@e2e-qa.invalid`, telefono: tenant.key === 'A' ? '000000000011' : '000000000012', canal_preferido: 'mock', pipeline_stage: 'trial', estado_conversacion: 'interesado', interes: 'qa', dedupe_key: leadDedupeKey, environment: config.environment, metadata: { environment: config.environment, e2e_prefix: QA_PREFIX, fixture: true } })
    if (leadError) throw new Error(`No se pudo preparar el lead CRM QA ${tenant.key}.`)
  } else {
    const { error: leadUpdateError } = await admin.from('crm_leads').update({ negocio_id: negocioId, nombre_contacto: `${QA_PREFIX}${tenant.key}_CONTACTO`, email: `e2e_qa_lead_${tenant.key.toLowerCase()}@e2e-qa.invalid`, telefono: tenant.key === 'A' ? '000000000011' : '000000000012', canal_preferido: 'mock', pipeline_stage: 'trial', estado_conversacion: 'interesado', interes: 'qa', dedupe_key: leadDedupeKey, environment: config.environment, metadata: { environment: config.environment, e2e_prefix: QA_PREFIX, fixture: true } }).eq('id', existingLead.id)
    if (leadUpdateError) throw new Error(`No se pudo actualizar el lead CRM QA ${tenant.key}.`)
  }
}

console.log(JSON.stringify({ fixtures: 'created_or_reused', tenants: tenants.length, users: users.length, external_providers: 'disabled', prefix: QA_PREFIX }, null, 2))
