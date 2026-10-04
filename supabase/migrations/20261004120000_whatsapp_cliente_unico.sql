-- Un único cliente por negocio y teléfono entre la reserva web y WhatsApp
-- (tarea 35).
--
-- Por qué: crear_reserva_whatsapp (20260806150000) reutilizaba la ficha por
-- (barberia_id, telefono), pero al reutilizarla reemplazaba el nombre y el
-- email con lo escrito en el chat. Un cliente que reservó por la web y después
-- por WhatsApp perdía su nombre por un dato no verificado. Además un JID sin
-- el 9 (54 + 10 dígitos) no coincidía con el formato canónico de la web
-- (549 + 10 dígitos) y el trigger de teléfono lo rechazaba.
--
-- Cambios, con la misma firma, grants y formato de respuesta:
--   * teléfono canónico 549 + área + número; 54 + 10 dígitos se completa;
--   * ficha existente: no se sobrescriben nombre ni email (sólo se completan
--     vacíos), igual que crear_reserva_publica desde 20261002092000;
--   * proximo_turno conserva el turno futuro más cercano;
--   * nombre limitado a 120 caracteres.
-- Negocios distintos siguen sin compartir fichas: la clave es
-- (barberia_id, telefono). No se fusionan ni modifican fichas históricas.
--
-- Idempotente (create or replace). Rollback: volver a aplicar la definición
-- de crear_reserva_whatsapp de 20260806150000_multitenant_whatsapp_contract.sql
-- con sus mismos revoke/grant. No hay cambios de tabla ni datos que revertir.
begin;

