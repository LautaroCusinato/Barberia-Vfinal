import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('scripts/sql/whatsapp-support-diagnostics.sql', 'utf8')
const executableSql = sql.replace(/^--.*$/gm, '')
const incident = fs.readFileSync('docs/WHATSAPP-PRODUCTION-INCIDENTS.md', 'utf8')
assert.match(sql, /begin transaction read only/i)
assert.match(sql, /where c\.barberia_id = :'tenant_id'::bigint/i)
assert.match(sql, /c\.environment = 'production'/i)
assert.match(sql, /rollback;/i)
assert.doesNotMatch(executableSql, /select\s+\*|phone|jid|message_body|prompt|qr\b|credential|secret/i)
for (const heading of ['Detect', 'Contain', 'Diagnose', 'Recover', 'Verify']) assert.match(incident, new RegExp(`## ${heading}`))
assert.match(incident, /booking_enabled.*outbound_enabled.*automation_enabled/is)
assert.match(incident, /miwsp/i)
assert.match(incident, /Never retry an ambiguous send/i)
console.log(JSON.stringify({ suite: 'whatsapp-production-operations', diagnostics: 'READ_ONLY_MINIMIZED', incident_runbook: 'PASS', result: 'PASS' }))
