import process from 'node:process'

export const PRODUCTION_PROJECT_REF = 'ssagttjdgtypxjcgdnrw'
export const QA_PROJECT_REF = 'cmsymmszlzikqpvfqjre'
export const PRODUCTION_WEBHOOK_URL = `https://${PRODUCTION_PROJECT_REF}.supabase.co/functions/v1/billing-webhooks/mercadopago`
export const PROTECTED_TENANTS = new Set([1, 5, 6])

const REQUIRED_SECRET_NAMES = ['MERCADOPAGO_ACCESS_TOKEN', 'MERCADOPAGO_WEBHOOK_SECRET']
const REQUIRED_READINESS_FLAGS = {
  MERCADOPAGO_TOKEN_IDENTITY_VERIFIED: 'seller identity verified with /users/me',
  BILLING_PLAN_VERIFIED: 'external plan verified against provider and price',
  BILLING_WEBHOOK_VERIFIED: 'production webhook configured and signature tested',
  BILLING_JOBS_CONFIGURED: 'billing jobs configured with private cron secret',
  BILLING_ALERTING_CONFIGURED: 'billing alerts connected to an approved destination',
  BILLING_BACKUP_VERIFIED: 'recent backup and restore evidence verified',
  BILLING_ROLLBACK_VERIFIED: 'rollback procedure reviewed and available',
  BILLING_PILOT_TENANT_VERIFIED: 'pilot tenant verified in production environment',
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function exactFlag(env, name) {
  return env[name] === '1'
}

function safeInteger(value) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function addCheck(checks, blockers, name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
  if (!ok) blockers.push(name)
}

function sanitizedSecretState(env) {
  return Object.fromEntries(REQUIRED_SECRET_NAMES.map((name) => [name, present(env[name])]))
}

/**
 * Offline production readiness evaluation. It intentionally never calls a
 * provider, creates a checkout, changes Supabase, or prints secret values.
 * The production flag must remain disabled during this dry-run.
 */
export function evaluateProductionDryRun(env = process.env) {
  const checks = []
  const blockers = []
  const projectRef = String(env.BILLING_PROJECT_REF || '').trim()
  const environment = String(env.BILLING_ENVIRONMENT || '').trim().toLowerCase()
  const mpEnvironment = String(env.MERCADOPAGO_ENVIRONMENT || '').trim().toLowerCase()
  const pilotTenantId = safeInteger(env.BILLING_PRODUCTION_PILOT_TENANT_ID)
  const allowedTenantIds = String(env.BILLING_PRODUCTION_ALLOWED_TENANT_IDS || '').split(',').map((value) => value.trim()).filter(Boolean)

  addCheck(checks, blockers, 'dry_run_requested', exactFlag(env, 'BILLING_DRY_RUN'), 'BILLING_DRY_RUN must equal 1')
  addCheck(checks, blockers, 'production_environment_explicit', environment === 'production', 'BILLING_ENVIRONMENT must equal production')
  addCheck(checks, blockers, 'production_project_ref', projectRef === PRODUCTION_PROJECT_REF, 'the production project ref must be explicit')
  addCheck(checks, blockers, 'qa_project_ref_rejected', projectRef !== QA_PROJECT_REF, 'QA ref cannot be used as production target')
  addCheck(checks, blockers, 'production_activation_disabled', env.BILLING_PRODUCTION_ENABLED === '0', 'BILLING_PRODUCTION_ENABLED must equal 0 during dry-run')
  addCheck(checks, blockers, 'mercadopago_environment_explicit', mpEnvironment === 'production', 'MERCADOPAGO_ENVIRONMENT must equal production')
  addCheck(checks, blockers, 'sandbox_not_reused', mpEnvironment !== 'sandbox', 'sandbox environment cannot be used for production')
  addCheck(checks, blockers, 'api_base_is_canonical', present(env.MERCADOPAGO_API_BASE_URL) && String(env.MERCADOPAGO_API_BASE_URL).replace(/\/$/, '') === 'https://api.mercadopago.com', 'Mercado Pago API host must be explicit and canonical')

  for (const name of REQUIRED_SECRET_NAMES) addCheck(checks, blockers, `secret:${name}`, present(env[name]), `${name} must exist only in server-side secrets`)
  addCheck(checks, blockers, 'token_identity_verified', exactFlag(env, 'MERCADOPAGO_TOKEN_IDENTITY_VERIFIED'), REQUIRED_READINESS_FLAGS.MERCADOPAGO_TOKEN_IDENTITY_VERIFIED)
  addCheck(checks, blockers, 'seller_id_configured', safeInteger(env.MERCADOPAGO_EXPECTED_SELLER_ID) !== null, 'expected production seller ID is required')
  addCheck(checks, blockers, 'application_id_configured', safeInteger(env.MERCADOPAGO_EXPECTED_APPLICATION_ID) !== null, 'expected production application ID is required')

  addCheck(checks, blockers, 'single_pilot_tenant', allowedTenantIds.length === 1 && pilotTenantId !== null && allowedTenantIds[0] === String(pilotTenantId), 'exactly one production pilot tenant must be allow-listed')
  addCheck(checks, blockers, 'pilot_tenant_not_protected', pilotTenantId !== null && !PROTECTED_TENANTS.has(pilotTenantId), 'Central, Nueva and technical sandbox tenants are protected')
  addCheck(checks, blockers, 'pilot_tenant_verified', exactFlag(env, 'BILLING_PILOT_TENANT_VERIFIED'), REQUIRED_READINESS_FLAGS.BILLING_PILOT_TENANT_VERIFIED)
  addCheck(checks, blockers, 'pilot_tenant_environment', env.BILLING_PILOT_TENANT_ENVIRONMENT === 'production', 'pilot tenant must be explicitly marked production')
  addCheck(checks, blockers, 'pilot_provider', env.BILLING_PILOT_PROVIDER === 'mercadopago', 'pilot provider must be mercadopago')

  addCheck(checks, blockers, 'plan_verified', exactFlag(env, 'BILLING_PLAN_VERIFIED'), REQUIRED_READINESS_FLAGS.BILLING_PLAN_VERIFIED)
  addCheck(checks, blockers, 'plan_code', /^[a-z][a-z0-9_-]{1,39}$/.test(String(env.BILLING_PLAN_CODE || '').trim()), 'a valid internal plan code is required')
  addCheck(checks, blockers, 'plan_country', /^[A-Z]{2}$/.test(String(env.BILLING_PLAN_COUNTRY || '').trim()), 'plan country must be an ISO-3166 alpha-2 code')
  addCheck(checks, blockers, 'plan_currency', /^[A-Z]{3}$/.test(String(env.BILLING_PLAN_CURRENCY || '').trim()), 'plan currency must be an ISO-4217 code')
  addCheck(checks, blockers, 'plan_amount', Number.isFinite(Number(env.BILLING_PLAN_AMOUNT)) && Number(env.BILLING_PLAN_AMOUNT) > 0, 'plan amount must be positive and explicitly configured')
  addCheck(checks, blockers, 'plan_periodicity', ['monthly', 'yearly'].includes(String(env.BILLING_PLAN_PERIODICITY || '').trim()), 'plan periodicity must be monthly or yearly')
  addCheck(checks, blockers, 'trial_days', Number.isInteger(Number(env.BILLING_TRIAL_DAYS)) && Number(env.BILLING_TRIAL_DAYS) >= 0 && Number(env.BILLING_TRIAL_DAYS) <= 365, 'trial days must be an explicit integer from 0 to 365')
  addCheck(checks, blockers, 'external_plan_id', /^[A-Za-z0-9_-]{8,120}$/.test(String(env.BILLING_EXTERNAL_PLAN_ID || '').trim()), 'external plan ID must be present and verified')

  addCheck(checks, blockers, 'webhook_url', String(env.BILLING_WEBHOOK_URL || '').replace(/\/$/, '') === PRODUCTION_WEBHOOK_URL, 'production webhook URL must match the production project')
  addCheck(checks, blockers, 'webhook_verified', exactFlag(env, 'BILLING_WEBHOOK_VERIFIED'), REQUIRED_READINESS_FLAGS.BILLING_WEBHOOK_VERIFIED)
  for (const [name, detail] of Object.entries(REQUIRED_READINESS_FLAGS)) {
    if (name === 'MERCADOPAGO_TOKEN_IDENTITY_VERIFIED' || name === 'BILLING_PLAN_VERIFIED' || name === 'BILLING_WEBHOOK_VERIFIED' || name === 'BILLING_PILOT_TENANT_VERIFIED') continue
    addCheck(checks, blockers, name.toLowerCase(), exactFlag(env, name), detail)
  }
  addCheck(checks, blockers, 'paypal_disabled', env.BILLING_PAYPAL_ENABLED !== '1', 'PayPal must remain disabled')
  addCheck(checks, blockers, 'no_global_activation', env.BILLING_GLOBAL_PROVIDER_ENABLED !== '1', 'global provider activation is forbidden')

  return {
    dry_run: true,
    activation_performed: false,
    checkout_created: false,
    payments_created: false,
    project_ref: projectRef || 'missing',
    environment: environment || 'missing',
    tenant_id: pilotTenantId,
    allowed_tenant_count: allowedTenantIds.length,
    provider: 'mercadopago',
    secrets: sanitizedSecretState(env),
    checks,
    blockers,
    ready: blockers.length === 0,
  }
}

function main() {
  const result = evaluateProductionDryRun()
  console.log(JSON.stringify(result, null, 2))
  if (!result.ready) process.exitCode = 1
}

const invokedDirectly = process.argv[1]?.split(/[\\/]/).pop()?.toLowerCase() === 'billing-production-dry-run.mjs'
if (invokedDirectly) main()
