import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { getQaConfig } from './e2e-sandbox-guards.mjs'
import { buildDeterministicShadowProposal } from '../supabase/functions/_shared/whatsappAgentShadow.mjs'

// Explicit opt-in; only SELECT and the public read-only availability RPC.
if (!process.argv.includes('--live')) {
  console.log(JSON.stringify({ mode: 'plan_only', tenant: 819, writes: 0 }))
  process.exit(0)
}
const config = getQaConfig()
assert.equal(config.projectRef, 'cmsymmszlzikqpvfqjre')
const db = createClient(config.supabaseUrl, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const read = async (query, label) => {
  const { data, error } = await query
  if (error) throw new Error(`QA read failed: ${label} (${error.code ?? 'unknown'})`)
  return data
}
const tenant = await read(db.from('barberias').select('id,slug,metadata,moneda').eq('id', 819).single(), 'tenant')
assert.equal(tenant.metadata.environment, 'qa')
assert.equal(tenant.metadata.e2e_prefix, 'E2E_QA_')
const services = await read(db.from('servicios').select('id,nombre,precio,duracion_min,activo').eq('barberia_id', tenant.id).eq('activo', true), 'services')
const barbers = await read(db.from('barberos').select('id,nombre,activo').eq('barberia_id', tenant.id).eq('activo', true), 'barbers')
const schedules = await read(db.from('horarios_barbero').select('barbero_id,day_of_week,start_time,end_time').eq('barberia_id', tenant.id).eq('activo', true), 'schedules')
const blocks = await read(db.from('bloqueos_agenda').select('fecha,barbero_id,start_time,end_time').eq('barberia_id', tenant.id), 'blocks')
const service = services.find(s => s.nombre === 'Corte clásico')
assert.ok(service)
assert.equal(Number(service.precio), 30000)
assert.ok(barbers.length)
const relations = await read(db.from('barbero_servicios').select('barbero_id,servicio_id,duracion_min').eq('servicio_id', service.id).in('barbero_id', barbers.map(b => b.id)), 'relations')
assert.ok(relations.length)
const block = blocks.find(b => b.fecha >= new Date().toISOString().slice(0, 10))
assert.ok(block, 'Future fixture block required; rerun authorized fixture seed when stale')
const rpc = async (id, date) => read(db.rpc('horarios_disponibles_reserva_publica', { p_slug: tenant.slug, p_servicio_id: id, p_fecha: date }), 'availability')
const slots = await rpc(service.id, block.fecha)
assert.ok(slots.length, 'Fixture must have real availability')
const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))
for (const slot of slots) {
  assert.ok(relations.some(r => r.barbero_id === slot.barbero_id))
  const start = minutes(slot.hora), end = start + slot.duracion_min
  const day = new Date(`${block.fecha}T12:00:00Z`).getUTCDay()
  assert.ok(schedules.some(h => h.barbero_id === slot.barbero_id && h.day_of_week === day && start >= minutes(h.start_time) && end <= minutes(h.end_time)))
  for (const b of blocks.filter(b => b.fecha === block.fecha && (b.barbero_id == null || b.barbero_id === slot.barbero_id))) assert.ok(end <= minutes(b.start_time) || start >= minutes(b.end_time), 'Blocked interval leaked into availability')
}
assert.deepEqual(await rpc(-1, block.fecha), [])
const foreign = await read(db.from('servicios').select('id').eq('barberia_id', 2).limit(1), 'foreign service identity only')
assert.ok(foreign.length, 'Tenant B fixture required')
assert.deepEqual(await rpc(foreign[0].id, block.fecha), [], 'Foreign service must never resolve against tenant 819 slug')
const tenant1 = await read(db.from('barberias').select('id,slug').eq('id', 1).single(), 'QA tenant 1')
const services1 = await read(db.from('servicios').select('id').eq('barberia_id', tenant1.id), 'QA tenant 1 services')
assert.ok(services1.length)
assert.ok(services1.every(s => !services.some(own => own.id === s.id)))
assert.deepEqual(await rpc(services1[0].id, block.fecha), [], 'Tenant 1 service must not resolve for tenant 819')
assert.deepEqual(await read(db.rpc('horarios_disponibles_reserva_publica', { p_slug: tenant1.slug, p_servicio_id: service.id, p_fecha: block.fecha }), 'reverse tenant availability'), [])
const counts = {}
for (const table of ['turnos', 'clientes']) {
  const { count, error } = await db.from(table).select('id', { count: 'exact', head: true }).eq('barberia_id', tenant.id)
  if (error) throw new Error(`QA count failed: ${table} (${error.code ?? 'unknown'})`)
  counts[table] = count
}
assert.equal(tenant.moneda, 'ARS', 'Approved QA catalog currency must come from the business row')
const proposal = buildDeterministicShadowProposal({ text: '¿Cuánto sale el corte?', business: { moneda: tenant.moneda }, services, barbers, schedules, blocks })
assert.equal(proposal.proposed_reply, 'El Corte clásico sale ARS 30.000.')
assert.equal(proposal.mutation_allowed, false)
assert.equal(proposal.outbound_allowed, false)
console.log(JSON.stringify({ tenant: 819, services: services.length, barbers: barbers.length, relations: relations.length, schedules: schedules.length, blocks: blocks.length, slots: slots.length, counts, tenant1_isolation_both_directions: true, blocked_slots_absent: true, outside_hours_absent: true, unknown_service_rejected: true, cross_tenant_service_rejected: true, authoritative_price_reply: proposal.proposed_reply, writes: 0, result: 'PASS' }))
