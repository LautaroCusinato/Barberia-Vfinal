import crypto from 'node:crypto'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

export const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
export const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
const PRODUCTION_APP_URL = 'https://barberia.cuchitron.lat'
const DEFAULT_TIMEOUT_MS = 5_000

const mockDefinitions = {
  http_500: { kind: 'availability', severity: 'P0', alert: 'public_endpoint_unavailable' },
  timeout: { kind: 'latency', severity: 'P0', alert: 'public_endpoint_timeout' },
  function_down: { kind: 'edge_function', severity: 'P0', alert: 'edge_function_unavailable' },
  webhook_invalid: { kind: 'webhook', severity: 'P1', alert: 'webhook_signature_or_payload_invalid' },
  auth_failed: { kind: 'auth', severity: 'P1', alert: 'auth_failure_rate_high' },
  frontend_error: { kind: 'frontend', severity: 'P1', alert: 'frontend_error_rate_high' },
  backup_failure: { kind: 'backup', severity: 'P1', alert: 'backup_missing_or_failed' },
}

function projectRefFromUrl(value) {
  try {
    const host = new URL(value).hostname
    return host.endsWith('.supabase.co') ? host.split('.')[0] : ''
  } catch {
    return ''
  }
}

function assertMonitorTarget(env = process.env) {
  const environment = String(env.MONITOR_ENVIRONMENT || '').trim().toLowerCase()
  const projectRef = String(env.MONITOR_SUPABASE_PROJECT_REF || '').trim()
  const supabaseUrl = String(env.MONITOR_SUPABASE_URL || '').trim().replace(/\/$/, '')
  const baseUrl = String(env.MONITOR_BASE_URL || '').trim().replace(/\/$/, '')
  if (!['qa', 'production'].includes(environment)) throw new Error('MONITOR_ENVIRONMENT must be qa or production.')
  const expectedRef = environment === 'qa' ? QA_PROJECT_REF : PRODUCTION_PROJECT_REF
  if (projectRef !== expectedRef) throw new Error('Monitoring project ref does not match the selected environment.')
  if (projectRef === PRODUCTION_PROJECT_REF && env.MONITOR_ALLOW_PRODUCTION_READONLY !== '1') throw new Error('Production monitoring requires MONITOR_ALLOW_PRODUCTION_READONLY=1.')
  if (supabaseUrl !== `https://${expectedRef}.supabase.co`) throw new Error('MONITOR_SUPABASE_URL does not match the selected project.')
  if (!baseUrl) throw new Error('MONITOR_BASE_URL is required; no .env fallback is allowed.')
  if (environment === 'production' && baseUrl !== PRODUCTION_APP_URL) throw new Error('Production health checks are restricted to the canonical app URL.')
  if (environment === 'qa' && (baseUrl.includes(PRODUCTION_PROJECT_REF) || baseUrl === PRODUCTION_APP_URL)) throw new Error('QA monitoring cannot target production.')
  if (projectRefFromUrl(supabaseUrl) === PRODUCTION_PROJECT_REF && environment !== 'production') throw new Error('Production Supabase ref is forbidden in QA.')
  return { environment, projectRef, supabaseUrl, baseUrl }
}

function correlationId() {
  return `monitor-${crypto.randomUUID()}`
}

async function probe({ name, url, method = 'GET', headers = {}, expected = [200], timeoutMs = DEFAULT_TIMEOUT_MS, required = true }) {
  const started = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { method, headers: { 'x-correlation-id': correlationId(), ...headers }, signal: controller.signal, redirect: 'manual' })
    const latencyMs = Math.round((performance.now() - started) * 100) / 100
    return { name, required, ok: expected.includes(response.status), status: response.status, latency_ms: latencyMs }
  } catch (error) {
    const latencyMs = Math.round((performance.now() - started) * 100) / 100
    return { name, required, ok: false, status: null, latency_ms: latencyMs, error_type: error?.name === 'AbortError' ? 'timeout' : 'network_error' }
  } finally {
    clearTimeout(timeout)
  }
}

export function mockScenario(name) {
  const definition = mockDefinitions[name]
  if (!definition) throw new Error(`Unknown monitoring mock: ${name}`)
  return { scenario: name, simulated: true, ok: false, ...definition }
}

export function monitoringMockNames() {
  return Object.keys(mockDefinitions)
}

export function classifySignal({ kind, status = null, latencyMs = null, consecutive = 1 } = {}) {
  if (kind === 'availability' && (status === null || status >= 500)) return 'P0'
  if (kind === 'edge_function' && (status === null || status >= 500)) return 'P0'
  if (kind === 'latency' && consecutive >= 3) return 'P0'
  if (['auth', 'webhook', 'backup', 'frontend'].includes(kind)) return 'P1'
  if (kind === 'latency' && latencyMs > 1000) return 'P1'
  return 'P2'
}

export async function runHealthChecks(env = process.env) {
  const target = assertMonitorTarget(env)
  const bookingPath = env.MONITOR_BOOKING_PATH || (target.environment === 'qa' ? '/reservar/e2e-qa-barberia-a' : '/reservar/barberia-central')
  const anonKey = String(env.MONITOR_SUPABASE_ANON_KEY || '').trim()
  const supabaseHeaders = anonKey ? { apikey: anonKey } : {}
  const checks = [
    await probe({ name: 'landing', url: `${target.baseUrl}/` }),
    await probe({ name: 'login', url: `${target.baseUrl}/ingresar` }),
    await probe({ name: 'public_booking', url: `${target.baseUrl}${bookingPath}` }),
    await probe({ name: 'supabase_auth_settings', url: `${target.supabaseUrl}/auth/v1/settings`, headers: supabaseHeaders, expected: anonKey ? [200] : [200, 401] }),
  ]
  const functions = (env.MONITOR_EDGE_FUNCTIONS || (target.environment === 'qa' ? 'billing-api' : 'billing-api,billing-webhooks,billing-jobs')).split(',').map((item) => item.trim()).filter(Boolean)
  for (const functionName of functions) {
    checks.push(await probe({
      name: `edge_function:${functionName}`,
      url: `${target.supabaseUrl}/functions/v1/${functionName}`,
      method: 'OPTIONS',
      headers: supabaseHeaders,
      expected: functionName === 'billing-api' ? [200, 204] : [200, 204, 405],
    }))
  }
  return { generated_at: new Date().toISOString(), environment: target.environment, project_ref: target.projectRef, checks, all_required_ok: checks.filter((check) => check.required).every((check) => check.ok) }
}

async function main() {
  const mock = process.argv.find((arg) => arg.startsWith('--mock='))?.slice('--mock='.length)
  if (mock) {
    console.log(JSON.stringify(mockScenario(mock), null, 2))
    return
  }
  const result = await runHealthChecks()
  console.log(JSON.stringify(result, null, 2))
  if (!result.all_required_ok) process.exitCode = 1
}

const invokedDirectly = process.argv[1]?.toLowerCase().endsWith('monitoring-health.mjs')
if (invokedDirectly) main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Monitoring health check failed.')
  process.exitCode = 1
})
