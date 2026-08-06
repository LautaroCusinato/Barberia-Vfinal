-- Evita que el nombre de salida `event_id` entre en conflicto con el
-- objetivo de la restricción única dentro de PL/pgSQL.
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

revoke all on function public.claim_whatsapp_event(bigint, text, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_event(bigint, text, timestamptz) to service_role;
