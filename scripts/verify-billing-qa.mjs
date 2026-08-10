import process from 'node:process'
import { createClient } from '@supabase/supabase-js'
import { getQaConfig, printGuardError } from './e2e-sandbox-guards.mjs'

let config
try {
  config = getQaConfig()
} catch (error) {
  printGuardError(error)
  process.exit(2)
}

const password = process.env.E2E_QA_PASSWORD
const supabase = createClient(config.supabaseUrl, process.env.E2E_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const functionUrl = `${config.supabaseUrl}/functions/v1/billing-api`

async function signIn(email) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.session) throw new Error(`No se pudo autenticar el usuario QA ${email}.`)
  return data.session.access_token
}

async function call(token, path, options = {}) {
  const response = await fetch(`${functionUrl}/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, apikey: process.env.E2E_SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  const body = await response.json().catch(() => ({}))
  return { status: response.status, body }
}

const ownerToken = await signIn('e2e_qa_owner_a@e2e-qa.invalid')
const platformToken = await signIn('e2e_qa_platform_owner@e2e-qa.invalid')
const unassignedToken = await signIn('e2e_qa_unassigned@e2e-qa.invalid')
const states = {}
for (const state of ['trialing', 'active', 'past_due', 'suspended', 'canceled']) {
  const result = await call(ownerToken, `status?state=${state}`)
  if (result.status !== 200 || result.body.environment !== 'qa' || result.body.subscription?.estado !== state) throw new Error(`Estado QA inválido: ${state}.`)
  states[state] = result.body.access_state
}
const checkout = await call(ownerToken, 'checkout', { method: 'POST', body: JSON.stringify({ plan_codigo: 'starter' }) })
if (checkout.status !== 200 || checkout.body.mock !== true || !String(checkout.body.checkout_url).startsWith('https://qa.invalid/')) throw new Error('Checkout mock QA inválido.')
const reconciliation = await call(ownerToken, 'reconcile-sandbox', { method: 'POST', body: JSON.stringify({ external_id: 'E2E_QA_EXTERNAL' }) })
if (reconciliation.status !== 200 || reconciliation.body.reconciled !== true || reconciliation.body.idempotent !== true) throw new Error('Reconciliación mock QA inválida.')
const configStatus = await call(platformToken, 'config-status')
if (configStatus.status !== 200 || configStatus.body.environment !== 'qa' || configStatus.body.production_enabled !== false) throw new Error('Config-status mock QA inválido.')
const forbidden = await call(unassignedToken, 'checkout', { method: 'POST', body: JSON.stringify({ plan_codigo: 'starter' }) })
if (forbidden.status < 400) throw new Error('El usuario sin tenant QA no fue bloqueado.')
console.log(JSON.stringify({ environment: 'qa', function: 'billing-api', config_status: 'ok', states, checkout: 'ok', reconciliation: 'idempotent', unauthorized_user: 'blocked' }, null, 2))
