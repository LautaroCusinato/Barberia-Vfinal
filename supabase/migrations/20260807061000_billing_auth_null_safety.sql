-- Evita que una autorización sin membresía quede en NULL y sea interpretada
-- como permitida por un IF NOT dentro de una función SECURITY DEFINER.
begin;

create or replace function public.billing_can_view(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or public.billing_is_platform_admin()
    or coalesce(public.is_barberia_role(p_barberia_id, array['owner']), false);
$$;

create or replace function public.billing_can_view_commercial(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or exists (
      select 1
      from public.platform_members
      where user_id = auth.uid()
        and role in ('owner', 'admin', 'sales', 'support', 'readonly')
    )
    or coalesce(public.is_barberia_role(p_barberia_id, array['owner']), false);
$$;

create or replace function public.billing_can_checkout_for_tenant(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or public.billing_is_platform_admin()
    or coalesce(public.is_barberia_role(p_barberia_id, array['owner']), false);
$$;

commit;
