-- READ ONLY. Run against the production project before any WhatsApp migration.
-- This file returns metadata only; it does not inspect customer rows or secrets.
begin transaction read only;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'name', p.polname,
      'command', case p.polcmd
        when 'r' then 'SELECT' when 'a' then 'INSERT'
        when 'w' then 'UPDATE' when 'd' then 'DELETE' when '*' then 'ALL'
      end,
      'roles', (select jsonb_agg(r.rolname order by r.rolname) from pg_roles r where r.oid = any(p.polroles)),
      'using', pg_get_expr(p.polqual, p.polrelid),
      'check', pg_get_expr(p.polwithcheck, p.polrelid)
    ) order by p.polname
  ) filter (where p.oid is not null), '[]'::jsonb) as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relname = any(array[
    'barberias', 'barberia_members', 'servicios', 'barberos',
    'barbero_servicios', 'horarios_barbero', 'bloqueos_agenda',
    'clientes', 'turnos', 'mensajes', 'saas_integraciones',
    'saas_whatsapp_connections', 'saas_automation_events',
    'saas_automation_shadow_runs'
  ])
group by c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relname;

select version, name
from supabase_migrations.schema_migrations
where version = any(array[
  '20260806150000',
  '20260824150000',
  '20260821090000',
  '20260913120000',
  '20260806163000',
  '20260807070000'
])
order by version;

select
  count(*) filter (where c.integration_id is null) as missing_integration,
  count(*) filter (where i.id is null and c.integration_id is not null) as mismatched_integration_tenant,
  count(*) filter (where c.environment = 'production' and (to_jsonb(c) ->> 'automation_enabled')::boolean is true) as production_automation_enabled,
  count(*) filter (where c.environment = 'production' and (to_jsonb(c) ->> 'outbound_enabled')::boolean is true) as production_outbound_enabled,
  count(*) filter (where c.environment = 'production' and (to_jsonb(c) ->> 'booking_enabled')::boolean is true) as production_booking_enabled
from public.saas_whatsapp_connections c
left join public.saas_integraciones i
  on i.id = c.integration_id
 and i.barberia_id = c.barberia_id;

select
  p.proname as function_name,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'execute') as service_role_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any(array[
    'resolve_whatsapp_tenant_context',
    'claim_whatsapp_event',
    'finish_whatsapp_event',
    'record_whatsapp_shadow_run',
    'resolve_whatsapp_runtime_context',
    'claim_whatsapp_runtime_event',
    'crear_reserva_whatsapp',
    'cancelar_reserva_whatsapp',
    'reprogramar_reserva_whatsapp'
  ])
order by p.proname;

rollback;
