import { canonicalArgentineMobile } from './whatsappCustomer.mjs'

// Negocios con WhatsApp administrado: el bot conversa, reserva y confirma
// para cualquier cliente que escribe, y deja la conversación en la bandeja.
//
// QA: sólo los tenants de WHATSAPP_QA_MANUAL_TENANT_IDS (hoy 928) con todos
// los gates de proyecto, entorno y modo shadow de siempre.
// Producción: cualquier negocio cuya conexión vinculó el dueño desde el panel
// (instancia austral-prod-tenant-<id>), con WHATSAPP_MANAGED_RUNTIME_ENABLED=1.
// En los dos casos las capacidades reales de la conexión (automation/outbound/
// booking) se vuelven a exigir en cada paso.
export const QA_MANUAL_TENANT = 928
export const QA_MANUAL_ROUTE = 'https://n8n.cuchitron.lat/webhook/austral-qa-manual-928'
export const QA_MANUAL_PUBLIC_ORIGIN = 'https://barberia-qa.cuchitron.lat'
export const QA_MANUAL_PANEL_ROUTE = 'https://n8n.cuchitron.lat/webhook/austral-qa-panel-send-928'
export const QA_MANUAL_LANGUAGE_ROUTE = 'https://n8n.cuchitron.lat/webhook/austral-qa-language-928'

const QA_ORIGIN = 'https://cmsymmszlzikqpvfqjre.supabase.co'
const PRODUCTION_ORIGIN = 'https://ssagttjdgtypxjcgdnrw.supabase.co'

const PROFILES = Object.freeze({
  qa: Object.freeze({
    environment: 'qa',
    instancePrefix: 'austral-qa-tenant-',
    route: QA_MANUAL_ROUTE,
    panelRoute: QA_MANUAL_PANEL_ROUTE,
    languageRoute: QA_MANUAL_LANGUAGE_ROUTE,
    publicOrigin: QA_MANUAL_PUBLIC_ORIGIN,
  }),
  production: Object.freeze({
    environment: 'production',
    instancePrefix: 'austral-prod-tenant-',
    route: 'https://n8n.cuchitron.lat/webhook/austral-managed-route',
    panelRoute: 'https://n8n.cuchitron.lat/webhook/austral-managed-panel-send',
    languageRoute: 'https://n8n.cuchitron.lat/webhook/austral-managed-language',
    publicOrigin: 'https://barberia.cuchitron.lat',
  }),
})

function supabaseOrigin(getEnv) {
  let url
  try { url = new URL(getEnv('SUPABASE_URL')) } catch { return null }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
  return url.origin
}

function qaRuntime(getEnv) {
  return supabaseOrigin(getEnv) === QA_ORIGIN
    && getEnv('WHATSAPP_PROVISIONING_ENV') === 'qa'
    && getEnv('WHATSAPP_MODE') === 'shadow' && getEnv('PILOT_MODE') === 'shadow'
}

function productionRuntime(getEnv) {
  return supabaseOrigin(getEnv) === PRODUCTION_ORIGIN
    && getEnv('WHATSAPP_RUNTIME_ENV') === 'production'
    && getEnv('WHATSAPP_MANAGED_RUNTIME_ENABLED') === '1'
}

/** Perfil del entorno donde corre la función, o null si no está habilitado. */
export function managedRuntimeProfile(getEnv) {
  if (qaRuntime(getEnv)) return PROFILES.qa
  if (productionRuntime(getEnv)) return PROFILES.production
  return null
}

export function managedInstanceFor(profile, tenantId) {
  const id = Number(tenantId)
  return profile && Number.isSafeInteger(id) && id > 0 ? `${profile.instancePrefix}${id}` : null
}

/** Tenant dueño de una instancia administrada de este entorno. */
export function managedTenantFromInstance(profile, instance) {
  const value = String(instance || '')
  if (!profile || !value.startsWith(profile.instancePrefix)) return null
  const raw = value.slice(profile.instancePrefix.length)
  if (!/^[1-9]\d{0,11}$/.test(raw)) return null
  return Number(raw)
}

export function manualQaEnabled(getEnv, tenantId, instance) {
  const profile = managedRuntimeProfile(getEnv)
  const expected = managedInstanceFor(profile, tenantId)
  if (!expected || instance !== expected) return false
  if (profile.environment === 'production') return true
  const allowed = String(getEnv('WHATSAPP_QA_MANUAL_TENANT_IDS') || '').split(',').map(value => value.trim())
  return Number(tenantId) === QA_MANUAL_TENANT && allowed.includes(String(QA_MANUAL_TENANT))
}

export function manualQaPhoneList(getEnv) {
  const values = String(getEnv('WHATSAPP_QA_MANUAL_RECIPIENTS') || '').split(',').map(value => value.trim())
  const phones = values.map(canonicalArgentineMobile)
  if (phones.some(phone => !phone)) return []
  const unique = [...new Set(phones)]
  return unique.length <= 2 ? unique : []
}

// El dueño habilitó el 09/10 la recepción desde cualquier cliente para QA928;
// en producción es el comportamiento normal de un negocio. No admite grupos
// ni un destino arbitrario enviado por n8n: debe coincidir con el remitente.
export function manualQaOpenRecipients(getEnv) {
  const profile = managedRuntimeProfile(getEnv)
  if (profile?.environment === 'production') return true
  return manualQaEnabled(getEnv, QA_MANUAL_TENANT, `austral-qa-tenant-${QA_MANUAL_TENANT}`)
}

export function manualQaPhoneAllowed(getEnv, value) {
  const phone = canonicalArgentineMobile(value)
  return Boolean(phone && (manualQaOpenRecipients(getEnv) || manualQaPhoneList(getEnv).includes(phone)))
}

export async function manualQaRecipient(getEnv, senderHash, persistedSenderPhone = null) {
  const sourcePhone = canonicalArgentineMobile(persistedSenderPhone)
  const open = manualQaOpenRecipients(getEnv)
  if (open && persistedSenderPhone !== null && persistedSenderPhone !== undefined && !sourcePhone) return null
  const phones = open && sourcePhone ? [sourcePhone] : manualQaPhoneList(getEnv)
  // Las fuentes anteriores sin teléfono conservan la recuperación acotada.
  if (!phones.length) return null
  const matches = []
  for (const phone of [...new Set(phones)]) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${phone}@s.whatsapp.net`))
    const hash = `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 12)}`
    if (hash === senderHash) matches.push({ recipient: phone, recipientHash: hash })
  }
  return matches.length === 1 ? matches[0] : null
}

export function manualQaCapabilities(connection, { booking = false } = {}) {
  return connection?.state === 'CONNECTED' && connection.automation_enabled === true
    && connection.outbound_enabled === true && (!booking || connection.booking_enabled === true)
}
