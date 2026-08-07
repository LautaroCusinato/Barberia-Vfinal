import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.45.0'

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw Object.assign(new Error('Falta configuración interna de Supabase.'), { status: 503, code: 'supabase_not_configured' })
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

/**
 * Client used for RPCs that must evaluate the caller's auth.uid(). The
 * service-role client intentionally has no end-user JWT context, so calling
 * authorization-aware SECURITY DEFINER functions through it would reject a
 * valid platform owner. The token is forwarded only in memory for this
 * request and is never persisted or logged.
 */
export function requestClient(request: Request): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authorization = request.headers.get('Authorization') || ''
  if (!url || !key || !authorization.startsWith('Bearer ')) throw Object.assign(new Error('Falta contexto de sesión.'), { status: 401, code: 'auth_required' })
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: authorization } } })
}

export async function authenticate(request: Request, admin: SupabaseClient): Promise<User> {
  const authorization = request.headers.get('Authorization') || ''
  if (!authorization.startsWith('Bearer ')) throw Object.assign(new Error('Autenticación requerida.'), { status: 401, code: 'auth_required' })
  const token = authorization.slice(7).trim()
  if (!token) throw Object.assign(new Error('Autenticación requerida.'), { status: 401, code: 'auth_required' })
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw Object.assign(new Error('Sesión inválida.'), { status: 401, code: 'invalid_session' })
  return data.user
}

export async function ownerTenant(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from('barberia_members').select('barberia_id, role').eq('user_id', userId).eq('role', 'owner')
  if (error) throw Object.assign(new Error('No se pudo resolver el tenant.'), { status: 500, code: 'tenant_lookup_failed' })
  if (!data?.length) throw Object.assign(new Error('El usuario no es owner de ningún tenant.'), { status: 403, code: 'owner_required' })
  if (data.length !== 1) throw Object.assign(new Error('La sesión pertenece a más de un tenant; seleccioná uno desde el panel.'), { status: 409, code: 'tenant_selection_required' })
  return Number(data[0].barberia_id)
}

export async function platformRole(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from('platform_members').select('role').eq('user_id', userId).maybeSingle()
  if (error) throw Object.assign(new Error('No se pudo resolver el rol de plataforma.'), { status: 500, code: 'platform_role_lookup_failed' })
  return data?.role || null
}
