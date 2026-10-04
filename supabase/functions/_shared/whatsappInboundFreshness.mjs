export function inboundTimestampSeconds(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('seconds' in value) return inboundTimestampSeconds(value.seconds)
    if (Number.isInteger(value.low) && Number.isInteger(value.high)) {
      return value.high * 2 ** 32 + (value.low >>> 0)
    }
    return null
  }
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !/^\d{10,13}$/.test(value)) return null
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) return null
  return number >= 1_000_000_000_000 ? Math.floor(number / 1000) : number
}

export function isFreshInboundTimestamp(value, now = Date.now()) {
  const seconds = inboundTimestampSeconds(value)
  if (seconds === null) return false
  const ageMs = now - seconds * 1000
  return ageMs >= -120_000 && ageMs <= 300_000
}
