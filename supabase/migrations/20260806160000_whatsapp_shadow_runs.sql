-- Reporte minimizado de ejecuciones shadow. No guarda conversaciones ni
-- respuestas completas; sólo permite comparar resultados y latencias.
begin;

create table if not exists public.saas_automation_shadow_runs (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.barberias(id) on delete cascade,
  integration_id bigint not null references public.saas_integraciones(id) on delete cascade,
  event_id text not null check (char_length(btrim(event_id)) between 1 and 200),
  mode text not null default 'shadow' check (mode = 'shadow'),
  intent text,
  proposed_result text,
  proposed_response_length integer check (proposed_response_length is null or proposed_response_length between 0 and 10000),
  proposed_latency_ms integer check (proposed_latency_ms is null or proposed_latency_ms >= 0),
  proposed_tokens_input integer check (proposed_tokens_input is null or proposed_tokens_input >= 0),
  proposed_tokens_output integer check (proposed_tokens_output is null or proposed_tokens_output >= 0),
  current_response_hash text,
  proposed_response_hash text,
  current_latency_ms integer check (current_latency_ms is null or current_latency_ms >= 0),
  current_result text,
  differences jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  unique (integration_id, event_id)
);

create index if not exists idx_saas_shadow_runs_cleanup
  on public.saas_automation_shadow_runs (expires_at, observed_at);
create index if not exists idx_saas_shadow_runs_tenant
  on public.saas_automation_shadow_runs (tenant_id, observed_at desc);

alter table public.saas_automation_shadow_runs enable row level security;
revoke all on table public.saas_automation_shadow_runs from public, anon, authenticated;
grant select, insert, update, delete on table public.saas_automation_shadow_runs to service_role;
drop policy if exists "saas_shadow_runs_service_role" on public.saas_automation_shadow_runs;
create policy "saas_shadow_runs_service_role"
on public.saas_automation_shadow_runs for all to service_role
using (true) with check (true);

create or replace function public.record_whatsapp_shadow_run(
  p_integration_id bigint,
  p_event_id text,
  p_intent text default null,
  p_proposed_result text default null,
  p_proposed_response_length integer default null,
  p_proposed_latency_ms integer default null,
  p_proposed_tokens_input integer default null,
  p_proposed_tokens_output integer default null,
  p_metadata jsonb default '{}'::jsonb
)
returns table (shadow_run_id bigint, tenant_id bigint, mode text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_integration public.saas_integraciones%rowtype;
  v_id bigint;
begin
  if nullif(btrim(p_event_id), '') is null then
    raise exception 'Falta el identificador del evento shadow.' using errcode = '22023';
  end if;
  if p_proposed_response_length is not null and (p_proposed_response_length < 0 or p_proposed_response_length > 10000) then
    raise exception 'Longitud de respuesta shadow inválida.' using errcode = '22023';
  end if;

  select i.* into v_integration
  from public.saas_integraciones i
  where i.id = p_integration_id
    and i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp';
  if not found then
    raise exception 'La integración shadow no existe.' using errcode = '42501';
  end if;

  insert into public.saas_automation_shadow_runs (
    tenant_id, integration_id, event_id, intent, proposed_result,
    proposed_response_length, proposed_latency_ms, proposed_tokens_input,
    proposed_tokens_output, metadata
  ) values (
    v_integration.barberia_id, v_integration.id, btrim(p_event_id), p_intent,
    p_proposed_result, p_proposed_response_length, p_proposed_latency_ms,
    p_proposed_tokens_input, p_proposed_tokens_output, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (integration_id, event_id) do update set
    intent = excluded.intent,
    proposed_result = excluded.proposed_result,
    proposed_response_length = excluded.proposed_response_length,
    proposed_latency_ms = excluded.proposed_latency_ms,
    proposed_tokens_input = excluded.proposed_tokens_input,
    proposed_tokens_output = excluded.proposed_tokens_output,
    metadata = excluded.metadata,
    observed_at = now(),
    expires_at = now() + interval '30 days'
  returning id into v_id;

  return query select v_id, v_integration.barberia_id, 'shadow'::text;
end;
$$;

create or replace function public.cleanup_whatsapp_shadow_runs(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'Límite de limpieza shadow inválido.' using errcode = '22023';
  end if;
  delete from public.saas_automation_shadow_runs
  where id in (
    select id from public.saas_automation_shadow_runs
    where expires_at <= now()
    order by expires_at
    limit p_limit
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.record_whatsapp_shadow_run(bigint, text, text, text, integer, integer, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.cleanup_whatsapp_shadow_runs(integer) from public, anon, authenticated;
grant execute on function public.record_whatsapp_shadow_run(bigint, text, text, text, integer, integer, integer, integer, jsonb) to service_role;
grant execute on function public.cleanup_whatsapp_shadow_runs(integer) to service_role;

commit;
