/**
 * Evolution sends MESSAGES_UPSERT with either one message object or a batch.
 * Keep the envelope shape intact and let the caller validate each element
 * independently so one malformed message cannot hide valid siblings.
 */
export function normalizeMessagesUpsertData(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') return [data]
  return []
}

export function canonicalSenderJid(primary, alternate) {
  const jid = String(primary || '').trim()
  const alt = String(alternate || '').trim()
  if (jid.toLowerCase().endsWith('@lid') && /^\d{10,16}@s\.whatsapp\.net$/i.test(alt)) return alt.toLowerCase()
  return jid
}
