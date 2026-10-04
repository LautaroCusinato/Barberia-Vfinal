-- Comportamiento de la ficha única de cliente entre web y WhatsApp (tarea 35).
-- Cada bloque falla con una excepción si el resultado no es el esperado.
\set ON_ERROR_STOP on

create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FALLA: %', label; end if;
  raise notice 'PASS: %', label;
end; $$;

-- 1. Reserva web: crea la ficha del negocio 1.
select * from public.crear_reserva_publica('negocio-uno', 1, 1, date '2099-01-05', time '10:00', 'Ana Web', '+54 9 11 5555-0001', 'ana@example.com');
select pg_temp.check((select count(*) = 1 from public.clientes where barberia_id = 1 and telefono = '5491155550001'), 'web crea una ficha con teléfono canónico');

-- 2. WhatsApp con el mismo teléfono (JID con 9): reutiliza la ficha y no la sobrescribe.
select * from public.crear_reserva_whatsapp(10, 'evt-chat-1', 1, 1, date '2099-01-06', time '11:00', 'Nombre Del Chat', '5491155550001', 'otro@example.com');
select pg_temp.check((select count(*) = 1 from public.clientes where barberia_id = 1 and telefono = '5491155550001'), 'WhatsApp reutiliza la ficha web (mismo negocio y teléfono)');
select pg_temp.check((select nombre = 'Ana Web' and email = 'ana@example.com' from public.clientes where barberia_id = 1 and telefono = '5491155550001'), 'el chat no sobrescribe nombre ni email de la ficha existente');
select pg_temp.check((select count(distinct cliente_id) = 1 and count(*) = 2 from public.turnos where barberia_id = 1 and telefono = '5491155550001'), 'dos turnos intencionales, una sola ficha');
select pg_temp.check((select proximo_turno = date '2099-01-05' from public.clientes where barberia_id = 1 and telefono = '5491155550001'), 'próximo turno conserva el más cercano');

-- 3. JID sin el 9 (54 + 10 dígitos): mismo cliente.
select * from public.crear_reserva_whatsapp(10, 'evt-chat-sin-9', 1, 1, date '2099-01-07', time '12:00', 'Ana', '541155550001@s.whatsapp.net', null);
select pg_temp.check((select count(*) = 1 from public.clientes where barberia_id = 1), 'teléfono sin 9 se canonicaliza y no duplica');
select pg_temp.check((select count(*) = 3 from public.turnos where barberia_id = 1 and cliente_id = (select id from public.clientes where barberia_id = 1 and telefono = '5491155550001')), 'tercer turno vinculado a la misma ficha');

-- 4. Reintento del mismo evento: no duplica el turno.
select turno_id as primero from public.crear_reserva_whatsapp(10, 'evt-chat-1', 1, 1, date '2099-01-06', time '11:00', 'Nombre Del Chat', '5491155550001', null) \gset
select pg_temp.check((select count(*) = 3 from public.turnos where barberia_id = 1), 'reintento del mismo evento devuelve el turno existente');
select pg_temp.check((select :primero = (select result_reference::bigint from public.saas_automation_events where integration_id = 10 and event_id = 'evt-chat-1')), 'el reintento devuelve el mismo turno_id');

-- 5. Mismo teléfono en otro negocio: ficha separada.
select * from public.crear_reserva_whatsapp(20, 'evt-otro-negocio', 2, 2, date '2099-01-06', time '11:00', 'Ana en Dos', '5491155550001', null);
select pg_temp.check((select count(*) = 1 from public.clientes where barberia_id = 2 and telefono = '5491155550001'), 'otro negocio crea su propia ficha');
select pg_temp.check((select nombre = 'Ana Web' from public.clientes where barberia_id = 1 and telefono = '5491155550001'), 'la ficha del negocio 1 no cambia');
select pg_temp.check((select count(*) = 0 from public.turnos t join public.clientes c on c.id = t.cliente_id where t.barberia_id <> c.barberia_id), 'ningún turno apunta a una ficha de otro negocio');

