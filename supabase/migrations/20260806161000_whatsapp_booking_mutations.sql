-- Mutaciones controladas de agenda para el canal WhatsApp.
-- Todas las funciones derivan el tenant desde la integración y sólo son
-- invocables por el rol service_role usado por n8n.
begin;

create or replace function public.consultar_reserva_whatsapp(
  p_integration_id bigint,
  p_turno_id bigint,
  p_telefono text
)
returns table (
  tenant_id bigint,
  turno_id bigint,
  fecha date,
  hora time,
  duracion_min integer,
  motivo text,
  estado text,
  barbero_nombre text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.saas_integraciones%rowtype;
  v_barberia public.barberias%rowtype;
  v_phone text := regexp_replace(coalesce(btrim(p_telefono), ''), '[^0-9]', '', 'g');
begin
  select i.* into v_integration
  from public.saas_integraciones i
  where i.id = p_integration_id
    and i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp'
    and i.estado = 'conectado';
  if not found then
    raise exception 'La integración de WhatsApp no está disponible.' using errcode = '42501';
  end if;

  select b.* into v_barberia from public.barberias b where b.id = v_integration.barberia_id;
  if public.barberia_access_state(v_barberia.id) not in ('active', 'trialing', 'past_due') then
    raise exception 'La cuenta no puede consultar reservas en este momento.' using errcode = '42501';
  end if;
  if v_phone = '' then
    raise exception 'Falta el teléfono del cliente.' using errcode = '22023';
  end if;

  return query
  select t.barberia_id, t.id, t.fecha, t.hora::time, t.duracion_min, t.motivo,
         t.estado, br.nombre
  from public.turnos t
  left join public.clientes c on c.id = t.cliente_id and c.barberia_id = v_barberia.id
  left join public.barberos br on br.id = t.barbero_id and br.barberia_id = v_barberia.id
  where t.barberia_id = v_barberia.id
    and (p_turno_id is null or t.id = p_turno_id)
    and regexp_replace(coalesce(t.telefono, c.telefono, ''), '[^0-9]', '', 'g') = v_phone
  order by t.fecha desc, t.hora desc
  limit 1;
end;
$$;

create or replace function public.simular_reserva_whatsapp(
  p_integration_id bigint,
  p_event_id text,
  p_servicio_id bigint,
  p_barbero_id bigint,
  p_fecha date,
  p_hora time,
  p_nombre text,
  p_telefono text,
  p_email text default null
)
returns table (turno_id bigint, fecha date, hora time, duracion_min integer, shadow boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.saas_integraciones%rowtype;
  v_barberia public.barberias%rowtype;
  v_servicio public.servicios%rowtype;
  v_duracion integer;
  v_phone text := regexp_replace(coalesce(btrim(p_telefono), ''), '[^0-9]', '', 'g');
begin
  if nullif(btrim(p_event_id), '') is null or char_length(btrim(p_event_id)) > 200 then
    raise exception 'Falta el identificador del evento shadow.' using errcode = '22023';
  end if;
  if nullif(btrim(p_nombre), '') is null or v_phone = '' then
    raise exception 'Faltan nombre y teléfono.' using errcode = '22023';
  end if;

  select i.* into v_integration
  from public.saas_integraciones i
  where i.id = p_integration_id
    and i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp'
    and i.estado = 'conectado';
  if not found then
    raise exception 'La integración shadow de WhatsApp no está disponible.' using errcode = '42501';
  end if;
  select b.* into v_barberia from public.barberias b where b.id = v_integration.barberia_id;
  if public.barberia_access_state(v_barberia.id) not in ('active', 'trialing', 'past_due') then
    raise exception 'La cuenta no puede aceptar reservas en este momento.' using errcode = '42501';
  end if;

  select s.* into v_servicio
  from public.servicios s
  where s.id = p_servicio_id and s.barberia_id = v_barberia.id and s.activo;
  if not found then
    raise exception 'El servicio ya no está disponible.' using errcode = '22023';
  end if;
  select coalesce(bs.duracion_min, v_servicio.duracion_min) into v_duracion
  from public.barbero_servicios bs
  join public.barberos br on br.id = bs.barbero_id
  where bs.barbero_id = p_barbero_id and bs.servicio_id = v_servicio.id
    and br.barberia_id = v_barberia.id and br.activo;
  if not found then
    raise exception 'El profesional ya no realiza este servicio.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.horarios_disponibles_reserva_publica(
      (select b.slug from public.barberias b where b.id = v_barberia.id),
      p_servicio_id, p_fecha
    ) h
    where h.barbero_id = p_barbero_id and h.hora = p_hora
  ) then
    raise exception 'Ese horario no está disponible.' using errcode = '23P01';
  end if;

  -- La función de simulación nunca inserta clientes, turnos ni eventos.
  return query select null::bigint, p_fecha, p_hora, v_duracion, true;
