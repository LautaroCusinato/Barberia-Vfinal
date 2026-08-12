import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_INSTANCE = 'miwsp'
export const DEFAULT_HEADER_NAME = 'X-Austral-Webhook-Secret'
export const DEFAULT_BACKUP_PATH = path.join(os.tmpdir(), 'austral-miwsps-webhook-backup.json')

const clone = (value) => JSON.parse(JSON.stringify(value ?? {}))

export const extractWebhookConfig = (response) => {
  if (response?.webhook && typeof response.webhook === 'object') return clone(response.webhook)
  if (response?.data?.webhook && typeof response.data.webhook === 'object') return clone(response.data.webhook)
  if (response?.data && typeof response.data === 'object' && !Array.isArray(response.data)) return clone(response.data)
  return clone(response)
}

const sanitizeUrl = (value) => {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return '[configured]'
  }
}

/** Report only non-sensitive webhook metadata. Header values are never returned. */
export const sanitizeWebhookConfig = (config) => ({
  enabled: config?.enabled === true,
  url: sanitizeUrl(config?.url),
  events: Array.isArray(config?.events) ? [...config.events] : [],
  base64: config?.base64 === true,
  webhook_by_events: config?.webhookByEvents ?? config?.webhook_by_events ?? false,
  header_names: config?.headers && typeof config.headers === 'object' ? Object.keys(config.headers).sort() : [],
})

export const hasWebhookHeader = (config, name) => Boolean(
  config?.headers
  && typeof config.headers === 'object'
  && Object.keys(config.headers).some((header) => header.toLowerCase() === name.toLowerCase()),
)

export const buildPatchedConfig = (config, secret, headerName = DEFAULT_HEADER_NAME) => {
  if (typeof secret !== 'string' || secret.trim().length === 0) throw new Error('EVOLUTION_WEBHOOK_SECRET is required for apply')
  const patched = clone(config)
  const headers = { ...(patched.headers ?? {}) }
  const existingName = Object.keys(headers).find((name) => name.toLowerCase() === headerName.toLowerCase())
  headers[existingName ?? headerName] = secret
  patched.headers = headers
  return patched
}

// Evolution 2.x returns persistence metadata (id/instanceId/timestamps) and
// uses webhookBase64/webhookByEvents in its write DTO. Keep those details out
// of the POST body so a read-back can be safely patched without resubmitting
// read-only fields or the alternate response names.
export const buildEvolutionWebhookPayload = (config) => ({
  webhook: {
    enabled: config?.enabled === true,
    url: config?.url,
    events: Array.isArray(config?.events) ? [...config.events] : [],
    headers: config?.headers && typeof config.headers === 'object' ? { ...config.headers } : {},
    byEvents: config?.webhookByEvents ?? config?.webhook_by_events ?? false,
    base64: config?.webhookBase64 ?? config?.base64 ?? false,
  },
})

export const buildRollbackConfig = (config, backup, headerName = DEFAULT_HEADER_NAME) => {
  const restored = clone(config)
  if (backup?.header_was_present === true) return restored
  if (restored.headers && typeof restored.headers === 'object') {
    for (const name of Object.keys(restored.headers)) {
      if (name.toLowerCase() === headerName.toLowerCase()) delete restored.headers[name]
    }
    if (Object.keys(restored.headers).length === 0) delete restored.headers
  }
  return restored
}

const envValue = (name) => String(process.env[name] ?? '').trim()
export const assertShadowConfiguration = (env = process.env) => {
  if (String(env.WHATSAPP_MODE ?? '').trim() !== 'shadow' || String(env.PILOT_MODE ?? '').trim() !== 'shadow') {
    throw new Error('Webhook configuration requires WHATSAPP_MODE=shadow and PILOT_MODE=shadow')
  }
  return true
}

const apiBase = () => {
  const raw = envValue('EVOLUTION_BASE_URL')
  if (!raw) throw new Error('EVOLUTION_BASE_URL is required')
  const url = new URL(raw)
  if (url.username || url.password || url.search || url.hash) throw new Error('EVOLUTION_BASE_URL must not contain credentials or query data')
  return url.toString().replace(/\/$/, '')
}

