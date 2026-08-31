-- Comercial B: metadata consumed by PlatformCRM for manual activation.
--
-- Migration A owns the shared subscription state machine because trial
-- expiration and the owner/admin activation path both use the same guarded
-- transition RPC. This migration contains only the PlatformCRM projection;
-- it does not introduce a second transition function or change entitlement
-- rules.
begin;

create or replace function public.get_platform_billing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.billing_can_manage() then
    raise exception 'Sólo owner/admin de plataforma puede consultar billing global.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'subscriptions_by_state', coalesce((select jsonb_object_agg(estado, total) from (select estado, count(*) total from public.saas_suscripciones group by estado) s), '{}'::jsonb),
    'tenants', coalesce((select jsonb_agg(jsonb_build_object(
      'barberia_id', b.id,
      'nombre', b.nombre,
      'plan_codigo', s.plan_codigo,
      'estado', s.estado,
      'status_reason', s.status_reason,
      'state_version', s.state_version,
      'subscription_id', s.id,
      'access_state', public.barberia_access_state(b.id),
      'trial_ends_at', s.trial_ends_at,
      'current_period_end', s.current_period_end
    ) order by b.nombre) from public.barberias b join public.saas_suscripciones s on s.barberia_id = b.id), '[]'::jsonb),
    'pending_webhooks', (select count(*) from public.saas_billing_webhook_events where estado in ('received','processing','failed')),
    'pending_events', (select count(*) from public.saas_billing_events where estado = 'pending')
  ) into v_result;
  return v_result;
end;
$$;

-- Preserve the existing authenticated/service-role read path without making
-- the platform overview callable by PUBLIC or anon. CREATE OR REPLACE keeps
-- this grant contract idempotent across retries.
revoke all on function public.get_platform_billing_overview() from public, anon;
grant execute on function public.get_platform_billing_overview() to authenticated, service_role;

commit;
