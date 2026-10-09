import { canonicalArgentineMobile } from './whatsappCustomer.mjs'

// Configuración exclusiva del negocio creado para la prueba manual del dueño.
// No altera las ventanas ni los destinatarios de los pilotos anteriores.
export const QA_MANUAL_TENANT = 928
export const QA_MANUAL_ROUTE = 'https://n8n.cuchitron.lat/webhook/austral-qa-manual-928'
export const QA_MANUAL_PUBLIC_ORIGIN = 'https://barberia-qa.cuchitron.lat'
export const QA_MANUAL_PANEL_ROUTE = 'https://n8n.cuchitron.lat/webhook/austral-qa-panel-send-928'

export function manualQaEnabled(getEnv, tenantId, instance) {
  let url
  try { url = new URL(getEnv('SUPABASE_URL')) } catch { return false }
  const allowed = String(getEnv('WHATSAPP_QA_MANUAL_TENANT_IDS') || '').split(',').map(value => value.trim())
  return url.origin === 'https://cmsymmszlzikqpvfqjre.supabase.co'
    && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
    && getEnv('WHATSAPP_PROVISIONING_ENV') === 'qa'
    && getEnv('WHATSAPP_MODE') === 'shadow' && getEnv('PILOT_MODE') === 'shadow'
    && Number(tenantId) === QA_MANUAL_TENANT && allowed.includes(String(QA_MANUAL_TENANT))
    && instance === `austral-qa-tenant-${QA_MANUAL_TENANT}`
}

export function manualQaPhoneList(getEnv) {
  const values = String(getEnv('WHATSAPP_QA_MANUAL_RECIPIENTS') || '').split(',').map(value => value.trim())
  const phones = values.map(canonicalArgentineMobile)
  if (phones.some(phone => !phone)) return []
  const unique = [...new Set(phones)]
  return unique.length <= 2 ? unique : []
}

export async function manualQaRecipient(getEnv, senderHash) {
  const phones = manualQaPhoneList(getEnv)
  // Lista acotada: la prueba usa los dos teléfonos propios autorizados.
  if (!phones.length || phones.length > 2) return null
  const matches = []
  for (const phone of phones) {
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
