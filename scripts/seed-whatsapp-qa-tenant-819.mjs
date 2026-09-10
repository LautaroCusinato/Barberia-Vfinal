import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { getQaConfig, printGuardError, QA_PREFIX } from './e2e-sandbox-guards.mjs'

const TENANT_ID = 819
const SERVICE_NAME = 'Corte clásico'
const SERVICE_PRICE = 30000
const SERVICE_DURATION = 30
const BARBER_NAME = `${QA_PREFIX}819_BARBERO`
const BLOCK_REASON = `${QA_PREFIX}819_BREAK`
const execute = process.argv.includes('--execute')

if (!execute) {
  console.log(JSON.stringify({
    mode: 'plan_only',
    applies_changes: false,
    tenant_id: TENANT_ID,
    service: SERVICE_NAME,
    price_ars: SERVICE_PRICE,
    duration_min: SERVICE_DURATION,
    external_providers: 'disabled',
    writes: 'not executed',
  }, null, 2))
  process.exit(0)
}

let config
try {
  config = getQaConfig({ requireFixtureSeed: execute })
} catch (error) {
  printGuardError(error)
  process.exit(2)
}

const admin = createClient(config.supabaseUrl, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const { data: tenant, error: tenantError } = await admin.from('barberias').select('id,slug,metadata').eq('id', TENANT_ID).maybeSingle()
if (tenantError || !tenant) throw new Error('QA tenant 819 no encontrado; no se escribió ningún fixture.')
const metadata = tenant.metadata && typeof tenant.metadata === 'object' ? tenant.metadata : {}
if (metadata.environment !== 'qa' || metadata.e2e_prefix !== QA_PREFIX) throw new Error('El tenant 819 no tiene marca QA segura; no se escribió ningún fixture.')

const { data: existingService, error: serviceLookupError } = await admin.from('servicios').select('id,descripcion').eq('barberia_id', TENANT_ID).eq('nombre', SERVICE_NAME).maybeSingle()
if (serviceLookupError) throw new Error('No se pudo auditar Corte clásico.')
if (existingService && !String(existingService.descripcion ?? '').startsWith(QA_PREFIX)) throw new Error('Corte clásico existente no marcado como fixture QA; no se sobrescribe.')
const { data: service, error: serviceError } = await admin.from('servicios').upsert({
  barberia_id: TENANT_ID,
  nombre: SERVICE_NAME,
  descripcion: `${QA_PREFIX}819 servicio natural para pruebas`,
  precio: SERVICE_PRICE,
  duracion_min: SERVICE_DURATION,
  activo: true,
}, { onConflict: 'barberia_id,nombre' }).select('id,nombre,precio,duracion_min').single()
if (serviceError || !service) throw new Error('No se pudo preparar el servicio QA 819.')

const { data: existingBarber, error: barberLookupError } = await admin.from('barberos').select('id,especialidad').eq('barberia_id', TENANT_ID).eq('nombre', BARBER_NAME).maybeSingle()
if (barberLookupError) throw new Error('No se pudo auditar el barbero QA 819.')
if (existingBarber && !String(existingBarber.especialidad ?? '').startsWith(QA_PREFIX)) throw new Error('Barbero existente no marcado como fixture QA; no se sobrescribe.')
const { data: barber, error: barberError } = await admin.from('barberos').upsert({
  barberia_id: TENANT_ID,
  nombre: BARBER_NAME,
  especialidad: `${QA_PREFIX}819`,
  color: '#9B6A2F',
  activo: true,
}, { onConflict: 'barberia_id,nombre' }).select('id,nombre').single()
if (barberError || !barber) throw new Error('No se pudo preparar el barbero QA 819.')

const { error: relationError } = await admin.from('barbero_servicios').upsert({ barbero_id: barber.id, servicio_id: service.id, duracion_min: SERVICE_DURATION }, { onConflict: 'barbero_id,servicio_id' })
if (relationError) throw new Error('No se pudo preparar la relación servicio-barbero QA 819.')

for (const dayOfWeek of [1, 2, 3, 4, 5]) {
  const { error } = await admin.from('horarios_barbero').upsert({ barberia_id: TENANT_ID, barbero_id: barber.id, day_of_week: dayOfWeek, start_time: '09:00:00', end_time: '18:00:00', activo: true }, { onConflict: 'barbero_id,day_of_week,start_time,end_time' })
  if (error) throw new Error('No se pudo preparar los horarios QA 819.')
}

const nextMonday = new Date()
nextMonday.setHours(12, 0, 0, 0)
nextMonday.setDate(nextMonday.getDate() + (((8 - nextMonday.getDay()) % 7) || 7))
const blockDate = nextMonday.toISOString().slice(0, 10)
const { data: existingBlock, error: blockLookupError } = await admin.from('bloqueos_agenda').select('id').eq('barberia_id', TENANT_ID).eq('barbero_id', barber.id).eq('fecha', blockDate).eq('start_time', '13:00:00').eq('end_time', '14:00:00').eq('motivo', BLOCK_REASON).maybeSingle()
if (blockLookupError) throw new Error('No se pudo auditar el bloqueo QA 819.')
if (!existingBlock) {
  const { error } = await admin.from('bloqueos_agenda').insert({ barberia_id: TENANT_ID, barbero_id: barber.id, fecha: blockDate, start_time: '13:00:00', end_time: '14:00:00', motivo: BLOCK_REASON, tipo: 'bloqueo' })
  if (error) throw new Error('No se pudo preparar el bloqueo QA 819.')
}

console.log(JSON.stringify({
  fixture: 'created_or_reused',
  tenant_id: TENANT_ID,
  service: service.nombre,
  price_ars: service.precio,
  duration_min: service.duracion_min,
  barbero: barber.nombre,
  schedule_days: 5,
  block_date: blockDate,
  writes_to_clients: 0,
  writes_to_turnos: 0,
  external_providers: 'disabled',
}, null, 2))
