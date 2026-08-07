-- La ausencia de un JWT claim también debe evaluar como FALSE, nunca NULL.
begin;

create or replace function public.billing_can_view(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(current_setting('request.jwt.claim.role', true) = 'service_role', false)
    or coalesce(public.billing_is_platform_admin(), false)
    or coalesce(public.is_barberia_role(p_barberia_id, array['owner']), false);
$$;

create or replace function public.billing_can_view_commercial(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(current_setting('request.jwt.claim.role', true) = 'service_role', false)
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
  select coalesce(current_setting('request.jwt.claim.role', true) = 'service_role', false)
    or coalesce(public.billing_is_platform_admin(), false);
$$;

create or replace function public.billing_can_reconcile()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(current_setting('request.jwt.claim.role', true) = 'service_role', false)
    or coalesce(public.billing_is_platform_admin(), false);
$$;

create or replace function public.billing_can_checkout_for_tenant(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(current_setting('request.jwt.claim.role', true) = 'service_role', false)
    or coalesce(public.billing_is_platform_admin(), false)
    or coalesce(public.is_barberia_role(p_barberia_id, array['owner']), false);
$$;

commit;
