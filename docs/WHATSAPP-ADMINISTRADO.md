# WhatsApp administrado (cualquier negocio)

Publicado el 10/10/2026. Un dueño vincula el WhatsApp de su negocio desde
**Configuración → Conectar WhatsApp**, escanea el QR y el asistente queda
respondiendo, guardando la conversación en Mensajes, reservando y confirmando
turnos de ese negocio.

## Recorrido

1. El panel llama a `whatsapp-production-provision` (`prepare`). La función
   crea la instancia `austral-prod-tenant-<id>` en Evolution y apunta su
   webhook a `whatsapp-evolution-webhook` de producción con los eventos
   `CONNECTION_UPDATE`, `MESSAGES_UPSERT` y `QRCODE_UPDATED`.
2. Mientras se vincula, el panel consulta `status` cada 4 s: el QR rota con
   lo que entrega Evolution y, al escanearlo, la conexión queda `CONNECTED`
   con automatización, respuestas y reservas activas.
3. Cada mensaje entra por `whatsapp-evolution-webhook`: se guarda en la
   bandeja (`registrar_mensaje_whatsapp`), se arma la respuesta y se avisa al
   workflow n8n `Austral WhatsApp administrado - conversación, reserva y
   confirmación`, que llama a `whatsapp-agent-outbound-pilot` y a
   `whatsapp-booking-mutation`.
4. Desde Mensajes, el envío manual usa `whatsapp-panel-send` →
   `reservar_envio_panel_administrado` → workflow `envío manual del panel`.
   Enviar a mano pausa el bot de ese negocio (atención humana).

El negocio siempre sale de la conexión/integración del servidor; nunca del
navegador ni de n8n. `miwsp` y las instancias de QA quedan fuera.

## Requisitos del negocio

Para reservar por chat el negocio necesita al menos un servicio activo, un
profesional activo que lo realice y su horario semanal. Sin eso el asistente
responde, pero no puede ofrecer horarios.

## Configuración (producción)

Secretos de las funciones: `WHATSAPP_MANAGED_RUNTIME_ENABLED=1`,
`EVOLUTION_WEBHOOK_SECRET` (el mismo que usa n8n),
`WHATSAPP_INTERNAL_FUNCTION_SECRET` (clave secreta del proyecto que usa la
credencial n8n `Austral Producción Funciones`) y
`WHATSAPP_QA_MANUAL_CONCIERGE_ENABLED=1` (asistente completo).

Workflows n8n (generados con `node scripts/prepare-whatsapp-managed-workflows.mjs`):
`australManagedRoute`, `australManagedLanguage`, `australManagedPanel`.

## Apagado de emergencia

- Todo el bot de producción: `supabase secrets unset WHATSAPP_MANAGED_RUNTIME_ENABLED --project-ref ssagttjdgtypxjcgdnrw`
  (el webhook responde 503 y no procesa nada).
- Un negocio: poner `automation_enabled=false` en su fila de
  `saas_whatsapp_connections`, o pausar el bot desde Mensajes.

## Pruebas

`node scripts/verify-whatsapp-managed-production.mjs` simula un negocio de
producción de punta a punta (conversación, bandeja, reserva, confirmación
única, pausa y apagado). No reemplaza una prueba con un teléfono real.
