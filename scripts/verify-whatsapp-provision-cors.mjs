import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { QA_ALLOWED_ORIGINS, qaCorsOrigin } from '../supabase/functions/_shared/qaCors.mjs'

const source = readFileSync(new URL('../supabase/functions/whatsapp-provision/index.ts', import.meta.url), 'utf8')
const customOrigin = 'https://barberia-qa.cuchitron.lat'
const previewOrigin = 'https://qa-ui-hardening.barberia-qa-pages.pages.dev'

assert.deepEqual(QA_ALLOWED_ORIGINS, [customOrigin, previewOrigin])
assert.equal(qaCorsOrigin(customOrigin, true), customOrigin)
assert.equal(qaCorsOrigin(previewOrigin, true), previewOrigin)
assert.equal(qaCorsOrigin('https://other.pages.dev', true), null)
assert.equal(qaCorsOrigin('https://barberia.cuchitron.lat', true), null)
assert.equal(qaCorsOrigin(customOrigin, false), null)
assert.equal(qaCorsOrigin('', true), null)
assert.match(source, /qaCorsOrigin\(origin, projectRef\(\) === QA_PROJECT_REF\)/)
assert.doesNotMatch(source, /Access-Control-Allow-Origin['"]\s*:\s*['"]\*['"]/)
assert.doesNotMatch(source, /Deno\.env\.get\(['"]APP_BASE_URL['"]\).*allowed/)

console.log(JSON.stringify({
  allowed_origins: QA_ALLOWED_ORIGINS,
  arbitrary_pages_preview: 'rejected',
  production_origin: 'rejected',
  production_runtime: 'rejected',
  wildcard: 'absent',
}, null, 2))
