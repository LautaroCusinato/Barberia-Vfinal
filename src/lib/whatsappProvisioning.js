const DEFAULT_FUNCTION = 'whatsapp-provision'
const PRODUCTION_FUNCTION = 'whatsapp-production-provision'
const QA_SUPABASE_HOST = 'cmsymmszlzikqpvfqjre.supabase.co'
const PRODUCTION_SUPABASE_HOST = 'ssagttjdgtypxjcgdnrw.supabase.co'
const configuredFunction = String(import.meta.env.VITE_WHATSAPP_PROVISION_FUNCTION || '').trim()

function supabaseHost() {
  try { return new URL(import.meta.env.VITE_SUPABASE_URL || '').hostname } catch { return '' }
}

// Producción sólo tiene la función de producción: sin variable de build
// explícita, el proyecto de producción la elige solo (antes el panel llamaba
// a whatsapp-provision, inexistente allí, y quedaba "Estado no disponible").
export const WHATSAPP_PROVISION_FUNCTION = /^[a-z0-9-]+$/.test(configuredFunction)
  ? configuredFunction
  : supabaseHost() === PRODUCTION_SUPABASE_HOST ? PRODUCTION_FUNCTION : DEFAULT_FUNCTION

export const MANAGED_WHATSAPP_PROVISIONING = (() => {
  if (configuredFunction) return WHATSAPP_PROVISION_FUNCTION !== DEFAULT_FUNCTION
  return [QA_SUPABASE_HOST, PRODUCTION_SUPABASE_HOST].includes(supabaseHost())
})()

export const WHATSAPP_DISCONNECT_SUPPORTED = WHATSAPP_PROVISION_FUNCTION === DEFAULT_FUNCTION

export function provisioningAction(action) {
  if (WHATSAPP_PROVISION_FUNCTION === DEFAULT_FUNCTION) return action
  return action === 'status' ? 'status' : 'prepare'
}
