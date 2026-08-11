export const WORKSPACE_PREFERENCE_KEY = 'austral-selected-workspace'

const VALID_TYPES = new Set(['platform', 'business'])

function normalizeTenantId(value) {
  if (value === null || value === undefined || value === '') return null
  const normalized = String(value)
  return /^\d+$/.test(normalized) && Number(normalized) > 0 ? normalized : null
}

export function parseWorkspacePreference(rawValue) {
  if (!rawValue) return null

  try {
    const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue
    if (!parsed || !VALID_TYPES.has(parsed.type)) return null

    if (parsed.type === 'platform') return { type: 'platform' }

    const tenantId = normalizeTenantId(parsed.tenantId ?? parsed.selected_tenant_id)
    return tenantId ? { type: 'business', tenantId } : null
  } catch {
    return null
  }
}

function defaultStorage() {
  return typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null
}

export function readWorkspacePreference(storage = defaultStorage()) {
  try {
    return parseWorkspacePreference(storage?.getItem(WORKSPACE_PREFERENCE_KEY))
  } catch {
    return null
  }
}

export function saveWorkspacePreference(type, tenantId = null, storage = defaultStorage()) {
  const preference = type === 'platform'
    ? { type: 'platform' }
    : type === 'business'
      ? parseWorkspacePreference({ type: 'business', tenantId })
      : null

  if (!preference) return false

  try {
    storage?.setItem(WORKSPACE_PREFERENCE_KEY, JSON.stringify(preference))
    return true
  } catch {
    return false
  }
}

export function clearWorkspacePreference(storage = defaultStorage()) {
  try {
    storage?.removeItem(WORKSPACE_PREFERENCE_KEY)
  } catch {
    // Storage puede estar bloqueado en modo privado; el estado en memoria sigue siendo seguro.
  }
}
