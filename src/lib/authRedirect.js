const PRODUCTION_ORIGIN = 'https://barberia.cuchitron.lat'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const PREVIEW_HOST_SUFFIX = '.pages.dev'

function normalizeOrigin(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    return url.origin
  } catch {
    return ''
  }
}

function isAllowedOrigin(origin) {
  if (!origin) return false
  const url = new URL(origin)
  return url.origin === PRODUCTION_ORIGIN
    || LOCAL_HOSTS.has(url.hostname)
    || url.hostname.endsWith(PREVIEW_HOST_SUFFIX)
}

export function getAppOrigin() {
  const configured = normalizeOrigin(import.meta.env?.VITE_APP_BASE_URL || '')
  if (configured === PRODUCTION_ORIGIN) return configured
  if (import.meta.env?.DEV && configured && isAllowedOrigin(configured)) return configured

  const runtime = typeof window === 'undefined' ? '' : normalizeOrigin(window.location.origin)
  const runtimeHost = runtime ? new URL(runtime).hostname : ''
  if (runtime === PRODUCTION_ORIGIN) return runtime
  // El origen del navegador sólo se acepta automáticamente durante el
  // desarrollo local. Un preview de Pages debe declarar VITE_APP_BASE_URL;
  // así una pestaña en otro pages.dev nunca termina dentro de un email real.
  if (import.meta.env?.DEV && runtime && LOCAL_HOSTS.has(runtimeHost)) return runtime

  return PRODUCTION_ORIGIN
}

export function safeAuthNext(value, fallback = '/ingresar') {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) return fallback
  try {
    const url = new URL(candidate, PRODUCTION_ORIGIN)
    if (url.origin !== PRODUCTION_ORIGIN || url.pathname.includes('://')) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return fallback
  }
}

export function buildAuthRedirect(path = '/auth/confirm') {
  const safePath = safeAuthNext(path, '/auth/confirm')
  return new URL(safePath, getAppOrigin()).toString()
}

export const AUTH_PRODUCTION_ORIGIN = PRODUCTION_ORIGIN
