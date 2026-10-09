import { adminClient, authenticate } from '../_shared/supabase.ts'
import { corsHeaders, json, readJson } from '../_shared/http.ts'
import { classifyWebhookResponse, handlePanelSend, panelSendErrorBody, panelSendSettings } from '../_shared/whatsappPanelSend.mjs'
import { manualQaEnabled, manualQaPhoneList, manualQaOpenRecipients, QA_MANUAL_PANEL_ROUTE } from '../_shared/qaManualRuntime.mjs'

// Reemplaza el envío directo navegador → n8n. Antes la URL del webhook vivía
// en una variable VITE_* (pública en el bundle) y cualquiera podía mandar
// mensajes desde el número del negocio. Ahora el navegador sólo envía
// tenant_id + cliente_id + texto con su sesión; acá validamos la membresía,
// el rol, el plan, la conexión de WhatsApp y la ficha del cliente (el teléfono
// nunca viene del body), guardamos el mensaje y recién entonces reenviamos a
// n8n con un secreto server-side. `action: 'preflight'` valida sin enviar.
// Remitente (WHATSAPP_PANEL_SEND_ROUTING): `fixed` = la plantilla anterior
// envía siempre por WHATSAPP_PANEL_SEND_INSTANCE y sólo su negocio dueño puede
// usarla; `instance` = la plantilla "Austral Panel Send - Instance Routed"
// envía por la instancia del negocio y la vuelve a verificar en Supabase.
// Límite y ventanas: WHATSAPP_PANEL_SEND_RATE_LIMIT, _RATE_WINDOW_SECONDS,
// _DUPLICATE_WINDOW_SECONDS y _STALE_PENDING_SECONDS (valores propuestos,
// pendientes de decisión). La reserva atómica (migración 20261005120000) los
// aplica bajo un lock por negocio y pausa el bot antes del envío.
// La lógica vive en _shared/whatsappPanelSend.mjs para poder probarla.
const SECRET_HEADER = 'X-Austral-Panel-Secret'

