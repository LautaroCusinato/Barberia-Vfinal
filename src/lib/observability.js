const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev'

function correlationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function getClientContext(extra = {}) {
  return {
    correlation_id: correlationId(),
    app_version: APP_VERSION,
    route: typeof window !== 'undefined' ? window.location.pathname : 'server',
    tenant_id: extra.tenant_id ?? null,
    ...extra,
  }
}

export function reportClientError(error, extra = {}) {
  const context = getClientContext(extra)
  const safeError = {
    name: error?.name || 'Error',
    message: String(error?.message || error || 'Unknown client error').slice(0, 500),
    stack: import.meta.env.DEV ? String(error?.stack || '').slice(0, 2000) : undefined,
    ...context,
  }
  if (typeof window !== 'undefined') {
    window.__AUSTRAL_CLIENT_ERRORS__ = [...(window.__AUSTRAL_CLIENT_ERRORS__ || []).slice(-19), safeError]
  }
  if (import.meta.env.DEV) console.error('[client-error]', safeError)
  return safeError
}

export function trackClientEvent(name, metadata = {}) {
  const event = { name, at: new Date().toISOString(), ...getClientContext(metadata) }
  if (typeof window !== 'undefined') {
    window.__AUSTRAL_CLIENT_EVENTS__ = [...(window.__AUSTRAL_CLIENT_EVENTS__ || []).slice(-49), event]
  }
  if (import.meta.env.DEV) console.debug('[client-event]', event)
  return event
}

export function installGlobalObservability() {
  if (typeof window === 'undefined' || window.__AUSTRAL_OBSERVABILITY_INSTALLED__) return () => {}
  window.__AUSTRAL_OBSERVABILITY_INSTALLED__ = true
  const onError = (event) => reportClientError(event.error || new Error(event.message), { source: 'window' })
  const onRejection = (event) => reportClientError(event.reason, { source: 'unhandledrejection' })
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    window.__AUSTRAL_OBSERVABILITY_INSTALLED__ = false
  }
}
