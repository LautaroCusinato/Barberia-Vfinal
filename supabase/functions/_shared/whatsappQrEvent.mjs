export const EVOLUTION_QR_TTL_MS = 40_000

export function qrImageFromEvolutionEvent(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data) ? payload.data : {}
  const qrcode = data.qrcode && typeof data.qrcode === 'object' && !Array.isArray(data.qrcode) ? data.qrcode : {}
  const candidate = qrcode.base64 ?? data.base64
  if (typeof candidate !== 'string') return null
  const image = candidate.trim()
  if (image.length < 100 || image.length > 100_000) return null
  if (!/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) return null
  return image
}
