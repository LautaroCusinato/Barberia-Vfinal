-- READ ONLY. Invoke with psql -v tenant_id=<numeric tenant id> -f <this file>.
-- The output is aggregate readiness metadata; it contains no customer PII.
begin transaction read only;

select
  b.id as tenant_id,
  b.onboarding_completed,
  nullif(btrim(b.nombre), '') is not null as business_name_configured,
  nullif(btrim(b.zona_horaria), '') is not null as timezone_configured,
  nullif(btrim(b.moneda), '') is not null as currency_configured,
  public.barberia_access_state(b.id) as access_state
from public.barberias b
where b.id = :'tenant_id'::bigint;

select
  count(*) filter (where role in ('owner', 'admin')) as owner_or_admin_members,
  count(*) as total_members
from public.barberia_members
where barberia_id = :'tenant_id'::bigint;

select
  count(*) filter (where activo and precio >= 0 and duracion_min > 0) as valid_active_services,
  count(*) filter (where activo) as active_services
from public.servicios
where barberia_id = :'tenant_id'::bigint;

select
  count(*) filter (where activo) as active_staff,
  count(*) filter (
    where activo and exists (
      select 1
      from public.barbero_servicios bs
      join public.servicios s on s.id = bs.servicio_id
      where bs.barbero_id = b.id
        and s.barberia_id = b.barberia_id
        and s.activo
    )
  ) as active_staff_with_active_service,
  count(*) filter (
    where activo and exists (
      select 1
      from public.horarios_barbero h
      where h.barbero_id = b.id
        and h.barberia_id = b.barberia_id
        and h.activo
    )
  ) as active_staff_with_schedule
from public.barberos b
where b.barberia_id = :'tenant_id'::bigint;

select
  i.id as integration_id,
  i.estado as integration_state,
  c.id as connection_id,
  c.environment,
  c.provisioning_mode,
  c.state as connection_state,
  c.automation_enabled,
  c.outbound_enabled,
  c.booking_enabled,
  c.integration_id = i.id and c.barberia_id = i.barberia_id as tenant_binding_valid
from public.saas_integraciones i
left join public.saas_whatsapp_connections c
  on c.integration_id = i.id
 and c.barberia_id = i.barberia_id
 and c.environment = 'production'
where i.barberia_id = :'tenant_id'::bigint
  and i.proveedor = 'evolution'
  and i.integration_type = 'whatsapp';

-- Machine-readable input for scripts/whatsapp-tenant-preflight.mjs. Save only
-- the readiness_snapshot value as JSON; it deliberately excludes customer PII.
with tenant as (
  select
    b.id,
    b.nombre as name,
    b.slug,
    b.zona_horaria as timezone,
    b.moneda as currency,
    b.onboarding_completed,
    public.barberia_access_state(b.id) as access_state
  from public.barberias b
  where b.id = :'tenant_id'::bigint
), counts as (
  select
    (select count(*) from public.barberia_members m where m.barberia_id = :'tenant_id'::bigint and m.role in ('owner', 'admin')) as owner_or_admin_members,
    (select count(*) from public.servicios s where s.barberia_id = :'tenant_id'::bigint and s.activo) as active_services,
    (select count(*) from public.servicios s where s.barberia_id = :'tenant_id'::bigint and s.activo and s.precio >= 0 and s.duracion_min > 0) as valid_active_services,
    (select count(*) from public.barberos b where b.barberia_id = :'tenant_id'::bigint and b.activo) as active_staff,
    (select count(*) from public.barberos b where b.barberia_id = :'tenant_id'::bigint and b.activo and exists (
      select 1 from public.barbero_servicios bs
      join public.servicios s on s.id = bs.servicio_id and s.barberia_id = b.barberia_id and s.activo
      where bs.barbero_id = b.id
    )) as active_staff_with_active_service,
    (select count(*) from public.barberos b where b.barberia_id = :'tenant_id'::bigint and b.activo and exists (
      select 1 from public.horarios_barbero h
      where h.barbero_id = b.id and h.barberia_id = b.barberia_id and h.activo
    )) as active_staff_with_schedule
), connections as (
  select
    c.environment,
    c.instance_name,
    c.provisioning_mode,
    c.state,
    c.automation_enabled,
    c.outbound_enabled,
    c.booking_enabled,
    c.integration_id = i.id and c.barberia_id = i.barberia_id as tenant_binding_valid
  from public.saas_whatsapp_connections c
  join public.saas_integraciones i on i.id = c.integration_id and i.barberia_id = c.barberia_id
  where c.barberia_id = :'tenant_id'::bigint
    and c.provider = 'evolution'
)
select jsonb_build_object(
  'tenant', case when t.id is null then null else jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'slug', t.slug,
    'timezone', t.timezone,
    'currency', t.currency,
    'access_state', t.access_state,
    'onboarding_completed', t.onboarding_completed
  ) end,
  'counts', to_jsonb(c),
  'connections', coalesce((select jsonb_agg(to_jsonb(connection)) from connections connection), '[]'::jsonb)
) as readiness_snapshot
from counts c
left join tenant t on true;

rollback;
