import process from 'node:process'

if (process.env.E2E_ALLOW_CLEANUP !== 'true' || !process.env.E2E_SUPABASE_URL || !process.env.E2E_SUPABASE_SERVICE_ROLE_KEY || !process.env.E2E_TEST_PREFIX) {
  console.error('Cleanup bloqueado. Requiere E2E_ALLOW_CLEANUP=true, E2E_TEST_PREFIX, E2E_SUPABASE_URL y E2E_SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(2)
}

const base = `${process.env.E2E_SUPABASE_URL.replace(/\/$/, '')}/rest/v1`
const headers = { apikey: process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.E2E_SUPABASE_SERVICE_ROLE_KEY}` }
const tables = [['crm_leads', 'nombre_contacto'], ['crm_negocios', 'nombre']]

for (const [table, column] of tables) {
  const response = await fetch(`${base}/${table}?${column}=like.${encodeURIComponent(`${process.env.E2E_TEST_PREFIX}*`)}`, { method: 'DELETE', headers })
  if (!response.ok) throw new Error(`No se pudo limpiar ${table}: HTTP ${response.status}`)
}
console.log(`Cleanup sandbox completado para prefijo ${process.env.E2E_TEST_PREFIX}.`)
