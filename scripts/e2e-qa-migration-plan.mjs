import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const migrationsDir = path.resolve('supabase/migrations')
const blocked = new Set([
  '20260806163000_link_barberia_central_evolution.sql',
  '20260807070000_mercadopago_sandbox_tenant.sql',
])

const files = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort()
const sensitive = []
for (const file of files) {
  const content = (await readFile(path.join(migrationsDir, file), 'utf8')).toLowerCase()
  if (/(barber[ií]a central|miwsp|mercadopago|evolution|production)/i.test(content)) sensitive.push(file)
}

console.log(JSON.stringify({
  mode: 'plan_only',
  applies_changes: false,
  total_migrations: files.length,
  blocked_for_qa: [...blocked].filter((file) => files.includes(file)),
  sensitive_for_manual_review: sensitive,
  safe_candidates: files.filter((file) => !blocked.has(file) && !sensitive.includes(file)),
  next_step: 'review_sensitive_for_manual_qa_before_applying',
}, null, 2))
