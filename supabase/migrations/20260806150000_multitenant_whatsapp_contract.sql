-- Contrato multi-tenant para automatizaciones de WhatsApp.
--
-- El workflow de n8n resuelve el tenant por una identidad de Evolution
-- registrada en Supabase. Nunca recibe un barberia_id desde el mensaje del
-- cliente y no obtiene secretos desde esta base.
begin;

-- `barberia_id` y `proveedor` se conservan por compatibilidad con el panel.
-- En el contrato se exponen como `tenant_id` y `provider` respectivamente.
alter table public.saas_integraciones
  add column if not exists integration_type text not null default 'whatsapp',
  add column if not exists external_instance_id text,
  add column if not exists receiver_number text,
  add column if not exists credential_reference text,
  add column if not exists locale text,
  add column if not exists timezone text,
  add column if not exists ai_provider text,
  add column if not exists ai_model text,
  add column if not exists limits jsonb not null default '{}'::jsonb,
  add column if not exists last_verified_at timestamptz;

update public.saas_integraciones i
set integration_type = coalesce(nullif(btrim(i.integration_type), ''), 'whatsapp'),
    locale = coalesce(nullif(btrim(i.locale), ''), 'es-AR'),
    timezone = coalesce(nullif(btrim(i.timezone), ''), b.zona_horaria),
    limits = coalesce(i.limits, '{}'::jsonb),
    receiver_number = nullif(regexp_replace(coalesce(i.receiver_number, ''), '[^0-9]', '', 'g'), '')
from public.barberias b
where b.id = i.barberia_id;

alter table public.saas_integraciones
  alter column integration_type set not null,
  alter column integration_type set default 'whatsapp',
  alter column limits set not null,
  alter column limits set default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'saas_integraciones_type_check'
  ) then
    alter table public.saas_integraciones
      add constraint saas_integraciones_type_check
      check (integration_type in ('whatsapp', 'panel', 'api', 'automation'));
  end if;
end
$$;

create unique index if not exists uq_saas_integraciones_evolution_instance
  on public.saas_integraciones (lower(btrim(external_instance_id)))
  where proveedor = 'evolution'
    and integration_type = 'whatsapp'
    and external_instance_id is not null
    and btrim(external_instance_id) <> '';

create unique index if not exists uq_saas_integraciones_evolution_receiver
  on public.saas_integraciones (receiver_number)
  where proveedor = 'evolution'
    and integration_type = 'whatsapp'
    and receiver_number is not null
    and receiver_number <> '';

create index if not exists idx_saas_integraciones_lookup
  on public.saas_integraciones (proveedor, integration_type, estado, barberia_id);

-- Eventos deduplicados por integración. El mismo event_id puede existir en
-- dos tenants distintos sin mezclar estados.
create table if not exists public.saas_automation_events (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.barberias(id) on delete cascade,
  integration_id bigint not null references public.saas_integraciones(id) on delete cascade,
  event_id text not null check (char_length(btrim(event_id)) between 1 and 200),
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed', 'expired')),
  processed_at timestamptz,
  result_reference text,
  expires_at timestamptz not null,
  payload_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_id, event_id)
);

create index if not exists idx_saas_automation_events_cleanup
  on public.saas_automation_events (expires_at, status);
create index if not exists idx_saas_automation_events_tenant_id
  on public.saas_automation_events (tenant_id);

alter table public.saas_automation_events enable row level security;
revoke all on table public.saas_automation_events from public, anon, authenticated;
grant select, insert, update, delete on table public.saas_automation_events to service_role;
drop policy if exists "saas_automation_events_service_role" on public.saas_automation_events;
create policy "saas_automation_events_service_role"
on public.saas_automation_events for all to service_role
using (true) with check (true);

drop trigger if exists trg_saas_automation_events_updated_at on public.saas_automation_events;
create trigger trg_saas_automation_events_updated_at
before update on public.saas_automation_events
for each row execute function public.set_updated_at();

