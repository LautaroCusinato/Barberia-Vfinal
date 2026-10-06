import { adminClient, authenticate } from '../_shared/supabase.ts'
import { corsHeaders, json, readJson } from '../_shared/http.ts'
import { classifyWebhookStatus, handlePanelSend, panelSendErrorBody } from '../_shared/whatsappPanelSend.mjs'

// Reemplaza el envío directo navegador → n8n. Antes la URL del webhook vivía
// en una variable VITE_* (pública en el bundle) y cualquiera podía mandar
// mensajes desde el número del negocio. Ahora el navegador sólo envía
// tenant_id + cliente_id + texto con su sesión; acá validamos la membresía,
// el rol, el plan, la conexión de WhatsApp y la ficha del cliente (el teléfono
// nunca viene del body), guardamos el mensaje y recién entonces reenviamos a
// n8n con un secreto server-side. `action: 'preflight'` valida sin enviar.
// El webhook de n8n envía por una instancia fija: WHATSAPP_PANEL_SEND_INSTANCE
// declara cuál es, y sólo el negocio dueño de esa instancia puede usarlo.
// La lógica vive en _shared/whatsappPanelSend.mjs para poder probarla.
const SECRET_HEADER = 'X-Austral-Panel-Secret'

function fail(message: string, status: number, code: string) {
  return json({ error: { code, message } }, status)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return fail('Método no permitido.', 405, 'method_not_allowed')

  try {
    const webhookUrl = Deno.env.get('WHATSAPP_PANEL_SEND_WEBHOOK_URL') || ''
    const webhookSecret = Deno.env.get('WHATSAPP_PANEL_SEND_SECRET') || ''
    const senderInstance = Deno.env.get('WHATSAPP_PANEL_SEND_INSTANCE') || ''
    if (!webhookUrl.startsWith('https://') || !webhookSecret) {
      return fail('El envío por WhatsApp no está configurado.', 503, 'panel_send_not_configured')
    }

    const admin = adminClient()
    const user = await authenticate(request, admin)
    const body = await readJson(request, 16 * 1024)

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

    // Con el webhook actual (responde al recibir) un 2xx sólo significa que
    // n8n lo aceptó. Un error de red o timeout puede ocurrir después de que
    // n8n lo recibió: el módulo lo trata como resultado incierto.
    const deliver = async (payload: { telefono: string, texto: string, barberia_id: number, instance: string }) => {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SECRET_HEADER]: webhookSecret },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      })
      return classifyWebhookStatus(response.status)
    }

    const result = await handlePanelSend({ user, body, store, deliver, senderInstance })
    return json(result, (result as { uncertain?: boolean }).uncertain ? 202 : 200)
  } catch (error) {
    const { status, body } = panelSendErrorBody(error)
    return json(body, status)
  }
})
