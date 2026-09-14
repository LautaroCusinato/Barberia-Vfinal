-- Production-safe WhatsApp runtime contract.
--
-- This migration is additive and fail-closed. Applying it does not enable any
-- connection, outbound message, or booking mutation. Runtime flags are scoped
-- to the authoritative tenant connection and default to false.
begin;

alter table public.saas_whatsapp_connections
  add column if not exists automation_enabled boolean not null default false,
  add column if not exists outbound_enabled boolean not null default false,
  add column if not exists booking_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.saas_whatsapp_connections'::regclass
      and conname = 'saas_whatsapp_connections_outbound_requires_automation'
  ) then
    alter table public.saas_whatsapp_connections
      add constraint saas_whatsapp_connections_outbound_requires_automation
      check (not outbound_enabled or automation_enabled) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.saas_whatsapp_connections'::regclass
      and conname = 'saas_whatsapp_connections_booking_requires_outbound'
  ) then
    alter table public.saas_whatsapp_connections
      add constraint saas_whatsapp_connections_booking_requires_outbound
      check (not booking_enabled or (automation_enabled and outbound_enabled)) not valid;
  end if;
end
$$;

alter table public.saas_whatsapp_connections
  validate constraint saas_whatsapp_connections_outbound_requires_automation;
alter table public.saas_whatsapp_connections
  validate constraint saas_whatsapp_connections_booking_requires_outbound;

create unique index if not exists uq_saas_integraciones_id_barberia
  on public.saas_integraciones (id, barberia_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.saas_whatsapp_connections'::regclass
      and conname = 'saas_whatsapp_connections_integration_tenant_fk'
  ) then
    alter table public.saas_whatsapp_connections
      add constraint saas_whatsapp_connections_integration_tenant_fk
      foreign key (integration_id, barberia_id)
      references public.saas_integraciones (id, barberia_id)
      on delete restrict
      not valid;
  end if;
end
$$;

alter table public.saas_whatsapp_connections
  validate constraint saas_whatsapp_connections_integration_tenant_fk;

create index if not exists idx_saas_whatsapp_connections_runtime
  on public.saas_whatsapp_connections
    (environment, provider, state, automation_enabled, outbound_enabled, booking_enabled, barberia_id);

-- Generic compatibility projection. Unlike the earlier QA-only migration,
-- this trigger contains no tenant, instance, or environment fixture.
create or replace function public.sync_whatsapp_integration_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado text;
begin
  if new.provider <> 'evolution' or new.integration_id is null then
    return new;
  end if;

  v_estado := case new.state
    when 'CONNECTED' then 'conectado'
    when 'DISCONNECTED' then 'desactivado'
    when 'ERROR' then 'error'
    else 'pendiente'
  end;

  update public.saas_integraciones
  set estado = v_estado,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'automation_enabled', new.automation_enabled,
        'outbound_enabled', new.outbound_enabled,
        'booking_enabled', new.booking_enabled
      )
  where id = new.integration_id
    and barberia_id = new.barberia_id
    and proveedor = 'evolution'
    and integration_type = 'whatsapp';

  return new;
end;
$$;

revoke all on function public.sync_whatsapp_integration_state() from public, anon, authenticated;
grant execute on function public.sync_whatsapp_integration_state() to service_role;

drop trigger if exists trg_sync_whatsapp_integration_state on public.saas_whatsapp_connections;
create trigger trg_sync_whatsapp_integration_state
after insert or update of state, integration_id, provider, environment,
  automation_enabled, outbound_enabled, booking_enabled
on public.saas_whatsapp_connections
for each row execute function public.sync_whatsapp_integration_state();