-- Devuelve únicamente el tenant identificado por una integración Evolution
-- conectada. Si la identidad no coincide, la función no devuelve filas.
create or replace function public.resolve_whatsapp_tenant_context(
  p_external_instance_id text default null,
  p_receiver_number text default null,
  p_integration_id bigint default null
)
returns table (
  integration_id bigint,
  tenant_id bigint,
  business_name text,
  vertical text,
  slug text,
  locale text,
  timezone text,
  currency text,
  subscription_status text,
  booking_enabled boolean,
  evolution_instance text,
  receiver_number text,
  ai_provider text,
  ai_model text,
  booking_url text,
  integration_status text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.saas_integraciones%rowtype;
  v_count integer;
  v_instance text := nullif(lower(btrim(p_external_instance_id)), '');
  v_receiver text := nullif(regexp_replace(coalesce(p_receiver_number, ''), '[^0-9]', '', 'g'), '');
begin
  if p_integration_id is null and v_instance is null and v_receiver is null then
    return;
  end if;

  if p_integration_id is not null then
    select i.* into v_integration
    from public.saas_integraciones i
    where i.id = p_integration_id
      and i.proveedor = 'evolution'
      and i.integration_type = 'whatsapp'
      and i.estado = 'conectado';
  elsif v_instance is not null then
    select count(*) into v_count
    from public.saas_integraciones i
    where i.proveedor = 'evolution'
      and i.integration_type = 'whatsapp'
      and i.estado = 'conectado'
      and lower(btrim(i.external_instance_id)) = v_instance;
    if v_count > 1 then
      raise exception 'La instancia de Evolution está asociada a más de un tenant.' using errcode = '22023';
    end if;
    select i.* into v_integration
    from public.saas_integraciones i
    where i.proveedor = 'evolution'
      and i.integration_type = 'whatsapp'
      and i.estado = 'conectado'
      and lower(btrim(i.external_instance_id)) = v_instance;
  else
    select count(*) into v_count
    from public.saas_integraciones i
    where i.proveedor = 'evolution'
      and i.integration_type = 'whatsapp'
      and i.estado = 'conectado'
      and i.receiver_number = v_receiver;
    if v_count > 1 then
      raise exception 'El número receptor está asociado a más de un tenant.' using errcode = '22023';
    end if;
    select i.* into v_integration
    from public.saas_integraciones i
    where i.proveedor = 'evolution'
      and i.integration_type = 'whatsapp'
      and i.estado = 'conectado'
      and i.receiver_number = v_receiver;
  end if;

  if not found then
    return;
  end if;

  return query
  select
    i.id,
    b.id,
    b.nombre,
    coalesce(nullif(b.vertical, ''), 'custom'),
    b.slug,
    coalesce(nullif(i.locale, ''), nullif(b.locale, ''), 'es-AR'),
    coalesce(nullif(i.timezone, ''), b.zona_horaria, 'UTC'),
    coalesce(sp.moneda, 'USD'),
    public.barberia_access_state(b.id),
    public.barberia_access_state(b.id) in ('active', 'trialing', 'past_due'),
    i.external_instance_id,
    i.receiver_number,
    coalesce(nullif(i.ai_provider, ''), 'deepseek'),
    coalesce(nullif(i.ai_model, ''), 'deepseek-chat'),
    coalesce(
      nullif(i.metadata ->> 'booking_url', ''),
      nullif(b.metadata ->> 'booking_url', ''),
      concat('/reservar/', b.slug)
    ),
    i.estado
  from public.saas_integraciones i
  join public.barberias b on b.id = i.barberia_id
  left join public.saas_suscripciones s on s.barberia_id = b.id
  left join public.saas_planes sp on sp.codigo = s.plan_codigo
  where i.id = v_integration.id;
end;
$$;

-- Reclama un webhook de forma atómica. La identidad del tenant se deriva de
-- integration_id, no del payload del cliente.
create or replace function public.claim_whatsapp_event(
  p_integration_id bigint,
  p_event_id text,
  p_expires_at timestamptz default now() + interval '24 hours'
)
returns table (acquired boolean, tenant_id bigint, status text, event_id text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.saas_integraciones%rowtype;
  v_event public.saas_automation_events%rowtype;
  v_expiry timestamptz := coalesce(p_expires_at, now() + interval '24 hours');
begin
  if nullif(btrim(p_event_id), '') is null or v_expiry <= now() then
    raise exception 'Evento de webhook inválido.' using errcode = '22023';
  end if;

  select i.* into v_integration
  from public.saas_integraciones i
  where i.id = p_integration_id
    and i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp'
    and i.estado = 'conectado';
  if not found then
    raise exception 'La integración de WhatsApp no está disponible.' using errcode = '42501';
  end if;

  insert into public.saas_automation_events (tenant_id, integration_id, event_id, status, expires_at)
  values (v_integration.barberia_id, v_integration.id, btrim(p_event_id), 'processing', v_expiry)
  on conflict on constraint saas_automation_events_integration_id_event_id_key do nothing;

  if found then
    return query select true, v_integration.barberia_id, 'processing'::text, btrim(p_event_id);
    return;
  end if;

  select e.* into v_event
  from public.saas_automation_events e
  where e.integration_id = v_integration.id
    and e.event_id = btrim(p_event_id)
  for update;

  if v_event.status in ('failed', 'expired') or v_event.expires_at <= now() then
    update public.saas_automation_events
    set status = 'processing', processed_at = null, result_reference = null,
        expires_at = v_expiry
    where id = v_event.id;
    return query select true, v_integration.barberia_id, 'processing'::text, btrim(p_event_id);
    return;
  end if;

  return query select false, v_integration.barberia_id, v_event.status, v_event.event_id;
end;
$$;

create or replace function public.finish_whatsapp_event(
  p_integration_id bigint,
  p_event_id text,
  p_status text,
  p_result_reference text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration_id bigint;
begin
  if p_status not in ('completed', 'failed') then
    raise exception 'Estado final de evento inválido.' using errcode = '22023';
  end if;

  select i.id into v_integration_id
  from public.saas_integraciones i
  where i.id = p_integration_id
    and i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp';
  if not found then
    return false;
  end if;

  update public.saas_automation_events
  set status = p_status,
      processed_at = now(),
      result_reference = nullif(btrim(p_result_reference), '')
  where integration_id = v_integration_id
    and event_id = btrim(p_event_id);
  return found;
end;
$$;

create or replace function public.cleanup_whatsapp_events(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'Límite de limpieza inválido.' using errcode = '22023';
  end if;
  delete from public.saas_automation_events
  where id in (
    select id from public.saas_automation_events
    where expires_at <= now()
    order by expires_at
    limit p_limit
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Reserva centralizada para WhatsApp. Deriva el tenant desde la integración y
-- reutiliza las mismas reglas de agenda que la reserva pública.
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

  if nullif(btrim(p_nombre), '') is null or nullif(btrim(p_telefono), '') is null then
    raise exception 'Faltan nombre y teléfono.' using errcode = '22023';
  end if;
  v_telefono := regexp_replace(btrim(p_telefono), '[^0-9]', '', 'g');

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

  insert into public.clientes (barberia_id, nombre, telefono, email, proximo_turno)
  values (v_barberia.id, btrim(p_nombre), v_telefono, nullif(btrim(p_email), ''), p_fecha)
  on conflict (barberia_id, telefono) do update
    set nombre = excluded.nombre,
        email = coalesce(excluded.email, public.clientes.email),
        proximo_turno = excluded.proximo_turno
  returning id into v_cliente_id;

  insert into public.turnos (
    barberia_id, cliente_id, barbero_id, servicio_id, paciente, telefono,
    fecha, hora, motivo, estado, precio, duracion_min, origen
  ) values (
    v_barberia.id, v_cliente_id, p_barbero_id, v_servicio.id, btrim(p_nombre), v_telefono,
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

revoke all on function public.resolve_whatsapp_tenant_context(text, text, bigint) from public, anon, authenticated;
revoke all on function public.claim_whatsapp_event(bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function public.finish_whatsapp_event(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.cleanup_whatsapp_events(integer) from public, anon, authenticated;
revoke all on function public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text) from public, anon, authenticated;

grant execute on function public.resolve_whatsapp_tenant_context(text, text, bigint) to service_role;
grant execute on function public.claim_whatsapp_event(bigint, text, timestamptz) to service_role;
grant execute on function public.finish_whatsapp_event(bigint, text, text, text) to service_role;
grant execute on function public.cleanup_whatsapp_events(integer) to service_role;
grant execute on function public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text) to service_role;

commit;
