const DEFAULT_FUNCTION = 'whatsapp-provision'
const QA_SUPABASE_HOST = 'cmsymmszlzikqpvfqjre.supabase.co'
const configuredFunction = String(import.meta.env.VITE_WHATSAPP_PROVISION_FUNCTION || '').trim()

export const WHATSAPP_PROVISION_FUNCTION = /^[a-z0-9-]+$/.test(configuredFunction)
  ? configuredFunction
  : DEFAULT_FUNCTION

export const MANAGED_WHATSAPP_PROVISIONING = (() => {
  if (configuredFunction) return WHATSAPP_PROVISION_FUNCTION !== DEFAULT_FUNCTION
  try { return new URL(import.meta.env.VITE_SUPABASE_URL || '').hostname === QA_SUPABASE_HOST } catch { return false }
})()

export const WHATSAPP_DISCONNECT_SUPPORTED = WHATSAPP_PROVISION_FUNCTION === DEFAULT_FUNCTION

export function provisioningAction(action) {
  if (WHATSAPP_PROVISION_FUNCTION === DEFAULT_FUNCTION) return action
  return action === 'status' ? 'status' : 'prepare'
}
