import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
export const QA_PREFIX = 'E2E_QA_'

const forbiddenProviderSecrets = [
  'MERCADOPAGO_ACCESS_TOKEN',
  'MERCADOPAGO_WEBHOOK_SECRET',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'EVOLUTION_API_KEY',
  'EVOLUTION_WEBHOOK_SECRET',
  'DEEPSEEK_API_KEY',
  'N8N_BASIC_AUTH_PASSWORD',
]

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function readEnvFileValue(filePath, name) {
  if (!fs.existsSync(filePath)) return ''
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/)
    if (match?.[1] === name) return match[2].replace(/^['"]|['"]$/g, '').trim()
  }
  return ''
}

function runtimeViteUrl(env, cwd) {
  if (hasValue(env.VITE_SUPABASE_URL)) return env.VITE_SUPABASE_URL.trim().replace(/\/$/, '')
  return readEnvFileValue(path.join(cwd, '.env.local'), 'VITE_SUPABASE_URL').replace(/\/$/, '')
    || readEnvFileValue(path.join(cwd, '.env'), 'VITE_SUPABASE_URL').replace(/\/$/, '')
}

function projectRefFromUrl(value) {
  try {
    const host = new URL(value).hostname
    return host.endsWith('.supabase.co') ? host.split('.')[0] : ''
  } catch {
    return ''
  }
}

export function getQaConfig({ requireCleanup = false, requireFixtureSeed = false, env = process.env, checkViteRuntime = false, cwd = process.cwd() } = {}) {
  const reasons = []
  const projectRef = env.E2E_SUPABASE_PROJECT_REF?.trim() || ''
  const allowedProjectRef = env.E2E_ALLOWED_PROJECT_REF?.trim() || ''
  const testPrefix = env.E2E_TEST_PREFIX?.trim() || ''
  const environment = env.E2E_ENVIRONMENT?.trim().toLowerCase() || ''
  const urlValue = env.E2E_SUPABASE_URL?.trim() || ''

  if (env.E2E_REAL_SUPABASE !== '1') reasons.push('real_supabase_disabled')
  if (!projectRef || !/^[a-z0-9-]{6,64}$/.test(projectRef)) reasons.push('project_ref_missing_or_invalid')
  if (!allowedProjectRef || allowedProjectRef !== projectRef) reasons.push('project_ref_not_explicitly_allowed')
  if (projectRef === PRODUCTION_PROJECT_REF) reasons.push('production_project_ref')
  if (testPrefix !== QA_PREFIX) reasons.push('test_prefix_must_be_E2E_QA_')
  if (!['qa', 'sandbox'].includes(environment)) reasons.push('environment_must_be_qa_or_sandbox')
  if (!hasValue(env.E2E_SUPABASE_ANON_KEY)) reasons.push('anon_key_missing')
  if (!hasValue(env.E2E_SUPABASE_SERVICE_ROLE_KEY)) reasons.push('service_role_key_missing')
  if (requireCleanup && env.E2E_ALLOW_CLEANUP !== '1') reasons.push('cleanup_guard_missing')
  if (requireFixtureSeed && env.E2E_ALLOW_FIXTURE_SEED !== '1') reasons.push('fixture_seed_guard_missing')
  if (requireFixtureSeed && !hasValue(env.E2E_QA_PASSWORD)) reasons.push('qa_password_missing')

  if (!urlValue) {
    reasons.push('sandbox_url_missing')
  } else {
    try {
      const url = new URL(urlValue)
      const expectedHost = projectRef ? `${projectRef}.supabase.co` : ''
      if (url.protocol !== 'https:') reasons.push('sandbox_url_must_use_https')
      if (!expectedHost || url.hostname !== expectedHost) reasons.push('sandbox_url_project_mismatch')
      if (url.hostname === `${PRODUCTION_PROJECT_REF}.supabase.co`) reasons.push('production_url')
    } catch {
      reasons.push('sandbox_url_invalid')
    }
  }

  const leakedProviderSecrets = forbiddenProviderSecrets.filter((name) => hasValue(env[name]))
  if (leakedProviderSecrets.length > 0) reasons.push('external_provider_secret_present')

  const viteUrl = runtimeViteUrl(env, cwd)
  const runtimeProjectRef = projectRefFromUrl(viteUrl || urlValue)
  if (checkViteRuntime) {
    if (!viteUrl) reasons.push('vite_supabase_url_missing')
    else if (viteUrl !== urlValue) reasons.push('vite_runtime_project_mismatch')
    if (runtimeProjectRef === PRODUCTION_PROJECT_REF) reasons.push('production_runtime_url')
  }

  if (reasons.length > 0) {
    const error = new Error('E2E sandbox guard blocked the operation.')
    error.code = 'e2e_sandbox_guard_failed'
    error.reasons = reasons
    error.runtimeProjectRef = runtimeProjectRef || 'unknown'
    throw error
  }

  return {
    environment,
    projectRef,
    supabaseUrl: urlValue.replace(/\/$/, ''),
    testPrefix: QA_PREFIX,
    cleanupAllowed: env.E2E_ALLOW_CLEANUP === '1',
    fixtureSeedAllowed: env.E2E_ALLOW_FIXTURE_SEED === '1',
    runtimeProjectRef: checkViteRuntime ? runtimeProjectRef : projectRef,
  }
}

export function printGuardError(error) {
  const reasons = Array.isArray(error?.reasons) ? error.reasons : ['unknown_guard_failure']
  const runtimeRef = /^[a-z0-9-]{6,64}$/.test(error?.runtimeProjectRef || '') ? error.runtimeProjectRef : 'unknown'
  console.error(`E2E sandbox guard blocked: ${reasons.join(', ')} (runtime_ref=${runtimeRef})`)
}
