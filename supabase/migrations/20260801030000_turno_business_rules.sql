-- Reglas de agenda aplicadas en la base para todos los canales (panel,
-- WhatsApp y reserva pública). Así el navegador o n8n no pueden crear un
-- turno fuera de horario, bloqueado o con una duración incorrecta.
begin;

create or replace function public.validate_turno_business_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia_tz text;
  v_duracion integer;
  v_inicio timestamp;
  v_fin timestamp;
  v_schedule_ok boolean;
begin
  -- Al cancelar o marcar como no asistió no se debe volver a validar el
  -- horario: esa acción libera el espacio y también puede hacerse sobre un
  -- turno histórico.
  if new.estado in ('cancelado', 'no_asistio') then
    return new;
  end if;

  -- Una modificación que solo cambia datos administrativos (por ejemplo,
  -- pasar de confirmado a atendido) no debe romper turnos históricos.
  if tg_op = 'UPDATE'
     and new.barberia_id = old.barberia_id
     and new.barbero_id = old.barbero_id
     and new.servicio_id = old.servicio_id
     and new.fecha = old.fecha
     and new.hora = old.hora
     and new.duracion_min = old.duracion_min
  then
    return new;
  end if;

  select b.zona_horaria
    into v_barberia_tz
  from public.barberias b
  where b.id = new.barberia_id;

  if v_barberia_tz is null then
    raise exception 'La barbería indicada no existe.' using errcode = '22023';
  end if;

  select coalesce(bs.duracion_min, s.duracion_min)
    into v_duracion
  from public.servicios s
  join public.barbero_servicios bs
    on bs.servicio_id = s.id
   and bs.barbero_id = new.barbero_id
  join public.barberos br
    on br.id = bs.barbero_id
   and br.barberia_id = new.barberia_id
   and br.activo
  where s.id = new.servicio_id
    and s.barberia_id = new.barberia_id
    and s.activo;

  if v_duracion is null then
    raise exception 'El barbero no realiza ese servicio o está inactivo.'
      using errcode = '22023';
  end if;

  -- La duración efectiva siempre sale de la relación servicio/barbero.
  new.duracion_min := v_duracion;

  v_inicio := new.fecha::timestamp + new.hora::time;
  v_fin := v_inicio + make_interval(mins => v_duracion);

  if v_inicio < (now() at time zone v_barberia_tz) then
    raise exception 'No se puede reservar un horario que ya pasó.' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.horarios_barbero h
    where h.barberia_id = new.barberia_id
      and h.barbero_id = new.barbero_id
      and h.activo
      and h.day_of_week = extract(dow from new.fecha)::smallint
      and v_inicio::time >= h.start_time
      and v_fin::time <= h.end_time
  ) into v_schedule_ok;

  if not v_schedule_ok then
    raise exception 'El barbero no trabaja durante toda la duración elegida.'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.bloqueos_agenda ba
    where ba.barberia_id = new.barberia_id
      and ba.fecha = new.fecha
      and (ba.barbero_id is null or ba.barbero_id = new.barbero_id)
      and tsrange(new.fecha::timestamp + ba.start_time,
                  new.fecha::timestamp + ba.end_time, '[)')
          && tsrange(v_inicio, v_fin, '[)')
  ) then
    raise exception 'El horario está bloqueado para ese día.' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_turnos_business_rules on public.turnos;
create trigger trg_turnos_business_rules
before insert or update of barberia_id, barbero_id, servicio_id, fecha, hora, duracion_min, estado
on public.turnos
for each row execute function public.validate_turno_business_rules();

comment on function public.validate_turno_business_rules() is
  'Valida duración, horario laboral, bloqueos y relaciones antes de crear o mover turnos.';

-- Solo debe invocarse como trigger; no se expone como RPC al navegador.
revoke execute on function public.validate_turno_business_rules() from public, anon, authenticated;

commit;
