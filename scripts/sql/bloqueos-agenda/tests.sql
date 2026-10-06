\set ON_ERROR_STOP on
-- Comprobaciones de la tarea 41 sobre el código real de las migraciones.
-- Fechas relativas a hoy en la zona del negocio para no chocar con "ya pasó".
create function public.d(n int) returns date language sql stable as $$ select ((now() at time zone 'America/Argentina/Buenos_Aires')::date + n) $$;
-- Helpers (corren con el rol actual): 'ok' o 'SQLSTATE:mensaje'.
create function public.try_bloqueo(p_barberia bigint, p_barbero bigint, p_fecha date, p_ini time default '00:00', p_fin time default '23:59', p_tipo text default 'cierre') returns text language plpgsql as $$
begin
  insert into public.bloqueos_agenda (barberia_id, barbero_id, fecha, start_time, end_time, motivo, tipo) values (p_barberia, p_barbero, p_fecha, p_ini, p_fin, 'Prueba', p_tipo);
  return 'ok';
exception when others then return sqlstate || ':' || sqlerrm;
end $$;
create function public.try_turno(p_barbero bigint, p_fecha date, p_hora time) returns text language plpgsql as $$
begin
  insert into public.turnos (barberia_id, barbero_id, servicio_id, fecha, hora) values (1, p_barbero, 1, p_fecha, p_hora);
  return 'ok';
exception when others then return sqlstate || ':' || sqlerrm;
end $$;
grant execute on all functions in schema public to authenticated;

-- Turno existente ANTES de bloquear (debe conservarse).
insert into public.turnos (barberia_id, barbero_id, servicio_id, fecha, hora, paciente) values (1, 11, 1, public.d(10), '10:00', 'Existente');

set role authenticated;
-- 1. Permisos de escritura (políticas vigentes de 20261003090000).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) as sub \gset
do $$ begin
  assert public.try_bloqueo(1, null, public.d(10)) = 'ok', 'dueño bloquea negocio completo';
  assert public.try_bloqueo(1, 21, public.d(11)) like '23503:%', 'profesional de otro negocio: guarda de tenant';
  assert public.try_bloqueo(2, null, public.d(11)) like '42501:%', 'dueño de 1 no escribe en el negocio 2';
  assert public.try_bloqueo(1, null, public.d(11), '10:00', '10:00') like '23514:%', 'inicio < fin';
  assert public.try_bloqueo(1, null, public.d(11), '00:00', '23:59', 'total') like '23514:%', 'tipo fuera del CHECK';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false) as sub \gset
do $$ begin
  assert public.try_bloqueo(1, 12, public.d(11)) = 'ok', 'admin bloquea a un profesional';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) as sub \gset
do $$ declare n int; begin
  assert public.try_bloqueo(1, null, public.d(12)) like '42501:%', 'recepcionista no bloquea';
  assert (select count(*) from public.bloqueos_agenda) = 2, 'recepcionista ve los bloqueos de su negocio';
  with borrados as (delete from public.bloqueos_agenda where fecha = public.d(10) returning id) select count(*) into n from borrados;
  assert n = 0, 'recepcionista: DELETE afecta 0 filas sin error (el panel lo detecta)';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false) as sub \gset
do $$ begin
  assert public.try_bloqueo(1, 11, public.d(12)) like '42501:%', 'barbero no bloquea';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false) as sub \gset
do $$ declare n int; begin
  assert (select count(*) from public.bloqueos_agenda) = 0, 'otro negocio no ve bloqueos ajenos';
  with borrados as (delete from public.bloqueos_agenda returning id) select count(*) into n from borrados;
  assert n = 0, 'otro negocio no borra bloqueos ajenos';
end $$;
reset role;
do $$ begin assert (select count(*) from public.bloqueos_agenda) = 2, 'los dos bloqueos siguen'; end $$;

