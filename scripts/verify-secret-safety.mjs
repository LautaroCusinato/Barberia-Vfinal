import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.endsWith('package-lock.json') && file !== 'scripts/verify-secret-safety.mjs')
  .filter((file) => /\.(?:js|jsx|mjs|ts|tsx|json|sql|md|ya?ml|toml|env(?:\..*)?)$/i.test(file))

const signatures = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['openai_style_key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['supabase_secret_key', /\bsb_secret_[A-Za-z0-9_-]{20,}\b/],
  ['aws_access_key', /\bAKIA[0-9A-Z]{16}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
]
const findings = []
for (const file of files) {
  const content = fs.readFileSync(file, 'utf8')
  for (const [kind, pattern] of signatures) if (pattern.test(content)) findings.push({ file, kind })
}
assert.deepEqual(findings, [], `Potential secrets found in: ${findings.map((item) => `${item.file} (${item.kind})`).join(', ')}`)
console.log(JSON.stringify({ suite: 'secret-safety', files_scanned: files.length, findings: 0, result: 'PASS' }))
