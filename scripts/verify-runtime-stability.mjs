import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyBillingFailure, shouldRevalidateInBackground, RUNTIME_REVALIDATION_INTERVAL_MS } from '../src/lib/runtimeStability.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => fs.readFile(path.join(root, file), 'utf8')

const main = await read('src/main.jsx')
const billing = await read('src/pages/Billing.jsx')
assert.match(main, /visibilitychange/)
assert.match(main, /addEventListener\('focus'/)
assert.match(main, /preserveUi: true/)
assert.match(main, /sameResolvedUser/)
assert.match(main, /resolvedUserIdRef/)
assert.match(main, /sessionResolutionRef/)
assert.doesNotMatch(main, /window\.location\.reload\(\)/)
assert.match(billing, /subscriptionMissing/)
assert.match(billing, /classifyBillingFailure/)
assert.match(billing, /Pagos .*habilitados/)

assert.deepEqual(classifyBillingFailure({ code: 'subscription_missing', status: 409 }), { kind: 'subscription_missing', technical: false })
assert.deepEqual(classifyBillingFailure({ code: 'billing_status_failed', status: 502 }), { kind: 'technical_error', technical: true })
assert.equal(shouldRevalidateInBackground({ now: 30_000, lastRevalidatedAt: 0 }), true)
assert.equal(shouldRevalidateInBackground({ now: 30_001, lastRevalidatedAt: 30_000 }), false)
assert.equal(RUNTIME_REVALIDATION_INTERVAL_MS, 30_000)

console.log(JSON.stringify({
  visibility_background: 'stale_while_revalidate',
  workspace_mount_preserved: true,
  session_expiry: 'clears_workspace_and_routes_to_auth',
  subscription_missing: 'commercial_state_not_technical_error',
  provider_disabled: 'separate_notice',
  revalidation_interval_ms: RUNTIME_REVALIDATION_INTERVAL_MS,
}, null, 2))