end;
$$;

create or replace function public.cancelar_reserva_whatsapp(
  p_integration_id bigint,
  p_event_id text,
  p_turno_id bigint,
  p_telefono text
)
returns table (cancelled boolean, turno_id bigint, estado text, message text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.saas_integraciones%rowtype;
  v_barberia public.barberias%rowtype;
  v_turno public.turnos%rowtype;
  v_event public.saas_automation_events%rowtype;
  v_phone text := regexp_replace(coalesce(btrim(p_telefono), ''), '[^0-9]', '', 'g');
begin
  if nullif(btrim(p_event_id), '') is null or char_length(btrim(p_event_id)) > 200 then
    raise exception 'Evento de cancelación inválido.' using errcode = '22023';
  end if;
  select i.* into v_integration from public.saas_integraciones i
  where i.id = p_integration_id and i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp' and i.estado = 'conectado';
  if not found then raise exception 'La integración de WhatsApp no está disponible.' using errcode = '42501'; end if;
  select b.* into v_barberia from public.barberias b where b.id = v_integration.barberia_id;
  if public.barberia_access_state(v_barberia.id) not in ('active', 'trialing', 'past_due') then
    raise exception 'La cuenta no puede modificar reservas en este momento.' using errcode = '42501';
  end if;
  if v_phone = '' then raise exception 'Falta el teléfono del cliente.' using errcode = '22023'; end if;

  insert into public.saas_automation_events (tenant_id, integration_id, event_id, status, expires_at)
  values (v_barberia.id, v_integration.id, btrim(p_event_id), 'processing', now() + interval '24 hours')
  on conflict on constraint saas_automation_events_integration_id_event_id_key do nothing;
  select e.* into v_event from public.saas_automation_events e
  where e.integration_id = v_integration.id and e.event_id = btrim(p_event_id) for update;
  if v_event.status = 'completed' then
    return query select true, nullif(regexp_replace(coalesce(v_event.result_reference, ''), '[^0-9]', '', 'g'), '')::bigint,
      'cancelado'::text, 'La reserva ya estaba cancelada.'::text; return;
  end if;
  if v_event.status = 'processing' and v_event.created_at < now() - interval '24 hours' then
    update public.saas_automation_events set expires_at = now() + interval '24 hours', processed_at = null, result_reference = null where id = v_event.id;
  elsif v_event.status not in ('processing', 'failed', 'expired') then
    raise exception 'El evento ya fue procesado.' using errcode = '23505';
  end if;

  select t.* into v_turno from public.turnos t
  where t.id = p_turno_id and t.barberia_id = v_barberia.id
    and regexp_replace(coalesce(t.telefono, ''), '[^0-9]', '', 'g') = v_phone
  for update;
  if not found then raise exception 'No encontramos una reserva con esos datos.' using errcode = '22023'; end if;
  if v_turno.estado <> 'confirmado' then raise exception 'La reserva no se puede cancelar en su estado actual.' using errcode = '22023'; end if;
  if coalesce(v_turno.inicio_at, v_turno.fecha::timestamp + v_turno.hora::time) <= (now() at time zone v_barberia.zona_horaria) + interval '2 hours' then
    raise exception 'La cancelación debe hacerse con al menos 2 horas de anticipación.' using errcode = '22023';
  end if;
  update public.turnos set estado = 'cancelado', updated_at = now() where id = v_turno.id;
  update public.saas_automation_events set status = 'completed', processed_at = now(), result_reference = concat('cancelled:', v_turno.id) where id = v_event.id;
  return query select true, v_turno.id, 'cancelado'::text, 'Reserva cancelada correctamente.'::text;
exception when others then
  update public.saas_automation_events set status = 'failed', processed_at = now(), result_reference = sqlstate where integration_id = p_integration_id and event_id = btrim(p_event_id);
  raise;
end;
$$;

create or replace function public.reprogramar_reserva_whatsapp(
  p_integration_id bigint,
  p_event_id text,
  p_turno_id bigint,
  p_telefono text,
  p_servicio_id bigint,
  p_barbero_id bigint,
  p_fecha date,
  p_hora time,
  p_nombre text default null,
  p_email text default null
)
returns table (rescheduled boolean, new_turno_id bigint, replaced_turno_id bigint, fecha date, hora time, duracion_min integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.saas_integraciones%rowtype;
  v_barberia public.barberias%rowtype;
  v_turno public.turnos%rowtype;
  v_event public.saas_automation_events%rowtype;
  v_new record;
  v_phone text := regexp_replace(coalesce(btrim(p_telefono), ''), '[^0-9]', '', 'g');
  v_replacement_event text := left(btrim(p_event_id) || ':replacement', 200);
begin
  if nullif(btrim(p_event_id), '') is null or char_length(btrim(p_event_id)) > 180 then
    raise exception 'Evento de reprogramación inválido.' using errcode = '22023';
  end if;
  select i.* into v_integration from public.saas_integraciones i
  where i.id = p_integration_id and i.proveedor = 'evolution' and i.integration_type = 'whatsapp' and i.estado = 'conectado';
  if not found then raise exception 'La integración de WhatsApp no está disponible.' using errcode = '42501'; end if;
  select b.* into v_barberia from public.barberias b where b.id = v_integration.barberia_id;
  if public.barberia_access_state(v_barberia.id) not in ('active', 'trialing', 'past_due') then
    raise exception 'La cuenta no puede modificar reservas en este momento.' using errcode = '42501';
  end if;
  if v_phone = '' then raise exception 'Falta el teléfono del cliente.' using errcode = '22023'; end if;

  insert into public.saas_automation_events (tenant_id, integration_id, event_id, status, expires_at)
  values (v_barberia.id, v_integration.id, btrim(p_event_id), 'processing', now() + interval '24 hours')
  on conflict on constraint saas_automation_events_integration_id_event_id_key do nothing;
  select e.* into v_event from public.saas_automation_events e where e.integration_id = v_integration.id and e.event_id = btrim(p_event_id) for update;
  if v_event.status = 'completed' and v_event.result_reference like 'rescheduled:%' then
    return query select true, split_part(v_event.result_reference, ':', 2)::bigint, split_part(v_event.result_reference, ':', 3)::bigint, p_fecha, p_hora, null::integer; return;
  end if;
  if v_event.status not in ('processing', 'failed', 'expired') then raise exception 'El evento ya fue procesado.' using errcode = '23505'; end if;

  select t.* into v_turno from public.turnos t where t.id = p_turno_id and t.barberia_id = v_barberia.id
    and regexp_replace(coalesce(t.telefono, ''), '[^0-9]', '', 'g') = v_phone for update;
  if not found then raise exception 'No encontramos una reserva con esos datos.' using errcode = '22023'; end if;
  if v_turno.estado <> 'confirmado' then raise exception 'La reserva no se puede reprogramar en su estado actual.' using errcode = '22023'; end if;
  if coalesce(v_turno.inicio_at, v_turno.fecha::timestamp + v_turno.hora::time) <= (now() at time zone v_barberia.zona_horaria) + interval '2 hours' then
    raise exception 'La reprogramación debe hacerse con al menos 2 horas de anticipación.' using errcode = '22023';
  end if;

  select * into v_new from public.crear_reserva_whatsapp(
    v_integration.id, v_replacement_event, p_servicio_id, p_barbero_id, p_fecha, p_hora,
    coalesce(nullif(btrim(p_nombre), ''), v_turno.paciente), p_telefono, p_email
  );
  update public.turnos set estado = 'cancelado', updated_at = now() where id = v_turno.id;
  update public.saas_automation_events set status = 'completed', processed_at = now(), result_reference = concat('rescheduled:', v_new.turno_id, ':', v_turno.id) where id = v_event.id;
  return query select true, v_new.turno_id, v_turno.id, v_new.fecha, v_new.hora, v_new.duracion_min;
exception when others then
  update public.saas_automation_events set status = 'failed', processed_at = now(), result_reference = sqlstate where integration_id = p_integration_id and event_id = btrim(p_event_id);
  raise;
end;
$$;

revoke all on function public.consultar_reserva_whatsapp(bigint, bigint, text) from public, anon, authenticated;
revoke all on function public.simular_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text) from public, anon, authenticated;
revoke all on function public.cancelar_reserva_whatsapp(bigint, text, bigint, text) from public, anon, authenticated;
revoke all on function public.reprogramar_reserva_whatsapp(bigint, text, bigint, text, bigint, bigint, date, time, text, text) from public, anon, authenticated;
grant execute on function public.consultar_reserva_whatsapp(bigint, bigint, text) to service_role;
grant execute on function public.simular_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text) to service_role;
grant execute on function public.cancelar_reserva_whatsapp(bigint, text, bigint, text) to service_role;
grant execute on function public.reprogramar_reserva_whatsapp(bigint, text, bigint, text, bigint, bigint, date, time, text, text) to service_role;

commit;
