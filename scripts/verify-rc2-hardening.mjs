import assert from 'node:assert/strict'
import fs from 'node:fs'

const app = fs.readFileSync('src/App.jsx', 'utf8')
const providers = fs.readFileSync('supabase/functions/_shared/providers.ts', 'utf8')
const billingApi = fs.readFileSync('supabase/functions/billing-api/index.ts', 'utf8')

// Realtime must never print message payloads, which can contain customer PII.
assert.doesNotMatch(app, /console\.log\('\[realtime\] evento en mensajes:',\s*payload\)/)
assert.match(app, /console\.debug\('\[realtime\] mensaje actualizado',\s*\{\s*event:\s*payload\.event\s*\}\)/)
assert.doesNotMatch(app, /console\.error\('\[realtime\] problema con la suscripcion:',\s*status,\s*err\)/)

// Mercado Pago must fail closed when the environment is missing; never infer
// sandbox from an absent variable.
assert.match(providers, /Deno\.env\.get\('MERCADOPAGO_ENVIRONMENT'\) \|\| ''/)
assert.match(providers, /invalid_provider_environment/)

// Invalid HMAC requests are rejected before any provider identity lookup.
const verifyStart = providers.indexOf('export async function verifyMercadoPago')
const verifyEnd = providers.indexOf('\n}\n\nexport async function mercadoPagoResource', verifyStart)
assert.ok(verifyStart >= 0 && verifyEnd > verifyStart)
const verifyBlock = providers.slice(verifyStart, verifyEnd)
assert.ok(verifyBlock.indexOf('const valid =') < verifyBlock.indexOf('await mercadoPagoWebhookIdentity()'))
assert.match(verifyBlock, /if \(!valid\) return false/)

// Sandbox billing remains restricted to the one technical tenant.
assert.match(billingApi, /sandboxOnly = false/)
assert.match(billingApi, /sandboxOnly && tenantId !== SANDBOX_BILLING\.tenantId/)
assert.match(billingApi, /checkoutTenant\(admin, userId, \{ tenant_id: requestedTenantId \}, \{ sandboxOnly: true \}\)/)
assert.match(billingApi, /checkoutTenant\(admin, userId, body, \{ sandboxOnly: provider === 'mercadopago' \}\)/)

console.log('RC2 hardening checks passed: PII-safe realtime logs, fail-closed provider environment/HMAC y sandbox billing scoped.')
