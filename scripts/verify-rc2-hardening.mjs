import assert from 'node:assert/strict'
import fs from 'node:fs'

const normalizeLineEndings = (text) => text.replace(/\r\n?/g, '\n')
const read = (file) => normalizeLineEndings(fs.readFileSync(file, 'utf8'))

assert.equal(normalizeLineEndings('a\nb'), normalizeLineEndings('a\r\nb'))
assert.equal(normalizeLineEndings('a\nb'), normalizeLineEndings('a\rb'))

const app = read('src/App.jsx')
const providers = read('supabase/functions/_shared/providers.ts')
const billingApi = read('supabase/functions/billing-api/index.ts')

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

// Sandbox billing is restricted to the unique active provider/environment
// binding; no tenant id is an authorization signal.
assert.match(billingApi, /sandboxOnly = false/)
assert.match(billingApi, /resolveSandboxScope/)
assert.doesNotMatch(billingApi, /sandboxOnly && tenantId !== SANDBOX_BILLING\.tenantId/)
assert.match(billingApi, /checkoutTenant\(admin, userId, requestedTenantId == null \? \{\} : \{ tenant_id: requestedTenantId \}, \{ sandboxOnly: true \}\)/)
assert.match(billingApi, /checkoutTenant\(admin, userId, body, \{ sandboxOnly: provider === 'mercadopago' \}\)/)

console.log('RC2 hardening checks passed: PII-safe realtime logs, fail-closed provider environment/HMAC y sandbox billing scoped.')
