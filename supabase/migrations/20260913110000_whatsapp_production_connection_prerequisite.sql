-- Drift-safe prerequisite for the production WhatsApp runtime contract.
--
-- Production already contains the tenant/integration contract introduced by
-- 20260806150000, but its historical migration id is not authoritative there.
-- The tenant-scoped connection table is still absent. This migration creates
-- only that missing boundary without QA fixtures, provider calls or enabled
-- runtime capabilities. The following 20260913120000 migration adds the
-- production flags and RPCs, all defaulted to false.
begin;

create table if not exists public.saas_whatsapp_connections (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  integration_id bigint references public.saas_integraciones(id) on delete set null,
  provider text not null default 'evolution' check (provider = 'evolution'),
  environment text not null default 'qa' check (environment in ('qa', 'sandbox', 'production')),
  provisioning_mode text not null default 'shadow' check (provisioning_mode in ('mock', 'shadow', 'live')),
  state text not null default 'NOT_CONFIGURED' check (state in (
    'NOT_CONFIGURED', 'CREATING_INSTANCE', 'QR_READY', 'CONNECTING',
    'CONNECTED', 'DISCONNECTED', 'ERROR'
  )),
  instance_name text,
  external_instance_id text,
  receiver_number text,
  qr_expires_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text,
  last_error_message text check (last_error_message is null or char_length(last_error_message) <= 240),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, environment)
);

-- IF NOT EXISTS must not conceal an incompatible pre-existing table.
do $$
declare
  v_missing text[];
begin
  select array_agg(expected.column_name order by expected.column_name)
  into v_missing
  from (values
    ('id'), ('barberia_id'), ('integration_id'), ('provider'), ('environment'),
    ('provisioning_mode'), ('state'), ('instance_name'), ('external_instance_id'),
    ('receiver_number'), ('qr_expires_at'), ('last_verified_at'),
    ('last_error_code'), ('last_error_message'), ('metadata'), ('created_at'),
    ('updated_at')
  ) as expected(column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'saas_whatsapp_connections'
      and c.column_name = expected.column_name
  );

  if v_missing is not null then
    raise exception 'Incompatible saas_whatsapp_connections schema; missing columns: %', v_missing
      using errcode = '55000';
  end if;
end
$$;

create unique index if not exists uq_saas_whatsapp_connections_instance
  on public.saas_whatsapp_connections (lower(btrim(instance_name)))
  where instance_name is not null and btrim(instance_name) <> '';

create index if not exists idx_saas_whatsapp_connections_lookup
  on public.saas_whatsapp_connections (provider, environment, state, barberia_id);

alter table public.saas_whatsapp_connections enable row level security;
revoke all on table public.saas_whatsapp_connections from public, anon, authenticated;
grant select, insert, update, delete on table public.saas_whatsapp_connections to service_role;

drop trigger if exists trg_saas_whatsapp_connections_updated_at on public.saas_whatsapp_connections;
create trigger trg_saas_whatsapp_connections_updated_at
before update on public.saas_whatsapp_connections
for each row execute function public.set_updated_at();

commit;
