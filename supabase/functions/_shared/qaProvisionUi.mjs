const QA_REF = 'cmsymmszlzikqpvfqjre'

export function qaProvisionCorsOrigin(origin, { appBaseUrl = '', projectRef = '', environment = '' } = {}) {
  if (typeof origin !== 'string' || !origin) return null
  const allowed = new Set([appBaseUrl, `https://${QA_REF}.supabase.co`])
  if (projectRef === QA_REF && environment === 'qa') {
    for (const host of ['127.0.0.1', 'localhost']) {
      for (const port of [4173, 5196]) allowed.add(`http://${host}:${port}`)
    }
  }
  return allowed.has(origin) ? origin : null
}

export function publicQaCapabilities(row, state) {
  const connected = state === 'CONNECTED'
  return Object.fromEntries(['automation_enabled', 'outbound_enabled', 'booking_enabled', 'handoff_enabled']
    .map(key => [key, connected && row?.[key] === true]))
}
