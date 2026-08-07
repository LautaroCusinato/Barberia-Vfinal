import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)
const ignored = /(^|\/)(node_modules|dist|test-results|playwright-report)\//
const secret = /(-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:password|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"$]{12,}['"])/i
const findings = []
for (const file of tracked) {
  if (ignored.test(file) || file === '.env.example' || file.endsWith('.env.example')) continue
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  if (secret.test(text) && !/^scripts\/verify-/.test(file)) findings.push(file)
}
if (findings.length) { console.error(`Posibles secretos en: ${findings.join(', ')}`); process.exit(1) }
console.log(`Secret scan OK: ${tracked.length} archivos rastreados revisados.`)
