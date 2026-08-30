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
