import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const arg = process.argv.find((entry) => entry.startsWith('--directory='))
const directory = arg ? path.resolve(arg.slice('--directory='.length)) : ''
const root = path.resolve(process.cwd())

const stop = (code) => {
  console.error(JSON.stringify({ backup_verification: 'STOP', code }))
  process.exit(1)
}

if (!directory) stop('backup_directory_required')
if (directory === root || directory.startsWith(root + path.sep)) stop('backup_must_be_outside_repository')
if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) stop('backup_directory_not_found')

const sha256 = (file) => new Promise((resolve, reject) => {
  const hash = crypto.createHash('sha256')
  fs.createReadStream(file)
    .on('error', reject)
    .on('data', (chunk) => hash.update(chunk))
    .on('end', () => resolve(hash.digest('hex')))
})

const candidateFiles = fs.readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(sql|dump|backup)$/i.test(entry.name))
const candidates = await Promise.all(candidateFiles.map(async (entry) => {
    const file = path.join(directory, entry.name)
    const stat = fs.statSync(file)
    return {
      file: entry.name,
      bytes: stat.size,
      modified_at: stat.mtime.toISOString(),
      sha256: await sha256(file),
      non_empty: stat.size >= 1024,
    }
  }))

if (!candidates.length) stop('no_database_backup_artifact')
if (candidates.some((candidate) => !candidate.non_empty)) stop('empty_or_truncated_backup_artifact')

console.log(JSON.stringify({
  backup_artifacts: 'PRESENT',
  outside_repository: true,
  artifacts: candidates,
  restore_drill: 'REQUIRED_SEPARATELY',
}, null, 2))