create or replace function public.crear_reserva_whatsapp(
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
returns table (turno_id bigint, fecha date, hora time, duracion_min integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.saas_integraciones%rowtype;
  v_barberia public.barberias%rowtype;
  v_servicio public.servicios%rowtype;
  v_event public.saas_automation_events%rowtype;
  v_duracion integer;
  v_cliente_id bigint;
  v_inicio timestamp;
  v_fin timestamp;
  v_telefono text;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_hoy date;
  v_access text;
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

  select * into v_barberia from public.barberias where id = v_integration.barberia_id;
  v_access := public.barberia_access_state(v_barberia.id);
  if v_access not in ('active', 'trialing', 'past_due') then
    raise exception 'La cuenta no puede aceptar reservas en este momento.' using errcode = '42501';
  end if;

  if nullif(btrim(p_event_id), '') is null then
    raise exception 'Falta el identificador idempotente del evento.' using errcode = '22023';
  end if;

  insert into public.saas_automation_events (tenant_id, integration_id, event_id, status, expires_at)
  values (v_barberia.id, v_integration.id, btrim(p_event_id), 'processing', now() + interval '24 hours')
  on conflict (integration_id, event_id) do nothing;

  select e.* into v_event
  from public.saas_automation_events e
  where e.integration_id = v_integration.id
    and e.event_id = btrim(p_event_id)
  for update;

  if v_event.status = 'completed' and v_event.result_reference ~ '^[0-9]+$' then
    select t.id, t.fecha, t.hora::time, t.duracion_min
    into turno_id, fecha, hora, duracion_min
    from public.turnos t
    where t.id = v_event.result_reference::bigint;
    if found then return next; return; end if;
  end if;

  if v_event.status = 'processing' and v_event.expires_at <= now() then
    update public.saas_automation_events
    set expires_at = now() + interval '24 hours', processed_at = null, result_reference = null
    where id = v_event.id;
  elsif v_event.status not in ('processing', 'failed', 'expired') then
    raise exception 'El evento ya fue procesado.' using errcode = '23505';
  end if;

  if v_nombre = '' or nullif(btrim(p_telefono), '') is null then
    raise exception 'Faltan nombre y teléfono.' using errcode = '22023';
  end if;
  if char_length(v_nombre) > 120 then
    raise exception 'El nombre es demasiado largo.' using errcode = '22023';
  end if;
  -- Teléfono canónico, igual que la reserva web: 549 + área + número. Un JID
  -- de WhatsApp sin el 9 (54 + 10 dígitos) se completa como lo hace el
  -- formulario web con su prefijo fijo "+54 9".
  v_telefono := regexp_replace(btrim(p_telefono), '[^0-9]', '', 'g');
  if v_telefono ~ '^54[1-9][0-9]{9}$' then
    v_telefono := '549' || substr(v_telefono, 3);
  end if;
  if v_telefono !~ '^549[1-9][0-9]{9}$' then
    raise exception 'El teléfono debe ser un celular argentino: 549 + código de área + número (13 dígitos).' using errcode = '22023';
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
  where bs.barbero_id = p_barbero_id
    and bs.servicio_id = v_servicio.id
    and br.barberia_id = v_barberia.id
    and br.activo;
  if not found then
    raise exception 'El profesional ya no realiza este servicio.' using errcode = '22023';
  end if;

  v_hoy := (now() at time zone v_barberia.zona_horaria)::date;
  v_inicio := p_fecha::timestamp + p_hora;
  v_fin := v_inicio + make_interval(mins => v_duracion);
  if v_inicio < (now() at time zone v_barberia.zona_horaria) then
    raise exception 'Ese horario ya pasó. Elegí otro.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.horarios_barbero h
    where h.barberia_id = v_barberia.id and h.barbero_id = p_barbero_id and h.activo
      and h.day_of_week = extract(dow from p_fecha)::smallint
      and v_inicio::time >= h.start_time and v_fin::time <= h.end_time
  ) then
    raise exception 'El profesional no trabaja en ese horario.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.bloqueos_agenda ba
    where ba.barberia_id = v_barberia.id and ba.fecha = p_fecha
      and (ba.barbero_id is null or ba.barbero_id = p_barbero_id)
      and tsrange(p_fecha::timestamp + ba.start_time, p_fecha::timestamp + ba.end_time, '[)')
          && tsrange(v_inicio, v_fin, '[)')
  ) then
    raise exception 'Ese horario fue bloqueado. Elegí otro.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.turnos t
    where t.barbero_id = p_barbero_id and t.estado not in ('cancelado', 'no_asistio')
      and tsrange(t.inicio_at, t.fin_at, '[)') && tsrange(v_inicio, v_fin, '[)')
  ) then
    raise exception 'Ese horario acaba de ocuparse. Elegí otro.' using errcode = '23P01';
  end if;

  -- Un cliente existente del negocio (mismo teléfono canónico, por ejemplo
  -- creado desde la reserva web) se reutiliza sin modificar su ficha: el
  -- nombre o email escritos en el chat sólo completan datos vacíos. El nombre
  -- informado queda en el turno.
  insert into public.clientes (barberia_id, nombre, telefono, email, proximo_turno)
  values (v_barberia.id, v_nombre, v_telefono, v_email, p_fecha)
  on conflict (barberia_id, telefono) do update
    set nombre = case when nullif(btrim(public.clientes.nombre), '') is null then excluded.nombre else public.clientes.nombre end,
        email = coalesce(public.clientes.email, excluded.email),
        proximo_turno = case
          when public.clientes.proximo_turno is null
            or public.clientes.proximo_turno < v_hoy
            or excluded.proximo_turno < public.clientes.proximo_turno
          then excluded.proximo_turno
          else public.clientes.proximo_turno
        end
  returning id into v_cliente_id;

  insert into public.turnos (
    barberia_id, cliente_id, barbero_id, servicio_id, paciente, telefono,
    fecha, hora, motivo, estado, precio, duracion_min, origen
  ) values (
    v_barberia.id, v_cliente_id, p_barbero_id, v_servicio.id, v_nombre, v_telefono,
    p_fecha, to_char(p_hora, 'HH24:MI'), v_servicio.nombre, 'confirmado', v_servicio.precio,
    v_duracion, 'whatsapp'
  ) returning public.turnos.id, public.turnos.fecha, public.turnos.hora::time, public.turnos.duracion_min
    into turno_id, fecha, hora, duracion_min;

  update public.saas_automation_events
  set status = 'completed', processed_at = now(), result_reference = turno_id::text
  where id = v_event.id;
  return next;
exception when exclusion_violation then
  update public.saas_automation_events
  set status = 'failed', processed_at = now(), result_reference = 'overlap'
  where integration_id = p_integration_id and event_id = btrim(p_event_id);
  raise exception 'Ese horario acaba de ocuparse. Elegí otro.' using errcode = '23P01';
when others then
  update public.saas_automation_events
  set status = 'failed', processed_at = now(), result_reference = sqlstate
  where integration_id = p_integration_id and event_id = btrim(p_event_id);
  raise;
end;
$$;

revoke all on function public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text) from public, anon, authenticated;
grant execute on function public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text) to service_role;

commit;
