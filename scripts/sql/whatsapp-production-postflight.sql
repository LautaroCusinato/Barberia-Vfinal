-- READ ONLY. Run immediately after the approved production migration.
-- It returns aggregate/runtime metadata only and never exposes customer data.
begin transaction read only;

select
  version,
  version = any(array['20260913110000', '20260913120000']) as expected_runtime_migration
from supabase_migrations.schema_migrations
where version = any(array['20260913110000', '20260913120000'])
order by version;

select
  a.attname as column_name,
  a.attnotnull as not_null,
  pg_get_expr(d.adbin, d.adrelid) as default_expression
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public'
  and c.relname = 'saas_whatsapp_connections'
  and a.attname = any(array['automation_enabled', 'outbound_enabled', 'booking_enabled'])
  and not a.attisdropped
order by a.attname;

select
  conname as constraint_name,
  contype as constraint_type,
  convalidated as validated
from pg_constraint
where conrelid = 'public.saas_whatsapp_connections'::regclass
  and conname = any(array[
    'saas_whatsapp_connections_outbound_requires_automation',
    'saas_whatsapp_connections_booking_requires_outbound',
    'saas_whatsapp_connections_integration_tenant_fk'
  ])
order by conname;

select
  count(*) filter (where integration_id is null) as missing_integration,
  count(*) filter (where environment = 'production' and automation_enabled) as production_automation_enabled,
  count(*) filter (where environment = 'production' and outbound_enabled) as production_outbound_enabled,
  count(*) filter (where environment = 'production' and booking_enabled) as production_booking_enabled,
  count(*) filter (where outbound_enabled and not automation_enabled) as invalid_outbound_without_automation,
  count(*) filter (where booking_enabled and not (automation_enabled and outbound_enabled)) as invalid_booking_without_outbound
from public.saas_whatsapp_connections;

select
  count(*) as integration_tenant_mismatches
from public.saas_whatsapp_connections c
left join public.saas_integraciones i
  on i.id = c.integration_id
 and i.barberia_id = c.barberia_id
where c.integration_id is not null
  and i.id is null;

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
    'resolve_whatsapp_runtime_context',
    'claim_whatsapp_runtime_event',
    'sync_whatsapp_integration_state'
  ])
order by p.proname;

rollback;
