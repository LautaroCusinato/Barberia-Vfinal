-- Refuerza la resolución multi-tenant de WhatsApp.
-- No se aplica automáticamente: requiere revisión y despliegue coordinado.
-- Cuando llegan instancia y receptor, ambos deben pertenecer a la misma
-- integración Evolution. Una identidad cruzada devuelve cero filas.
begin;

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
  v_instance text := nullif(lower(btrim(p_external_instance_id)), '');
  v_receiver text := nullif(regexp_replace(coalesce(p_receiver_number, ''), '[^0-9]', '', 'g'), '');
begin
  if p_integration_id is null and v_instance is null and v_receiver is null then
    return;
  end if;

  select i.* into v_integration
  from public.saas_integraciones i
  where i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp'
    and i.estado = 'conectado'
    and (p_integration_id is null or i.id = p_integration_id)
    and (v_instance is null or lower(btrim(i.external_instance_id)) = v_instance)
    and (v_receiver is null or i.receiver_number = v_receiver);

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

revoke all on function public.resolve_whatsapp_tenant_context(text, text, bigint) from public, anon, authenticated;
grant execute on function public.resolve_whatsapp_tenant_context(text, text, bigint) to service_role;

commit;
