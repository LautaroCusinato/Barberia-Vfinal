const DAY_MS = 24 * 60 * 60 * 1000

function timestamp(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  return Date.parse(String(value || ''))
}

/**
 * Presentation-only countdown based on the server-provided trial end.
 * A remaining day is one 24-hour window from `now` to `trialEndsAt`; while
 * the trial is valid we round up and clamp to one, and at/after the end we
 * return zero. The timestamp is never used to grant or revoke access.
 */
export function trialRemainingDays(trialEndsAt, now = Date.now()) {
  const endMs = timestamp(trialEndsAt)
  const nowMs = timestamp(now)
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs) || endMs <= nowMs) return 0
  return Math.max(1, Math.ceil((endMs - nowMs) / DAY_MS))
}

export function trialHasExpired(trialEndsAt, now = Date.now()) {
  const endMs = timestamp(trialEndsAt)
  const nowMs = timestamp(now)
  return Number.isFinite(endMs) && Number.isFinite(nowMs) && endMs <= nowMs
}
