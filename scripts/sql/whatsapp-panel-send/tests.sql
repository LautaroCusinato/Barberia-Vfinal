-- Pruebas secuenciales de las RPC del envío del panel (tarea 38). La
-- concurrencia con sesiones reales está en run.sh.
\set ON_ERROR_STOP on

create function public.t_assert(cond boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALLA: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

-- Atajo: reserva como service_role con límites de prueba explícitos.
create function public.t_res(p_cliente bigint, p_key uuid, p_texto text, p_confirm boolean default false, p_limit int default 20, p_tenant bigint default 1)
returns jsonb language sql as $$
  select public.reservar_envio_panel(p_tenant, p_cliente, p_key, p_texto, '12:00', p_confirm, p_limit, 60, 300, 120) $$;
grant execute on function public.t_res(bigint, uuid, text, boolean, int, bigint) to service_role;

-- 0. Filas históricas: NOT VALID no las revisa; VALIDATE las detecta (paso
-- aparte del plan de publicación, después de revisar los datos).
select public.t_assert((select count(*) from public.mensajes where estado_envio = 'legado_raro') = 1, 'NOT VALID conserva filas históricas');
do $$ begin
  alter table public.mensajes validate constraint mensajes_estado_envio_valido;
  raise exception 'FALLA: validó con una fila inválida';
exception when check_violation then raise notice 'ok: VALIDATE detecta filas históricas fuera de la lista';
end $$;

-- 1. Permisos: el navegador (anon/authenticated) no puede ejecutar las RPC.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  perform public.reservar_envio_panel(1, 1, gen_random_uuid(), 'hola');
  raise exception 'FALLA: authenticated pudo reservar';
exception when insufficient_privilege then raise notice 'ok: authenticated no ejecuta reservar_envio_panel';
end $$;
do $$ begin
  perform public.completar_envio_panel(1, 1, 'aceptado');
  raise exception 'FALLA: authenticated pudo completar';
exception when insufficient_privilege then raise notice 'ok: authenticated no ejecuta completar_envio_panel';
end $$;
do $$ begin
  perform public.recuperar_envios_panel_pendientes(1, 120);
  raise exception 'FALLA: authenticated pudo recuperar';
exception when insufficient_privilege then raise notice 'ok: authenticated no ejecuta recuperar_envios_panel_pendientes';
end $$;
-- Compatibilidad: el panel anterior sigue insertando por RLS sin estado (= 'enviado').
insert into public.mensajes (barberia_id, cliente_id, paciente, texto, de, hora, leido) values (1, 1, 'Ana Pérez', 'panel viejo', 'clinica', '11:00', true);
select public.t_assert((select estado_envio from public.mensajes where texto = 'panel viejo') = 'enviado', 'el panel anterior inserta con el estado por defecto');
-- Un readonly no escribe (RLS sin cambios).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  insert into public.mensajes (barberia_id, cliente_id, paciente, texto, de) values (1, 1, 'Ana', 'readonly', 'clinica');
  raise exception 'FALLA: readonly insertó';
exception when insufficient_privilege then raise notice 'ok: readonly no inserta mensajes';
end $$;
reset role;
delete from public.mensajes where texto = 'panel viejo';

set role service_role;

-- 2. Primera reserva: fila pendiente, teléfono canónico y nombre de la ficha, bot pausado.
select public.t_assert((public.t_res(1, '11111111-1111-4111-8111-111111111111', '  Hola Ana  ')) ->> 'status' = 'reserved', 'reserva nueva');
select public.t_assert((select count(*) from public.mensajes where client_message_id = '11111111-1111-4111-8111-111111111111') = 1, 'una fila');
select public.t_assert((select estado_envio = 'pendiente' and telefono = '5491122334455' and paciente = 'Ana Pérez' and texto = 'Hola Ana' and cliente_id = 1 and not enviado_wsp from public.mensajes where client_message_id = '11111111-1111-4111-8111-111111111111'), 'pendiente con teléfono canónico, nombre de la ficha y texto recortado');
select public.t_assert((select valor from public.config where barberia_id = 1 and clave = 'bot_activo') = 'false', 'P4: la reserva pausa el bot antes del envío');

-- 3. Respuesta perdida / doble clic: el mismo identificador es una repetición.
select public.t_assert((public.t_res(1, '11111111-1111-4111-8111-111111111111', 'Hola Ana')) ->> 'status' = 'replay', 'mismo identificador = replay');
select public.t_assert((public.t_res(1, '11111111-1111-4111-8111-111111111111', 'Hola Ana', true)) ->> 'status' = 'replay', 'confirmar no reenvía un pendiente');
select public.t_assert((select count(*) from public.mensajes where texto = 'Hola Ana') = 1, 'sin fila nueva');
select public.t_assert((public.t_res(1, '11111111-1111-4111-8111-111111111111', 'Otro texto')) ->> 'status' = 'idempotency_conflict', 'mismo identificador con otro texto = conflicto');
select public.t_assert((public.t_res(2, '11111111-1111-4111-8111-111111111111', 'Hola Ana')) ->> 'status' = 'idempotency_conflict', 'mismo identificador con otro cliente = conflicto');

-- 4. Tenant ajeno: un cliente del negocio 2 no existe para el negocio 1.
select public.t_assert((public.t_res(4, gen_random_uuid(), 'Hola Zoe')) ->> 'status' = 'customer_not_found', 'cliente de otro negocio');
-- El mismo identificador en otro negocio es independiente.
select public.t_assert((public.t_res(4, '11111111-1111-4111-8111-111111111111', 'Hola Zoe', false, 20, 2)) ->> 'status' = 'reserved', 'identificador por negocio');
select public.t_assert((select count(*) from public.mensajes where barberia_id = 2) = 1, 'la fila queda en el negocio 2');
select public.t_assert((select valor from public.config where barberia_id = 2) = 'false' and (select count(*) from public.config) = 2, 'la pausa es del negocio correspondiente');

-- 5. Teléfonos.
select public.t_assert((public.t_res(3, gen_random_uuid(), 'Hola Caro')) ->> 'status' = 'customer_phone_invalid', 'teléfono fijo inválido');
select public.t_assert((public.t_res(2, gen_random_uuid(), 'Hola Beto')) -> 'mensaje' ->> 'telefono' = '5491166667777', '54 sin 9 se normaliza a 549');
select public.t_assert(public.telefono_whatsapp_canonico('1122334455') is null, 'sin código de país no es canónico');

-- 6. Texto repetido en la ventana (propuesta: 300 s).
select public.t_assert((public.t_res(1, gen_random_uuid(), 'Hola Ana')) ->> 'status' = 'possible_duplicate', 'mismo texto, otro identificador = posible duplicado');
select public.t_assert((public.t_res(1, '22222222-2222-4222-8222-222222222222', 'Hola Ana', true)) ->> 'status' = 'reserved', 'con confirmación explícita se reserva');
update public.mensajes set created_at = now() - interval '10 minutes' where texto = 'Hola Beto';
select public.t_assert((public.t_res(2, gen_random_uuid(), 'Hola Beto')) ->> 'status' = 'reserved', 'fuera de la ventana no se frena');

-- 7. Completar: estados permitidos, evidencia del proveedor y tenant.
select public.t_assert((public.completar_envio_panel(1, (select id from public.mensajes where client_message_id = '11111111-1111-4111-8111-111111111111' and barberia_id = 1), 'aceptado', 'EVO-KEY-1')) ->> 'status' = 'updated', 'aceptado por Evolution');
select public.t_assert((select estado_envio = 'aceptado' and whatsapp_id = 'EVO-KEY-1' and enviado_wsp from public.mensajes where client_message_id = '11111111-1111-4111-8111-111111111111' and barberia_id = 1), 'guarda el id de Evolution');
select public.t_assert((public.completar_envio_panel(1, (select id from public.mensajes where client_message_id = '11111111-1111-4111-8111-111111111111' and barberia_id = 1), 'fallido')) ->> 'status' = 'not_pending', 'no retrocede un aceptado');
select public.t_assert((public.completar_envio_panel(1, (select id from public.mensajes where barberia_id = 2), 'aceptado')) ->> 'status' = 'not_found', 'no completa filas de otro negocio');
do $$ begin
  perform public.completar_envio_panel(1, 1, 'entregado');
  raise exception 'FALLA: se marcó entregado sin evidencia';
exception when invalid_parameter_value then raise notice 'ok: entregado no se acepta desde el envío';
end $$;
select public.t_assert((public.completar_envio_panel(1, (select id from public.mensajes where client_message_id = '22222222-2222-4222-8222-222222222222'), 'recibido_n8n')) -> 'mensaje' ->> 'estado_envio' = 'recibido_n8n', 'recibido por n8n (plantilla anterior)');

-- 8. Rechazo confirmado: el mismo identificador reintenta sobre la misma fila.
select public.t_res(1, '33333333-3333-4333-8333-333333333333', 'Tercero');
select public.completar_envio_panel(1, (select id from public.mensajes where client_message_id = '33333333-3333-4333-8333-333333333333'), 'fallido');
select public.t_assert((public.t_res(1, '33333333-3333-4333-8333-333333333333', 'Tercero')) ->> 'status' = 'reserved', 'fallido + mismo identificador = nuevo intento');
select public.t_assert((select count(*) = 1 and bool_and(estado_envio = 'pendiente') from public.mensajes where client_message_id = '33333333-3333-4333-8333-333333333333'), 'misma fila, vuelve a pendiente');

-- 9. Incierto: sólo se reintenta con confirmación explícita.
select public.completar_envio_panel(1, (select id from public.mensajes where client_message_id = '33333333-3333-4333-8333-333333333333'), 'incierto');
select public.t_assert((public.t_res(1, '33333333-3333-4333-8333-333333333333', 'Tercero')) ->> 'status' = 'replay', 'incierto sin confirmación = replay');
select public.t_assert((public.t_res(1, '33333333-3333-4333-8333-333333333333', 'Tercero', true)) ->> 'status' = 'reserved', 'incierto con confirmación = nuevo intento');
-- Evidencia tardía mejora un incierto.
select public.completar_envio_panel(1, (select id from public.mensajes where client_message_id = '33333333-3333-4333-8333-333333333333'), 'incierto');
select public.t_assert((public.completar_envio_panel(1, (select id from public.mensajes where client_message_id = '33333333-3333-4333-8333-333333333333'), 'aceptado', 'EVO-3')) ->> 'status' = 'updated', 'incierto -> aceptado con evidencia');

-- 10. Recuperación: pendiente abandonado pasa a incierto y no se reenvía.
select public.t_res(1, '44444444-4444-4444-8444-444444444444', 'Abandonado');
update public.mensajes set envio_actualizado_at = now() - interval '5 minutes', created_at = now() - interval '5 minutes' where client_message_id = '44444444-4444-4444-8444-444444444444';
insert into public.mensajes (barberia_id, cliente_id, paciente, texto, de, estado_envio, created_at) values (1, 1, 'Ana', 'sin identificador', 'clinica', 'pendiente', now() - interval '1 hour');
select public.t_assert(public.recuperar_envios_panel_pendientes(1, 120) = 1, 'recupera sólo el pendiente con identificador');
select public.t_assert((select estado_envio from public.mensajes where client_message_id = '44444444-4444-4444-8444-444444444444') = 'incierto', 'queda incierto');
select public.t_assert((select estado_envio from public.mensajes where texto = 'sin identificador') = 'pendiente', 'no toca filas ajenas al flujo nuevo');
select public.t_assert((public.t_res(1, '44444444-4444-4444-8444-444444444444', 'Abandonado')) ->> 'status' = 'replay', 'un recuperado no se reenvía solo');
delete from public.mensajes where texto = 'sin identificador';
do $$ begin
  perform public.recuperar_envios_panel_pendientes(1, 5);
  raise exception 'FALLA: ventana demasiado corta aceptada';
exception when invalid_parameter_value then raise notice 'ok: ventana de recuperación mínima';
end $$;

-- 11. Límite secuencial (valor de prueba: 3) y fallidos que no cuentan.
delete from public.mensajes where barberia_id = 1;
select public.t_assert((public.t_res(1, gen_random_uuid(), 'L1', false, 3)) ->> 'status' = 'reserved', 'límite 1/3');
select public.t_assert((public.t_res(1, gen_random_uuid(), 'L2', false, 3)) ->> 'status' = 'reserved', 'límite 2/3');
select public.t_assert((public.t_res(1, '55555555-5555-4555-8555-555555555555', 'L3', false, 3)) ->> 'status' = 'reserved', 'límite 3/3');
select public.t_assert((public.t_res(1, gen_random_uuid(), 'L4', false, 3)) ->> 'status' = 'rate_limited', 'el cuarto se frena');
select public.t_assert((select count(*) from public.mensajes where barberia_id = 1) = 3, 'el frenado no deja fila');
select public.completar_envio_panel(1, (select id from public.mensajes where client_message_id = '55555555-5555-4555-8555-555555555555'), 'fallido');
select public.t_assert((public.t_res(1, gen_random_uuid(), 'L4', false, 3)) ->> 'status' = 'reserved', 'un fallido libera su lugar');
select public.t_assert((public.t_res(1, '55555555-5555-4555-8555-555555555555', 'L3', false, 3)) ->> 'status' = 'rate_limited', 'reintentar un fallido también respeta el límite');
select public.t_assert((public.t_res(4, gen_random_uuid(), 'Otro negocio', false, 3, 2)) ->> 'status' = 'reserved', 'el límite es por negocio');

-- 12. Parámetros inválidos y restricción de estados.
do $$ begin
  perform public.reservar_envio_panel(1, 1, gen_random_uuid(), 'x', null, false, 0);
  raise exception 'FALLA: límite 0 aceptado';
exception when invalid_parameter_value then raise notice 'ok: límite inválido';
end $$;
do $$ begin
  perform public.reservar_envio_panel(1, 1, gen_random_uuid(), '   ');
  raise exception 'FALLA: texto vacío aceptado';
exception when invalid_parameter_value then raise notice 'ok: texto vacío';
end $$;
do $$ begin
  perform public.reservar_envio_panel(1, 1, null, 'x');
  raise exception 'FALLA: sin identificador aceptado';
exception when invalid_parameter_value then raise notice 'ok: identificador obligatorio';
end $$;
reset role;
do $$ begin
  insert into public.mensajes (barberia_id, paciente, texto, de, estado_envio) values (1, 'x', 'x', 'clinica', 'cualquiera');
  raise exception 'FALLA: estado inválido aceptado';
exception when check_violation then raise notice 'ok: estado inválido rechazado';
end $$;

-- Limpieza para la etapa de concurrencia.
delete from public.mensajes where barberia_id = 1;
delete from public.config;
select 'SQL secuencial: PASS';
