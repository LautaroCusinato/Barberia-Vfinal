const PRODUCTION_ORIGIN = 'https://barberia.cuchitron.lat'
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const QA_SUPABASE_ORIGIN = 'https://cmsymmszlzikqpvfqjre.supabase.co'
const QA_APP_ORIGIN = 'https://barberia-qa.cuchitron.lat'
// Sólo previews de este proyecto de Pages, no cualquier sitio en pages.dev.
const QA_PREVIEW_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.barberia-177\.pages\.dev$/

function normalizeOrigin(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return url.origin
  } catch {
    return ''
  }
}

function isAllowedQaOrigin(origin) {
  if (!origin) return false
  const url = new URL(origin)
  return url.origin === QA_APP_ORIGIN
    || (url.protocol === 'https:' && !url.port && QA_PREVIEW_HOST.test(url.hostname))
}

export function getAppOrigin() {
  const configured = normalizeOrigin(import.meta.env?.VITE_APP_BASE_URL || '')
  if (configured === PRODUCTION_ORIGIN) return configured
  const backend = normalizeOrigin(import.meta.env?.VITE_SUPABASE_URL || '')
  // QA también se compila con DEV=false. El origen se acepta sólo si ambos
  // valores del build son explícitos y el backend es el proyecto QA conocido.
  if (backend === QA_SUPABASE_ORIGIN && isAllowedQaOrigin(configured)) return configured
  if (import.meta.env?.DEV && configured && LOCAL_HOSTS.has(new URL(configured).hostname)) return configured

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
