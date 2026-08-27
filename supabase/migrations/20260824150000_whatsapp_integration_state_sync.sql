-- Keep the legacy integration status as a compatibility projection of the
-- tenant-scoped WhatsApp connection. The connection row is authoritative.
begin;

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
  set estado = v_estado
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
after insert or update of state, integration_id, provider, environment
on public.saas_whatsapp_connections
for each row execute function public.sync_whatsapp_integration_state();

-- Reconcile only the already-paired QA fixture. Future transitions are kept
-- aligned by the trigger above; this is not a second source of truth.
update public.saas_integraciones i
set estado = case c.state
  when 'CONNECTED' then 'conectado'
  when 'DISCONNECTED' then 'desactivado'
  when 'ERROR' then 'error'
  else 'pendiente'
end
from public.saas_whatsapp_connections c
where c.integration_id = i.id
  and c.barberia_id = i.barberia_id
  and c.provider = 'evolution'
  and c.environment = 'qa'
  and c.barberia_id = 1
  and c.instance_name = 'austral-qa-tenant-1'
  and i.proveedor = 'evolution'
  and i.integration_type = 'whatsapp'
  and i.estado is distinct from case c.state
    when 'CONNECTED' then 'conectado'
    when 'DISCONNECTED' then 'desactivado'
    when 'ERROR' then 'error'
    else 'pendiente'
  end;

-- The tenant-scoped connection is authoritative for claim eligibility. The
-- legacy integration status remains a synchronized compatibility projection.
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
  join public.saas_whatsapp_connections c
    on c.integration_id = i.id
   and c.barberia_id = i.barberia_id
  where i.id = p_integration_id
    and i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp'
    and c.provider = 'evolution'
    and c.environment = 'qa'
    and c.state = 'CONNECTED'
    and lower(btrim(coalesce(c.instance_name, ''))) like 'austral-qa-tenant-%'
    and lower(btrim(coalesce(c.instance_name, ''))) <> 'miwsp';
  if not found then
    raise exception 'La conexión QA de WhatsApp no está disponible.' using errcode = '42501';
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

revoke all on function public.claim_whatsapp_event(bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_event(bigint, text, timestamptz) to service_role;

commit;
