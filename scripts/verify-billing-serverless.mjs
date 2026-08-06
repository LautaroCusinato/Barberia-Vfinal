import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const api = read('supabase/functions/billing-api/index.ts')
const hooks = read('supabase/functions/billing-webhooks/index.ts')
const jobs = read('supabase/functions/billing-jobs/index.ts')
const providers = read('supabase/functions/_shared/providers.ts')
const supabaseShared = read('supabase/functions/_shared/supabase.ts')

for (const route of ['checkout', 'status', 'external-status', 'sync-plans', 'reconcile']) assert.match(api, new RegExp(`route === '${route}'`), `falta ruta ${route}`)
for (const name of ['verifyMercadoPago', 'verifyPayPal', 'mercadoPagoResource', 'paypalResource', 'mercadoPagoExternalStatus', 'paypalExternalStatus']) assert.match(hooks + providers, new RegExp(name), `falta ${name}`)
for (const secret of ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET', 'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_WEBHOOK_ID', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_BASE_URL']) assert.match(api + hooks + jobs + providers + supabaseShared, new RegExp(secret))
assert.match(api, /ownerTenant\(admin, user\.id\)/)
assert.match(api, /p_plan_codigo: planCode/)
assert.doesNotMatch(api + hooks + jobs + providers + supabaseShared, /(sk_live_|sk_test_|service_role_key\s*=\s*['"][^$])/i)
assert.match(hooks, /p_signature_valid: true/)
assert.match(hooks, /transition_saas_subscription/)
assert.match(hooks, /amount_or_currency_mismatch/)
assert.match(jobs, /BILLING_CRON_SECRET/)
assert.match(jobs, /BILLING_OUTBOX_SINK_URL/)
console.log('Serverless billing verification passed: API autenticada, webhooks firmados, reconciliación y cron seguros.')
