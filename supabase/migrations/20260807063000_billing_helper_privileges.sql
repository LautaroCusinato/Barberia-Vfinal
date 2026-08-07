-- Los helpers de autorización sólo se invocan desde RPCs SECURITY DEFINER o
-- desde el backend service_role; no deben exponerse como RPC directos.
begin;

revoke all on function public.billing_can_view_commercial(bigint), public.billing_can_manage(bigint), public.billing_can_reconcile(), public.billing_can_checkout_for_tenant(bigint) from public, anon, authenticated;
grant execute on function public.billing_can_view_commercial(bigint), public.billing_can_manage(bigint), public.billing_can_reconcile(), public.billing_can_checkout_for_tenant(bigint) to service_role;

commit;
