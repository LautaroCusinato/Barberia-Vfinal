-- Billing multi-entorno: binding explícito proveedor + entorno + tenant.
--
-- La estructura es aditiva, idempotente y reversible. No cambia la
-- configuración global de saas_proveedores_pago ni habilita checkout.
-- Las credenciales continúan siendo secretos de Edge Functions.
begin;

create table if not exists public.saas_billing_provider_bindings (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo) on delete cascade,
  entorno text not null check (entorno in ('sandbox', 'production')),
  plan_codigo text not null references public.saas_planes(codigo) on delete restrict,
  precio_id bigint not null references public.saas_plan_precios(id) on delete restrict,
  external_plan_id text,
  external_seller_id bigint,
  external_application_id bigint,
  activo boolean not null default true,
  checkout_habilitado boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, proveedor_codigo, entorno),
  unique (proveedor_codigo, entorno, precio_id),
  check (external_plan_id is null or char_length(btrim(external_plan_id)) between 8 and 200),
  check (external_seller_id is null or external_seller_id > 0),
  check (external_application_id is null or external_application_id > 0)
);

create index if not exists idx_saas_billing_provider_bindings_lookup
  on public.saas_billing_provider_bindings (proveedor_codigo, entorno, barberia_id, plan_codigo, activo);

create index if not exists idx_saas_billing_provider_bindings_external_plan
  on public.saas_billing_provider_bindings (proveedor_codigo, entorno, external_plan_id)
  where external_plan_id is not null;

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
    and not exists (
      select 1 from pg_trigger
      where tgname = 'trg_saas_billing_provider_bindings_updated_at'
        and tgrelid = 'public.saas_billing_provider_bindings'::regclass
    ) then
    create trigger trg_saas_billing_provider_bindings_updated_at
      before update on public.saas_billing_provider_bindings
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.saas_billing_provider_bindings enable row level security;

drop policy if exists saas_billing_provider_bindings_select on public.saas_billing_provider_bindings;
create policy saas_billing_provider_bindings_select
  on public.saas_billing_provider_bindings
  for select to authenticated
  using (public.is_platform_member() or public.billing_can_view(barberia_id));

revoke all on public.saas_billing_provider_bindings from anon;
revoke insert, update, delete on public.saas_billing_provider_bindings from authenticated;
grant select on public.saas_billing_provider_bindings to authenticated, service_role;
grant all on public.saas_billing_provider_bindings to service_role;

-- Backfill only when the explicitly identified tenant/price already exists.
-- This keeps the migration safe on QA copies whose identity sequences differ.
insert into public.saas_billing_provider_bindings (
  barberia_id, proveedor_codigo, entorno, plan_codigo, precio_id,
  external_plan_id, activo, checkout_habilitado, metadata
)
select 6, p.proveedor_codigo, p.entorno, p.plan_codigo, p.id,
       p.external_plan_id, p.activo, false,
       jsonb_build_object('source', 'multi_environment_backfill', 'tenant_scope', 6)
from public.saas_plan_precios p
where p.id = 1
  and p.proveedor_codigo = 'mercadopago'
  and p.entorno = 'sandbox'
  and exists (select 1 from public.barberias b where b.id = 6)
on conflict (barberia_id, proveedor_codigo, entorno) do update
set precio_id = excluded.precio_id,
    plan_codigo = excluded.plan_codigo,
    external_plan_id = coalesce(excluded.external_plan_id, public.saas_billing_provider_bindings.external_plan_id),
    updated_at = now();

insert into public.saas_billing_provider_bindings (
  barberia_id, proveedor_codigo, entorno, plan_codigo, precio_id,
  external_plan_id, external_seller_id, external_application_id,
  activo, checkout_habilitado, metadata
)
select 8, p.proveedor_codigo, p.entorno, p.plan_codigo, p.id,
       p.external_plan_id, 1334909095, 3640459333061791,
       p.activo, false,
       jsonb_build_object('source', 'multi_environment_backfill', 'tenant_scope', 8, 'checkout_enabled', false)
from public.saas_plan_precios p
where p.id = 2
  and p.proveedor_codigo = 'mercadopago'
  and p.entorno = 'production'
  and exists (select 1 from public.barberias b where b.id = 8)
on conflict (barberia_id, proveedor_codigo, entorno) do update
set precio_id = excluded.precio_id,
    plan_codigo = excluded.plan_codigo,
    external_plan_id = coalesce(excluded.external_plan_id, public.saas_billing_provider_bindings.external_plan_id),
    external_seller_id = coalesce(excluded.external_seller_id, public.saas_billing_provider_bindings.external_seller_id),
    external_application_id = coalesce(excluded.external_application_id, public.saas_billing_provider_bindings.external_application_id),
    updated_at = now();

commit;
