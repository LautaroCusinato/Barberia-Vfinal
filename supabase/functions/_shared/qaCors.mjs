const QA_ALLOWED_ORIGINS = Object.freeze([
  'https://barberia-qa.cuchitron.lat',
  'https://qa-ui-hardening.barberia-qa-pages.pages.dev',
])

export { QA_ALLOWED_ORIGINS }

/**
 * Return an origin only when this is the authorized QA runtime and the
 * browser origin is one of the two explicitly deployed QA frontends.
 * Production and arbitrary Pages previews fail closed.
 */
export function qaCorsOrigin(origin, isQaRuntime) {
  const candidate = String(origin || '').trim()
  return isQaRuntime && QA_ALLOWED_ORIGINS.includes(candidate) ? candidate : null
}
