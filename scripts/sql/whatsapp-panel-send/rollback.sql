-- Rollback de 20261005120000_whatsapp_panel_send_atomic.sql (tarea 38).
--
-- Antes de ejecutarlo, volver la Edge Function whatsapp-panel-send a una
-- versión que no llame a reservar_envio_panel / completar_envio_panel (la
-- versión 7fba130 detecta la RPC ausente y usa su camino sin migración).
--
-- Conserva todas las filas de mensajes. Pierde sólo client_message_id y
-- envio_actualizado_at; los estados nuevos (pendiente, recibido_n8n, aceptado,
-- incierto, fallido) quedan como texto y el panel anterior no los interpreta.
begin;

drop function if exists public.reservar_envio_panel(bigint, bigint, uuid, text, text, boolean, integer, integer, integer, integer);
drop function if exists public.completar_envio_panel(bigint, bigint, text, text);
drop function if exists public.recuperar_envios_panel_pendientes(bigint, integer);
drop function if exists public.telefono_whatsapp_canonico(text);
alter table public.mensajes drop constraint if exists mensajes_estado_envio_valido;
drop index if exists public.uq_mensajes_barberia_client_message;
drop index if exists public.idx_mensajes_panel_envios;
alter table public.mensajes
  drop column if exists client_message_id,
  drop column if exists envio_actualizado_at;

commit;
