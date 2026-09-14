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

rollback;
