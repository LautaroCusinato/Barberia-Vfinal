-- Reply-only pilot contract. Additive and intentionally NOT applied by this offline sprint.
-- The single active row is the server-side allowlist. There is no wildcard path.
begin;

create table if not exists public.saas_whatsapp_reply_only_allowlist (
  id bigint generated always as identity primary key,
  integration_id bigint not null unique references public.saas_integraciones(id) on delete cascade,
  tenant_id bigint not null references public.barberias(id) on delete cascade,
  external_instance_id text not null check (char_length(btrim(external_instance_id)) between 1 and 200 and btrim(external_instance_id) not in ('*', 'all', 'any')),
  receiver_number text not null check (receiver_number ~ '^[0-9]{8,20}$'),
  mode text not null default 'reply_only' check (mode = 'reply_only'),
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_reply_only_single_enabled
  on public.saas_whatsapp_reply_only_allowlist (enabled)
  where enabled;

create index if not exists idx_reply_only_identity
  on public.saas_whatsapp_reply_only_allowlist (lower(btrim(external_instance_id)), receiver_number)
  where enabled;

alter table public.saas_whatsapp_reply_only_allowlist enable row level security;
revoke all on table public.saas_whatsapp_reply_only_allowlist from public, anon, authenticated;
grant select, insert, update, delete on table public.saas_whatsapp_reply_only_allowlist to service_role;
drop policy if exists saas_reply_only_allowlist_service_role on public.saas_whatsapp_reply_only_allowlist;
create policy saas_reply_only_allowlist_service_role
  on public.saas_whatsapp_reply_only_allowlist for all to service_role
  using (true) with check (true);

drop trigger if exists trg_reply_only_allowlist_updated_at on public.saas_whatsapp_reply_only_allowlist;
create trigger trg_reply_only_allowlist_updated_at
  before update on public.saas_whatsapp_reply_only_allowlist
  for each row execute function public.set_updated_at();

create table if not exists public.saas_whatsapp_reply_only_rate_limits (
  integration_id bigint not null references public.saas_integraciones(id) on delete cascade,
  sender_hash text not null check (sender_hash ~ '^sha256:[a-f0-9]{12}$'),
  window_started_at timestamptz not null,
  message_count integer not null check (message_count >= 0),
  last_event_at timestamptz not null default now(),
  primary key (integration_id, sender_hash)
);

alter table public.saas_whatsapp_reply_only_rate_limits enable row level security;
revoke all on table public.saas_whatsapp_reply_only_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.saas_whatsapp_reply_only_rate_limits to service_role;
drop policy if exists saas_reply_only_rate_limits_service_role on public.saas_whatsapp_reply_only_rate_limits;
create policy saas_reply_only_rate_limits_service_role
  on public.saas_whatsapp_reply_only_rate_limits for all to service_role
  using (true) with check (true);

create or replace function public.resolve_whatsapp_reply_only_pilot(
  p_integration_id bigint,
  p_external_instance_id text,
  p_receiver_number text
)
returns table (integration_id bigint, tenant_id bigint, external_instance_id text, receiver_number text, mode text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_instance text := nullif(lower(btrim(p_external_instance_id)), '');
  v_receiver text := nullif(regexp_replace(coalesce(p_receiver_number, ''), '[^0-9]', '', 'g'), '');
begin
  if p_integration_id is null or v_instance is null or v_receiver is null then return; end if;
  return query
  select a.integration_id, a.tenant_id, a.external_instance_id, a.receiver_number, a.mode
    from public.saas_whatsapp_reply_only_allowlist a
    join public.saas_integraciones i on i.id = a.integration_id and i.barberia_id = a.tenant_id
   where a.enabled
     and a.mode = 'reply_only'
     and a.integration_id = p_integration_id
     and i.proveedor = 'evolution'
     and i.integration_type = 'whatsapp'
     and i.estado = 'conectado'
     and lower(btrim(a.external_instance_id)) = v_instance
     and a.receiver_number = v_receiver
     and lower(btrim(coalesce(i.external_instance_id, ''))) = v_instance
     and regexp_replace(coalesce(i.receiver_number, ''), '[^0-9]', '', 'g') = v_receiver;
end;
$$;

create or replace function public.claim_whatsapp_reply_only_rate_limit(
  p_integration_id bigint,
  p_sender_hash text,
  p_now timestamptz default now(),
  p_limit integer default 10,
  p_window_seconds integer default 60
)
returns table (allowed boolean, message_count integer, retry_after_seconds integer)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.saas_whatsapp_reply_only_rate_limits%rowtype;
  v_window interval := make_interval(secs => greatest(1, least(p_window_seconds, 3600)));
  v_limit integer := greatest(1, least(p_limit, 100));
  v_count integer;
  v_start timestamptz;
  v_retry integer := 0;
begin
  if p_integration_id is null or p_sender_hash is null or p_sender_hash !~ '^sha256:[a-f0-9]{12}$' then
    return query select false, 0, 0; return;
  end if;
  select * into v_row from public.saas_whatsapp_reply_only_rate_limits
   where integration_id = p_integration_id and sender_hash = p_sender_hash for update;
  if not found or p_now - v_row.window_started_at >= v_window then
    v_count := 1; v_start := p_now;
    insert into public.saas_whatsapp_reply_only_rate_limits (integration_id, sender_hash, window_started_at, message_count, last_event_at)
    values (p_integration_id, p_sender_hash, v_start, v_count, p_now)
    on conflict (integration_id, sender_hash) do update set window_started_at = excluded.window_started_at, message_count = excluded.message_count, last_event_at = excluded.last_event_at;
  else
    v_count := v_row.message_count + 1; v_start := v_row.window_started_at;
    update public.saas_whatsapp_reply_only_rate_limits set message_count = v_count, last_event_at = p_now
     where integration_id = p_integration_id and sender_hash = p_sender_hash;
  end if;
  if v_count > v_limit then v_retry := greatest(1, ceil(extract(epoch from (v_start + v_window - p_now)))::integer); end if;
  return query select v_count <= v_limit, v_count, v_retry;
end;
$$;

revoke all on function public.resolve_whatsapp_reply_only_pilot(bigint, text, text) from public, anon, authenticated;
revoke all on function public.claim_whatsapp_reply_only_rate_limit(bigint, text, timestamptz, integer, integer) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_reply_only_pilot(bigint, text, text) to service_role;
grant execute on function public.claim_whatsapp_reply_only_rate_limit(bigint, text, timestamptz, integer, integer) to service_role;

commit;
