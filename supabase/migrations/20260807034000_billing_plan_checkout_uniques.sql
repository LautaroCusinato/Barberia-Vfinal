-- Evita dos checkouts activos del mismo tenant/plan/proveedor y evita que
-- dos planes internos apunten al mismo plan externo.
begin;

create unique index if not exists uq_billing_active_checkout_per_plan
  on public.saas_billing_checkout_attempts (barberia_id, plan_codigo, proveedor_codigo)
  where estado in ('created', 'pending_provider', 'ready');

create unique index if not exists uq_billing_external_plan_per_provider
  on public.saas_plan_proveedores (proveedor_codigo, external_plan_id)
  where external_plan_id is not null;

commit;
