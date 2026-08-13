export const WORKSPACE_TRANSITION_KEY = 'austral-workspace-transition'

function getSessionStorage() {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

export function markWorkspaceTransition(now = Date.now()) {
  const storage = getSessionStorage()
  if (!storage) return false
  try {
    storage.setItem(WORKSPACE_TRANSITION_KEY, String(now))
    return true
  } catch {
    return false
  }
}

export function hasWorkspaceTransition(now = Date.now()) {
  const storage = getSessionStorage()
  if (!storage) return false
  try {
    const startedAt = Number(storage.getItem(WORKSPACE_TRANSITION_KEY))
    return Number.isFinite(startedAt) && startedAt > 0 && now - startedAt < 60_000
  } catch {
    return false
  }
}

export function clearWorkspaceTransition() {
  const storage = getSessionStorage()
  if (!storage) return false
  try {
    storage.removeItem(WORKSPACE_TRANSITION_KEY)
    return true
  } catch {
    return false
  }
}