const instance = () => envValue('EVOLUTION_INSTANCE') || DEFAULT_INSTANCE
const headerName = () => envValue('EVOLUTION_WEBHOOK_HEADER_NAME') || DEFAULT_HEADER_NAME
const backupPath = () => envValue('WHATSAPP_WEBHOOK_BACKUP_PATH') || DEFAULT_BACKUP_PATH

const requestJson = async ({ method, endpoint, body }) => {
  const apiKey = envValue('EVOLUTION_API_KEY')
  if (!apiKey) throw new Error('EVOLUTION_API_KEY is required')
  const response = await fetch(`${apiBase()}${endpoint}`, {
    method,
    headers: { apikey: apiKey, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Evolution request failed (${response.status})`)
  return response.json()
}

const readBackup = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))
const writeBackup = async (file, config, name) => {
  const data = {
    version: 1,
    instance: name,
    header_name: headerName(),
    header_was_present: hasWebhookHeader(config, headerName()),
    config: sanitizeWebhookConfig(config),
    created_at: new Date().toISOString(),
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { await fs.chmod(file, 0o600) } catch { /* Windows may not support POSIX modes. */ }
}

const report = (value) => console.log(JSON.stringify(value, null, 2))

export const runCli = async (args = process.argv.slice(2)) => {
  const mode = args.includes('--apply') ? 'apply' : args.includes('--rollback') ? 'rollback' : 'dry-run'
  const unknown = args.filter((arg) => !['--dry-run', '--apply', '--rollback'].includes(arg))
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`)
  if (args.includes('--apply') && args.includes('--rollback')) throw new Error('Choose only one operation')
  assertShadowConfiguration()

  const name = instance()
  const nameHeader = headerName()
  const current = extractWebhookConfig(await requestJson({ method: 'GET', endpoint: `/webhook/find/${encodeURIComponent(name)}` }))
  const currentSafe = sanitizeWebhookConfig(current)
  const output = {
    operation: mode,
    instance: name,
    current: currentSafe,
    header_name: nameHeader,
    header_configured: hasWebhookHeader(current, nameHeader),
    external_effects: false,
  }

  if (mode === 'dry-run') {
    output.planned_change = output.header_configured ? 'none' : 'add_header_only'
    report(output)
    return output
  }

  if (mode === 'apply') {
    const secret = envValue('EVOLUTION_WEBHOOK_SECRET')
    if (!secret) throw new Error('EVOLUTION_WEBHOOK_SECRET is required for apply')
    const file = backupPath()
    await writeBackup(file, current, name)
    const patched = buildPatchedConfig(current, secret, nameHeader)
    await requestJson({ method: 'POST', endpoint: `/webhook/set/${encodeURIComponent(name)}`, body: buildEvolutionWebhookPayload(patched) })
    const verified = extractWebhookConfig(await requestJson({ method: 'GET', endpoint: `/webhook/find/${encodeURIComponent(name)}` }))
    const verifiedSafe = sanitizeWebhookConfig(verified)
    if (!hasWebhookHeader(verified, nameHeader)) throw new Error('Webhook header was not confirmed after apply')
    output.backup_path = file
    output.after = verifiedSafe
    output.applied = true
    report(output)
    return output
  }

  const file = backupPath()
  const backup = await readBackup(file)
  if (backup.instance !== name || backup.header_name !== nameHeader) throw new Error('Backup does not match instance/header')
  const restored = buildRollbackConfig(current, backup, nameHeader)
  await requestJson({ method: 'POST', endpoint: `/webhook/set/${encodeURIComponent(name)}`, body: buildEvolutionWebhookPayload(restored) })
  const verified = extractWebhookConfig(await requestJson({ method: 'GET', endpoint: `/webhook/find/${encodeURIComponent(name)}` }))
  output.backup_path = file
  output.after = sanitizeWebhookConfig(verified)
  output.rolled_back = true
  report(output)
  return output
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Webhook configuration failed')
    process.exitCode = 1
  })
}
