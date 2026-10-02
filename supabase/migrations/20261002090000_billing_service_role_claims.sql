-- Detección correcta del backend service_role en los helpers de billing.
--
-- Por qué: PostgREST v10+ (la versión que usa Supabase) ya no publica las
-- GUC heredadas `request.jwt.claim.*`; sólo `request.jwt.claims` (JSON). Los
-- helpers comparaban `current_setting('request.jwt.claim.role', true)` con
-- 'service_role', que en Supabase siempre es NULL. Resultado: toda llamada del
-- backend con la service key era rechazada con 42501:
--   * billing-webhooks -> record_billing_webhook_event: ningún webhook de
--     Mercado Pago/PayPal se registraba ni activaba la suscripción pagada;
--   * billing-webhooks/billing-api/billing-jobs -> transition_saas_subscription
--     (webhooks, reconciliación, cancelación sandbox);
--   * billing-jobs -> expire_saas_trials.
-- `auth.role()` de Supabase ya lee ambas fuentes; acá se centraliza la misma
-- lógica en un helper. No amplía permisos: el claim `role` sólo vale
-- 'service_role' cuando PostgREST verificó un JWT firmado con la service key.
begin;

create or replace function public.request_is_service_role()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  ) is not distinct from 'service_role';
$$;

comment on function public.request_is_service_role() is
  'true sólo si la request PostgREST fue autenticada con la service key (lee request.jwt.claims y la GUC heredada).';

create or replace function public.billing_can_view(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.request_is_service_role()
    or coalesce(public.billing_is_platform_admin(), false)
    or coalesce(public.is_barberia_role(p_barberia_id, array['owner']), false);
$$;

create or replace function public.billing_can_view_commercial(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.request_is_service_role()
    or exists (
      select 1
      from public.platform_members
      where user_id = auth.uid()
        and role in ('owner', 'admin', 'sales', 'support', 'readonly')
    )
    or coalesce(public.is_barberia_role(p_barberia_id, array['owner']), false);
$$;

create or replace function public.billing_can_manage(p_barberia_id bigint default null)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.request_is_service_role()
    or coalesce(public.billing_is_platform_admin(), false);
$$;

create or replace function public.billing_can_reconcile()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.request_is_service_role()
    or coalesce(public.billing_is_platform_admin(), false);
$$;

create or replace function public.billing_can_checkout_for_tenant(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.request_is_service_role()
    or coalesce(public.billing_is_platform_admin(), false)
    or coalesce(public.is_barberia_role(p_barberia_id, array['owner']), false);
$$;

-- Misma corrección para la rama backend del acceso operativo. Las políticas
-- RLS no se evalúan para service_role (bypassrls), pero las RPC que llaman a
-- esta función desde el backend deben recibir el estado real del tenant.
create or replace function public.barberia_operational_access(p_barberia_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when public.request_is_service_role() then
      coalesce(public.barberia_access_state(p_barberia_id) in ('active', 'trialing', 'past_due'), false)
    else coalesce(
      exists (
        select 1
        from public.barberia_members m
        where m.barberia_id = p_barberia_id
          and m.user_id = auth.uid()
      )
      and public.barberia_access_state(p_barberia_id) in ('active', 'trialing', 'past_due'),
      false
    )
  end;
$$;

-- El helper sólo se usa dentro de funciones SECURITY DEFINER (que corren como
-- su owner); no necesita exponerse como RPC.
revoke all on function public.request_is_service_role() from public, anon, authenticated;
grant execute on function public.request_is_service_role() to service_role;

-- Se reafirman los grants vigentes (create or replace los conserva; esto deja
-- la migración idempotente aunque alguien los haya alterado a mano).
revoke all on function public.billing_can_view(bigint) from public, anon;
grant execute on function public.billing_can_view(bigint) to authenticated, service_role;
revoke all on function public.billing_can_view_commercial(bigint), public.billing_can_manage(bigint), public.billing_can_reconcile(), public.billing_can_checkout_for_tenant(bigint) from public, anon, authenticated;
grant execute on function public.billing_can_view_commercial(bigint), public.billing_can_manage(bigint), public.billing_can_reconcile(), public.billing_can_checkout_for_tenant(bigint) to service_role;
revoke all on function public.barberia_operational_access(bigint) from public, anon;
grant execute on function public.barberia_operational_access(bigint) to authenticated, service_role;

commit;