-- Resolve a runtime exclusively from the registered Evolution instance.
-- The workflow supplies its fixed environment; tenant ids are never accepted.
create or replace function public.resolve_whatsapp_runtime_context(
  p_environment text,
  p_external_instance_id text
)
returns table (
  connection_id bigint,
  integration_id bigint,
  tenant_id bigint,
  environment text,
  evolution_instance text,
  business_name text,
  slug text,
  locale text,
  timezone text,
  currency text,
  subscription_status text,
  automation_enabled boolean,
  outbound_enabled boolean,
  booking_enabled boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_environment text := lower(btrim(coalesce(p_environment, '')));
  v_instance text := lower(btrim(coalesce(p_external_instance_id, '')));
begin
  if v_environment not in ('qa', 'production')
     or v_instance = ''
     or char_length(v_instance) > 200 then
    return;
  end if;

  return query
  select
    c.id,
    i.id,
    b.id,
    c.environment,
    c.instance_name,
    b.nombre,
    b.slug,
    coalesce(nullif(i.locale, ''), nullif(b.locale, ''), 'es-AR'),
    coalesce(nullif(i.timezone, ''), b.zona_horaria, 'UTC'),
    coalesce(nullif(b.moneda, ''), 'ARS'),
    public.barberia_access_state(b.id),
    c.automation_enabled,
    c.outbound_enabled,
    c.booking_enabled and public.barberia_access_state(b.id) in ('active', 'trialing', 'past_due')
  from public.saas_whatsapp_connections c
  join public.saas_integraciones i
    on i.id = c.integration_id
   and i.barberia_id = c.barberia_id
   and i.proveedor = 'evolution'
   and i.integration_type = 'whatsapp'
   and i.estado = 'conectado'
  join public.barberias b on b.id = c.barberia_id
  where c.provider = 'evolution'
    and c.environment = v_environment
    and c.state = 'CONNECTED'
    and lower(btrim(coalesce(c.instance_name, ''))) = v_instance
    and (v_environment <> 'production' or c.provisioning_mode = 'live');
end;
$$;

-- Claim an inbound or outbound operation exactly once. The connection row is
-- the authorization boundary; every flag remains false after migration.
create or replace function public.claim_whatsapp_runtime_event(
  p_environment text,
  p_integration_id bigint,
  p_event_id text,
  p_operation text default 'inbound',
  p_expires_at timestamptz default now() + interval '24 hours'
)
returns table (
  acquired boolean,
  tenant_id bigint,
  status text,
  operation text,
  claimed_event_id text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_connection public.saas_whatsapp_connections%rowtype;
  v_environment text := lower(btrim(coalesce(p_environment, '')));
  v_operation text := lower(btrim(coalesce(p_operation, '')));
  v_source_event text := btrim(coalesce(p_event_id, ''));
  v_claim_event text;
  v_status text;
begin
  if v_environment not in ('qa', 'production')
     or v_operation not in ('inbound', 'outbound', 'booking')
     or v_source_event = ''
     or char_length(v_source_event) > 180
     or p_expires_at is null
     or p_expires_at <= now() then
    raise exception 'Invalid WhatsApp runtime claim.' using errcode = '22023';
  end if;

  select c.* into v_connection
  from public.saas_whatsapp_connections c
  join public.saas_integraciones i
    on i.id = c.integration_id
   and i.barberia_id = c.barberia_id
   and i.proveedor = 'evolution'
   and i.integration_type = 'whatsapp'
   and i.estado = 'conectado'
  where c.integration_id = p_integration_id
    and c.provider = 'evolution'
    and c.environment = v_environment
    and c.state = 'CONNECTED'
    and c.automation_enabled
    and (v_environment <> 'production' or public.barberia_access_state(c.barberia_id) in ('active', 'trialing', 'past_due'))
    and (v_operation <> 'outbound' or c.outbound_enabled)
    and (v_operation <> 'booking' or c.booking_enabled)
    and (v_environment <> 'production' or c.provisioning_mode = 'live');

  if not found then
    raise exception 'WhatsApp runtime is not enabled for this operation.' using errcode = '42501';
  end if;

  v_claim_event := case
    when v_operation = 'inbound' then v_source_event
    else v_operation || ':' || v_source_event
  end;

  insert into public.saas_automation_events (
    tenant_id, integration_id, event_id, status, expires_at,
    metadata
  ) values (
    v_connection.barberia_id, v_connection.integration_id, v_claim_event,
    'processing', p_expires_at,
    jsonb_build_object('environment', v_environment, 'operation', v_operation)
  )
  on conflict on constraint saas_automation_events_integration_id_event_id_key do nothing;

  if found then
    return query select true, v_connection.barberia_id, 'processing'::text, v_operation, v_claim_event;
    return;
  end if;

  select e.status into v_status
  from public.saas_automation_events e
  where e.integration_id = v_connection.integration_id
    and e.event_id = v_claim_event;

  return query select false, v_connection.barberia_id, coalesce(v_status, 'processing'), v_operation, v_claim_event;
end;
$$;

revoke all on function public.resolve_whatsapp_runtime_context(text, text) from public, anon, authenticated;
revoke all on function public.claim_whatsapp_runtime_event(text, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_runtime_context(text, text) to service_role;
grant execute on function public.claim_whatsapp_runtime_event(text, bigint, text, text, timestamptz) to service_role;

commit;
