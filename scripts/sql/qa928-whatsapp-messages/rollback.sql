-- Apagar primero el modo manual QA928 y revertir los handlers nuevos.
-- Conserva todas las filas. Las columnas aditivas permanecen como historial;
-- no se borran identificadores que harían perder idempotencia al reaplicar.
begin;
drop function if exists public.registrar_mensaje_whatsapp_qa928(bigint,text,text,text,text,timestamptz,text,text);
-- El código viejo no conoce el marcador. Un rótulo provisional nunca debe
-- convertirse, al revertir, en un nombre válido para una reserva.
update public.clientes set nombre = ''
where barberia_id=928 and whatsapp_nombre_pendiente=true
  and nombre = 'Contacto WhatsApp · …' || right(telefono,4);
commit;
