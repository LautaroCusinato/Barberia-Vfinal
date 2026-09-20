import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { evaluateTenantPreflight } from './lib/whatsappTenantPreflight.mjs'

const inputArgument = process.argv.slice(2).find((argument) => argument.startsWith('--input='))
if (!inputArgument) {
  console.error(JSON.stringify({ status: 'FAIL', code: 'LOCAL_SNAPSHOT_REQUIRED', usage: 'npm run whatsapp:tenant:preflight -- --input=<snapshot.json>' }))
  process.exit(1)
}

const inputPath = path.resolve(inputArgument.slice('--input='.length))
let snapshot
try {
  snapshot = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
} catch {
  console.error(JSON.stringify({ status: 'FAIL', code: 'LOCAL_SNAPSHOT_INVALID' }))
  process.exit(1)
}

const report = evaluateTenantPreflight(snapshot)
console.log(JSON.stringify(report, null, 2))
if (report.status === 'FAIL') process.exitCode = 1

