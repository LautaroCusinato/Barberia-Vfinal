import { adminClient, authenticate } from '../_shared/supabase.ts'
import { corsHeaders, json, readJson } from '../_shared/http.ts'

// Reemplaza el envío directo navegador → n8n. Antes la URL del webhook vivía
// en una variable VITE_* (pública en el bundle) y cualquiera podía mandar
// mensajes desde el número del negocio. Ahora el navegador sólo envía
// tenant_id + cliente_id + texto con su sesión; acá validamos la membresía,
// resolvemos el teléfono desde la ficha del cliente (nunca desde el body) y
// recién entonces reenviamos a n8n con un secreto server-side.
const SECRET_HEADER = 'X-Austral-Panel-Secret'
const MAX_TEXT_LENGTH = 4096
const SEND_ROLES = new Set(['owner', 'admin', 'recepcionista', 'barbero', 'empleado'])

function fail(message: string, status: number, code: string) {
  return json({ error: { code, message } }, status)
}

function positiveInteger(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return fail('Método no permitido.', 405, 'method_not_allowed')

  try {
    const webhookUrl = Deno.env.get('WHATSAPP_PANEL_SEND_WEBHOOK_URL') || ''
    const webhookSecret = Deno.env.get('WHATSAPP_PANEL_SEND_SECRET') || ''
    if (!webhookUrl.startsWith('https://') || !webhookSecret) {
      return fail('El envío por WhatsApp no está configurado.', 503, 'panel_send_not_configured')
    }

    const admin = adminClient()
    const user = await authenticate(request, admin)
    const body = await readJson(request, 16 * 1024)

    const tenantId = positiveInteger(body.tenant_id)
    const clienteId = positiveInteger(body.cliente_id)
    const texto = typeof body.texto === 'string' ? body.texto.trim() : ''
    if (!tenantId || !clienteId) return fail('Faltan el negocio o el cliente.', 422, 'invalid_target')
    if (!texto || texto.length > MAX_TEXT_LENGTH) return fail('El mensaje está vacío o es demasiado largo.', 422, 'invalid_text')

    const { data: membership, error: membershipError } = await admin
      .from('barberia_members')
      .select('role')
      .eq('barberia_id', tenantId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (membershipError) return fail('No se pudo verificar el acceso.', 502, 'membership_lookup_failed')
    if (!membership) return fail('No tenés acceso a este negocio.', 403, 'tenant_membership_required')
    // Un miembro de sólo lectura no puede escribir mensajes (RLS) y tampoco
    // debe poder enviar WhatsApp desde el número del negocio.
    if (!SEND_ROLES.has(String(membership.role))) return fail('Tu rol no puede enviar mensajes.', 403, 'send_role_required')

    // Igual que las políticas de escritura: un tenant con el plan vencido o
    // suspendido no puede usar el número del negocio desde el panel.
    const { data: operational, error: accessError } = await admin.rpc('barberia_access_state', { p_barberia_id: tenantId })
    if (accessError) return fail('No se pudo verificar el estado de la cuenta.', 502, 'access_state_failed')
    if (!['active', 'trialing', 'past_due'].includes(String(operational))) return fail('La cuenta no tiene un plan habilitado para enviar mensajes.', 402, 'subscription_inactive')

    const { data: cliente, error: clienteError } = await admin
      .from('clientes')
      .select('telefono')
      .eq('id', clienteId)
      .eq('barberia_id', tenantId)
      .maybeSingle()
    if (clienteError) return fail('No se pudo leer la ficha del cliente.', 502, 'customer_lookup_failed')
    const telefono = String(cliente?.telefono || '').replace(/\D/g, '')
    if (!telefono) return fail('Este cliente no tiene un teléfono cargado en su ficha.', 422, 'customer_phone_missing')

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SECRET_HEADER]: webhookSecret },
      body: JSON.stringify({ telefono, texto, barberia_id: tenantId }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return fail('El mensaje no se pudo enviar por WhatsApp.', 502, 'panel_send_upstream_failed')

    return json({ sent: true })
  } catch (error) {
    const status = Number((error as { status?: number })?.status) || 500
    const code = String((error as { code?: string })?.code || 'panel_send_error').replace(/[^a-z0-9_:-]/gi, '').slice(0, 80)
    const message = status >= 500 ? 'No se pudo enviar el mensaje.' : String((error as Error)?.message || 'Solicitud inválida.').slice(0, 240)
    return fail(message, status, code)
  }
})
