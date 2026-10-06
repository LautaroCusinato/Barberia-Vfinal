-- Rollback de 20261005120000_whatsapp_panel_send_atomic.sql (tarea 38).
--
-- Antes de ejecutarlo, conviene volver la Edge Function whatsapp-panel-send a
-- 7fba130 (no usa estas RPC). La versión dc80b5b o posterior también tolera
-- el rollback: ante la RPC ausente (PGRST202) usa el camino sin migración;
-- hasta que PostgREST recargue su caché de esquema, un envío puede fallar con
-- "No se pudo guardar el mensaje" (no se envía nada y el panel conserva el
-- borrador).
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
