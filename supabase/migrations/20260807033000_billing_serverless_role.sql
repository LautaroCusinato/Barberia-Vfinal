-- Permite que únicamente el backend serverless autenticado con service_role
-- invoque RPCs de billing después de validar la sesión por su cuenta.
begin;

create or replace function public.billing_can_view(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or public.is_platform_member()
    or public.is_barberia_role(p_barberia_id, array['owner']);
$$;

revoke all on function public.billing_can_view(bigint) from public, anon;
grant execute on function public.billing_can_view(bigint) to authenticated, service_role;

commit;
