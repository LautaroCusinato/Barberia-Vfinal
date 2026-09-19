-- READ ONLY. Run with psql -v tenant_id=<numeric id> -f <this file>.
-- Deliberately excludes phone numbers, JIDs, message bodies, prompts, QR data and credentials.
begin transaction read only;

select
  c.barberia_id as tenant_id,
  c.environment,
  c.state as connection_state,
  c.provisioning_mode,
  c.automation_enabled,
  c.outbound_enabled,
  c.booking_enabled,
  c.last_error_code,
  c.last_verified_at,
  c.qr_expires_at,
  i.estado as integration_state,
  c.integration_id = i.id and c.barberia_id = i.barberia_id as tenant_binding_valid
from public.saas_whatsapp_connections c
join public.saas_integraciones i on i.id = c.integration_id and i.barberia_id = c.barberia_id
where c.barberia_id = :'tenant_id'::bigint
  and c.environment = 'production';

select
  count(*) filter (where e.created_at >= now() - interval '15 minutes') as events_15m,
  count(*) filter (where e.created_at >= now() - interval '15 minutes' and e.status = 'failed') as failed_15m,
  count(*) filter (where e.created_at >= now() - interval '15 minutes' and e.event_id like 'outbound:%') as outbound_claims_15m,
  max(e.created_at) as latest_event_at,
  max(e.processed_at) as latest_processed_at
from public.saas_automation_events e
join public.saas_integraciones i on i.id = e.integration_id
where i.barberia_id = :'tenant_id'::bigint
  and i.proveedor = 'evolution';

select
  count(*) filter (where observed_at >= now() - interval '15 minutes') as shadow_runs_15m,
  max(observed_at) as latest_shadow_at,
  bool_or(coalesce((metadata ->> 'mutation_allowed')::boolean, false)) as any_mutation_allowed_15m,
  bool_or(coalesce((metadata ->> 'outbound_allowed')::boolean, false)) as any_outbound_allowed_15m
from public.saas_automation_shadow_runs s
join public.saas_integraciones i on i.id = s.integration_id
where i.barberia_id = :'tenant_id'::bigint
  and s.observed_at >= now() - interval '15 minutes';

rollback;