-- 2. El trigger de turnos (panel, web y WhatsApp insertan en turnos) respeta bloqueos.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) as sub \gset
do $$ begin
  assert public.try_turno(12, public.d(10), '10:30') like '22023:El horario está bloqueado%', 'bloqueo del negocio rechaza a cualquier profesional';
  assert public.try_turno(12, public.d(11), '10:00') like '22023:El horario está bloqueado%', 'bloqueo del profesional lo rechaza';
  assert public.try_turno(11, public.d(11), '10:00') = 'ok', 'bloqueo de un profesional no afecta a otro';
  assert public.try_turno(11, public.d(10), '17:30') like '22023:%bloqueado%', 'último horario del día (termina 18:00) bloqueado';
end $$;

-- 3. El turno previo se conserva y se puede operar, pero no mover dentro del bloqueo.
do $$ declare h text; begin
  assert (select count(*) from public.turnos where paciente = 'Existente') = 1, 'turno existente intacto';
  update public.turnos set estado = 'atendido' where paciente = 'Existente';
  assert (select estado from public.turnos where paciente = 'Existente') = 'atendido', 'cambio de estado permitido';
  begin
    update public.turnos set hora = '11:00' where paciente = 'Existente';
    h := 'ok';
  exception when others then h := sqlerrm;
  end;
  assert h like 'El horario está bloqueado%', 'mover dentro del bloqueo se rechaza: ' || h;
end $$;

-- 4. Desbloquear quita sólo la fila elegida; los superpuestos siguen vigentes.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) as sub \gset
do $$ declare global_id bigint; begin
  assert public.try_bloqueo(1, null, public.d(13)) = 'ok', 'global d13';
  assert public.try_bloqueo(1, 11, public.d(13), '13:00', '15:00', 'bloqueo') = 'ok', 'parcial d13';
  select id into global_id from public.bloqueos_agenda where fecha = public.d(13) and barbero_id is null;
  delete from public.bloqueos_agenda where id = global_id and barberia_id = 1;
  assert (select count(*) from public.bloqueos_agenda where fecha = public.d(13)) = 1, 'queda el parcial';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) as sub \gset
do $$ begin
  assert public.try_turno(11, public.d(13), '13:30') like '22023:%bloqueado%', 'el parcial sigue bloqueando su franja';
  assert public.try_turno(11, public.d(13), '10:00') = 'ok', 'fuera del parcial vuelve a estar disponible';
  assert public.try_turno(12, public.d(13), '13:30') = 'ok', 'el parcial de Lucas no afecta a Mora';
end $$;

-- 5. Desbloquear el día restituye la disponibilidad; Deshacer = volver a insertar.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) as sub \gset
do $$ begin
  delete from public.bloqueos_agenda where fecha = public.d(10) and barbero_id is null and barberia_id = 1;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) as sub \gset
do $$ begin
  assert public.try_turno(12, public.d(10), '10:30') = 'ok', 'tras desbloquear se puede reservar';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) as sub \gset
do $$ begin
  assert public.try_bloqueo(1, null, public.d(10)) = 'ok', 'deshacer: se vuelve a bloquear aunque haya turnos';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) as sub \gset
do $$ begin
  assert public.try_turno(12, public.d(10), '15:00') like '22023:%bloqueado%', 'restaurado: vuelve a rechazar';
  assert (select count(*) from public.turnos where fecha = public.d(10)) = 2, 'los turnos del día siguen intactos';
end $$;

-- 6. Medianoche: el bloqueo de un día no afecta al anterior ni al siguiente.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) as sub \gset
do $$ begin assert public.try_bloqueo(1, null, public.d(15)) = 'ok', 'global d15'; end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false) as sub \gset
do $$ begin
  assert public.try_turno(11, public.d(14), '17:30') = 'ok', 'día anterior libre';
  assert public.try_turno(11, public.d(16), '09:00') = 'ok', 'día siguiente libre';
  assert public.try_turno(11, public.d(15), '09:00') like '22023:%bloqueado%', 'primer horario bloqueado';
end $$;
reset role;
\echo 'tests.sql: PASS'
