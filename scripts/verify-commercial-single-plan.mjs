import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMERCIAL_BILLING_MODE, COMMERCIAL_CATALOG, COMMERCIAL_TRIAL_DAYS } from '../src/lib/commercialCatalog.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const catalog = read('src/lib/commercialCatalog.js')
const landing = read('src/pages/Landing.jsx')
const billing = read('src/pages/Billing.jsx')

assert.equal(COMMERCIAL_CATALOG.length, 1, 'el catálogo público debe tener un único plan')
assert.equal(COMMERCIAL_CATALOG[0].nombre, 'Austral')
assert.equal(COMMERCIAL_CATALOG[0].precio_mensual, 50000)
assert.equal(COMMERCIAL_CATALOG[0].moneda, 'ARS')
assert.equal(COMMERCIAL_CATALOG[0].trial_dias, 15)
assert.equal(COMMERCIAL_TRIAL_DAYS, 15)
assert.equal(COMMERCIAL_BILLING_MODE, 'manual')

assert.match(landing, /Un solo plan/)
assert.match(landing, /ARS 50\.000 por mes/)
assert.match(landing, /15 días gratis/)
assert.match(landing, /¿Tenés más de una sucursal\? Lo vemos según tu caso\./)
assert.match(landing, /Probar gratis 15 días/)
assert.match(billing, /Plan Austral/)
assert.match(billing, /Austral incluye .*ARS 50\.000 por mes/)
assert.match(billing, /billing-manual-card/)
assert.match(billing, /no se ofrecen Mercado Pago, PayPal, tarjetas ni suscripciones automáticas/)

for (const source of [landing, billing]) assert.doesNotMatch(source, /\b(?:Starter|Pro|Premium)\b/, 'la UI comercial no debe mostrar tiers heredados')
assert.doesNotMatch(catalog, /nombre:\s*['"](?:Starter|Pro|Premium)['"]/)
assert.doesNotMatch(catalog, /(?:precio_mensual:\s*(?:30000|60000|100000)|Todo Starter|Todo Pro)/)
assert.match(catalog, /VITE_SALES_WHATSAPP_NUMBER/)
assert.match(catalog, /wa\.me/)
for (const source of [catalog, landing, billing]) assert.doesNotMatch(source, /wa\.me\/\d{8,}/, 'el número comercial no debe quedar hardcodeado')
assert.match(billing, /COMMERCIAL_BILLING_MODE/)
assert.match(catalog, /normalizeCommercialBillingMode/)

console.log(JSON.stringify({
  commercial_plan_count: COMMERCIAL_CATALOG.length,
  commercial_plan: COMMERCIAL_CATALOG[0].nombre,
  monthly_price_ars: COMMERCIAL_CATALOG[0].precio_mensual,
  trial_days: COMMERCIAL_TRIAL_DAYS,
  billing_mode: COMMERCIAL_BILLING_MODE,
  legacy_tiers_visible: false,
  sales_number_source: 'VITE_SALES_WHATSAPP_NUMBER',
  hardcoded_sales_phone: false,
}, null, 2))
