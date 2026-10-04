export function isQa927WindowOpen(expiresAt, now = Date.now()) {
  if (typeof expiresAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(expiresAt)) return false
  const expires = Date.parse(expiresAt)
  const remaining = expires - now
  return Number.isFinite(remaining) && remaining > 0 && remaining <= 30 * 60 * 1000
}