function fail(message: string, status: number, code: string) {
  return json({ error: { code, message } }, status)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return fail('Método no permitido.', 405, 'method_not_allowed')

  try {
    const admin = adminClient()
    const user = await authenticate(request, admin)
    const body = await readJson(request, 16 * 1024)
    // Sólo el tenant QA habilitado reutiliza el secreto de webhook que ya
    // comparten Supabase y n8n. Los ajustes de otros negocios no se cambian.
    const manual = manualQaEnabled((name: string) => Deno.env.get(name), Number(body.tenant_id), `austral-qa-tenant-${Number(body.tenant_id)}`)
    const openRecipients = manual && manualQaOpenRecipients((name: string) => Deno.env.get(name))
    const webhookUrl = manual ? QA_MANUAL_PANEL_ROUTE : Deno.env.get('WHATSAPP_PANEL_SEND_WEBHOOK_URL') || ''
    const webhookSecret = manual ? Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || '' : Deno.env.get('WHATSAPP_PANEL_SEND_SECRET') || ''
    const settings = { ...panelSendSettings({
      WHATSAPP_PANEL_SEND_ROUTING: manual ? 'instance' : Deno.env.get('WHATSAPP_PANEL_SEND_ROUTING'),
      WHATSAPP_PANEL_SEND_INSTANCE: Deno.env.get('WHATSAPP_PANEL_SEND_INSTANCE'),
      WHATSAPP_PANEL_SEND_RATE_LIMIT: Deno.env.get('WHATSAPP_PANEL_SEND_RATE_LIMIT'),
      WHATSAPP_PANEL_SEND_RATE_WINDOW_SECONDS: Deno.env.get('WHATSAPP_PANEL_SEND_RATE_WINDOW_SECONDS'),
      WHATSAPP_PANEL_SEND_DUPLICATE_WINDOW_SECONDS: Deno.env.get('WHATSAPP_PANEL_SEND_DUPLICATE_WINDOW_SECONDS'),
      WHATSAPP_PANEL_SEND_STALE_PENDING_SECONDS: Deno.env.get('WHATSAPP_PANEL_SEND_STALE_PENDING_SECONDS'),
    }), ...(manual && !openRecipients ? { allowedRecipients: manualQaPhoneList((name: string) => Deno.env.get(name)) } : {}), ...(openRecipients ? { requireRecipientMatch: true } : {}) }
    if (!webhookUrl.startsWith('https://') || !webhookSecret) {
      return fail('El envío por WhatsApp no está configurado.', 503, 'panel_send_not_configured')
    }

    const store = {
      async membership(tenantId: number, userId: string) {
        const { data, error } = await admin.from('barberia_members').select('role').eq('barberia_id', tenantId).eq('user_id', userId).maybeSingle()
        if (error) throw error
        return data
      },
      async accessState(tenantId: number) {
        const { data, error } = await admin.rpc('barberia_access_state', { p_barberia_id: tenantId })
        if (error) throw error
        return data
      },
      async integration(tenantId: number) {
        const { data, error } = await admin
          .from('saas_integraciones')
          .select('estado, external_instance_id')
          .eq('barberia_id', tenantId)
          .eq('proveedor', 'evolution')
          // Como whatsapp-booking-mutation y la plantilla de n8n: sólo la
          // integración de WhatsApp (la unicidad de instancia cubre sólo ese tipo).
          .eq('integration_type', 'whatsapp')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) throw error
        return data
      },
      async botConfig(tenantId: number) {
        const { data, error } = await admin.from('config').select('barberia_id, clave, valor').eq('barberia_id', tenantId).eq('clave', 'bot_activo')
        if (error) throw error
        return data ?? []
      },
      async cliente(tenantId: number, clienteId: number) {
        // El teléfono sale de la ficha del tenant, nunca del body.
        const { data, error } = await admin.from('clientes').select('id, barberia_id, nombre, telefono').eq('id', clienteId).eq('barberia_id', tenantId).maybeSingle()
        if (error) throw error
        return data
      },
      async countRecentPanelSends(tenantId: number, since: string) {
        const { count, error } = await admin.from('mensajes').select('id', { count: 'exact', head: true }).eq('barberia_id', tenantId).eq('de', 'clinica').gte('created_at', since)
        if (error) throw error
        return count ?? 0
      },
      async countEarlierSameText({ tenantId, clienteId, texto, since, beforeId, states }: { tenantId: number, clienteId: number, texto: string, since: string, beforeId: number, states: string[] }) {
        const { count, error } = await admin.from('mensajes').select('id', { count: 'exact', head: true })
          .eq('barberia_id', tenantId).eq('cliente_id', clienteId).eq('de', 'clinica').eq('texto', texto)
          .in('estado_envio', states).gte('created_at', since).lt('id', beforeId)
        if (error) throw error
        return count ?? 0
      },
      async countPanelSendsThrough(tenantId: number, since: string, throughId: number) {
        const { count, error } = await admin.from('mensajes').select('id', { count: 'exact', head: true }).eq('barberia_id', tenantId).eq('de', 'clinica').gte('created_at', since).lte('id', throughId)
        if (error) throw error
        return count ?? 0
      },
      // QA manual requiere el wrapper que valida destinatario bajo lock; no
      // puede degradar al camino sin migración si falta ese contrato.
      async reserve({ tenantId, clienteId, clientMessageId, texto, hora, confirmResend, expectedPhone, settings: s }: { tenantId: number, clienteId: number, clientMessageId: string, texto: string, hora: string | null, confirmResend: boolean, expectedPhone: string, settings: { rateLimit: number, rateWindowSeconds: number, duplicateWindowSeconds: number, stalePendingSeconds: number, allowedRecipients?: string[] } }) {
        const { data, error } = await admin.rpc(manual ? 'reservar_envio_panel_qa_manual' : 'reservar_envio_panel', {
          p_barberia_id: tenantId,
          p_cliente_id: clienteId,
          p_client_message_id: clientMessageId,
          p_texto: texto,
          p_hora: hora,
          p_confirm_resend: confirmResend,
          p_rate_limit: s.rateLimit,
          p_rate_window_seconds: s.rateWindowSeconds,
          p_duplicate_window_seconds: s.duplicateWindowSeconds,
          p_stale_pending_seconds: s.stalePendingSeconds,
          ...(manual ? { p_allowed_phones: openRecipients ? [expectedPhone] : s.allowedRecipients || [] } : {}),
        })
        if (error?.code === 'PGRST202' || error?.code === '42883') return manual ? { status: 'qa_manual_send_not_ready' } : null
        if (error) throw error
        return data
      },
      async complete(tenantId: number, id: number, estado: string, providerMessageId: string | null) {
        const { data, error } = await admin.rpc('completar_envio_panel', { p_barberia_id: tenantId, p_mensaje_id: id, p_resultado: estado, p_proveedor_mensaje_id: providerMessageId })
        if (error) throw error
        return (data as { mensaje?: Record<string, unknown> } | null)?.mensaje ?? null
      },
      async insertMensaje(row: Record<string, unknown>) {
        const { data, error } = await admin.from('mensajes').insert(row).select('*').single()
        if (error) throw error
        return data
      },
      async deleteMensaje(tenantId: number, id: number) {
        const { error } = await admin.from('mensajes').delete().eq('id', id).eq('barberia_id', tenantId)
        if (error) throw error
      },
      async updateMensaje(tenantId: number, id: number, patch: Record<string, unknown>) {
        const { data, error } = await admin.from('mensajes').update(patch).eq('id', id).eq('barberia_id', tenantId).select('*').single()
        if (error) throw error
        return data
      },
    }

    // La plantilla nueva responde después de Evolution con `result`; la
    // anterior responde al recibir (un 2xx sólo prueba la recepción en n8n).
    // Un error de red o timeout puede ocurrir después de que n8n lo recibió:
    // el módulo lo trata como resultado incierto.
    const deliver = async (payload: { telefono: string, texto: string, barberia_id: number, instance: string, client_message_id: string | null }) => {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SECRET_HEADER]: webhookSecret, ...(manual ? { 'user-agent': 'Austral-QA-Integration/1.0' } : {}) },
        body: JSON.stringify(payload),
        // Más que lo que n8n puede tardar en responder (lectura de Supabase 10 s
        // + Evolution 15 s en la plantilla nueva): cortar antes deja "incierto"
        // un envío que salió. Lo comprueba verify-whatsapp-panel-send-workflow.
        signal: AbortSignal.timeout(30_000),
      })
      let parsed: unknown = null
      try { parsed = await response.json() } catch { parsed = null }
      return classifyWebhookResponse(response.status, parsed)
    }

    const result = await handlePanelSend({ user, body, store, deliver, settings })
    return json(result, (result as { uncertain?: boolean }).uncertain ? 202 : 200)
  } catch (error) {
    const { status, body } = panelSendErrorBody(error)
    return json(body, status)
  }
})