-- 6. Cliente nuevo por chat y después por web: conserva el nombre del chat.
select * from public.crear_reserva_whatsapp(10, 'evt-nuevo', 1, 1, date '2099-01-08', time '09:00', 'Beto Chat', '5493515550002', null);
select * from public.crear_reserva_publica('negocio-uno', 1, 1, date '2099-01-09', time '09:00', 'Roberto Web', '+54 9 351 555-0002', 'beto@example.com');
select pg_temp.check((select count(*) = 1 from public.clientes where barberia_id = 1 and telefono = '5493515550002'), 'chat y luego web: una ficha');
select pg_temp.check((select nombre = 'Beto Chat' and email = 'beto@example.com' from public.clientes where barberia_id = 1 and telefono = '5493515550002'), 'la web sólo completa el email vacío');

-- 7. Teléfono distinto en la web: otra ficha, sin unir por nombre o email.
select * from public.crear_reserva_publica('negocio-uno', 1, 1, date '2099-01-10', time '09:00', 'Ana Web', '+54 9 11 5555-0099', 'ana@example.com');
select pg_temp.check((select count(*) = 2 from public.clientes where barberia_id = 1 and nombre = 'Ana Web'), 'teléfono distinto no se une por nombre/email');

-- 8. Ficha existente con nombre vacío: el chat lo completa.
insert into public.clientes (barberia_id, nombre, telefono) values (1, '', '5492615550003');
select * from public.crear_reserva_whatsapp(10, 'evt-vacio', 1, 1, date '2099-01-11', time '09:00', 'Carla', '5492615550003', null);
select pg_temp.check((select nombre = 'Carla' from public.clientes where barberia_id = 1 and telefono = '5492615550003'), 'nombre vacío se completa');

-- 9. Identidad que no es un celular (por ejemplo un LID): rechazo sin crear ficha.
do $$
begin
  perform * from public.crear_reserva_whatsapp(10, 'evt-lid', 1, 1, date '2099-01-12', time '09:00', 'Lid', '123456789012345', null);
  raise exception 'FALLA: un número no canónico no debe reservar';
exception when sqlstate '22023' then
  raise notice 'PASS: identidad no telefónica rechazada (22023)';
end $$;
select pg_temp.check((select count(*) = 0 from public.clientes where telefono like '%123456789012345%'), 'sin ficha para la identidad rechazada');
select pg_temp.check((select count(*) = 0 from public.saas_automation_events where event_id = 'evt-lid'), 'el rechazo no deja un reclamo del evento (reintento posible)');

-- 10. Nombre vacío o demasiado largo: rechazo.
do $$
begin
  perform * from public.crear_reserva_whatsapp(10, 'evt-sin-nombre', 1, 1, date '2099-01-12', time '10:00', '   ', '5491155550004', null);
  raise exception 'FALLA: nombre vacío no debe reservar';
exception when sqlstate '22023' then
  raise notice 'PASS: nombre vacío rechazado';
end $$;
do $$
begin
  perform * from public.crear_reserva_whatsapp(10, 'evt-nombre-largo', 1, 1, date '2099-01-12', time '10:30', repeat('a', 121), '5491155550004', null);
  raise exception 'FALLA: nombre largo no debe reservar';
exception when sqlstate '22023' then
  raise notice 'PASS: nombre de más de 120 caracteres rechazado';
end $$;

-- 11. Grants sin cambios: sólo service_role ejecuta la RPC de WhatsApp.
select pg_temp.check(not has_function_privilege('anon', 'public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text)', 'execute'), 'anon no ejecuta crear_reserva_whatsapp');
select pg_temp.check(not has_function_privilege('authenticated', 'public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text)', 'execute'), 'authenticated no ejecuta crear_reserva_whatsapp');
select pg_temp.check(has_function_privilege('service_role', 'public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text)', 'execute'), 'service_role ejecuta crear_reserva_whatsapp');
