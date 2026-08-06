export const json = (body: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
})

export const errorJson = (message: string, status = 400, code = 'billing_error') => json({ error: { code, message } }, status)

export async function readJson(request: Request, maxBytes = 64 * 1024): Promise<Record<string, unknown>> {
  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > maxBytes) throw Object.assign(new Error('Payload demasiado grande.'), { status: 413, code: 'payload_too_large' })
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('JSON inválido.')
    return parsed as Record<string, unknown>
  } catch {
    throw Object.assign(new Error('JSON inválido.'), { status: 400, code: 'invalid_json' })
  }
}

export function requestId(request: Request) {
  return request.headers.get('x-correlation-id') || crypto.randomUUID()
}
