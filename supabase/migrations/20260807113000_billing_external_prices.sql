-- Precios externos por proveedor, país, moneda y entorno.
-- El precio base internacional de saas_planes no se modifica.
begin;

create table if not exists public.saas_plan_precios (
  id bigint generated always as identity primary key,
  plan_codigo text not null references public.saas_planes(codigo) on delete cascade,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo) on delete cascade,
  pais_codigo text not null default 'GLOBAL',
  moneda text not null,
  importe numeric(12,2) not null check (importe >= 0),
  periodicidad text not null default 'monthly' check (periodicidad in ('monthly','yearly')),
  entorno text not null default 'sandbox' check (entorno in ('sandbox','production')),
  external_product_id text,
  external_plan_id text,
  habilitado boolean not null default false,
  activo boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pais_codigo = 'GLOBAL' or pais_codigo ~ '^[A-Z]{2}$'),
  check (moneda = upper(moneda) and moneda ~ '^[A-Z]{3}$'),
  unique (plan_codigo, proveedor_codigo, pais_codigo, moneda, periodicidad, entorno)
);

create index if not exists idx_saas_plan_precios_lookup
  on public.saas_plan_precios(plan_codigo, proveedor_codigo, entorno, pais_codigo, activo);

do $$
begin
  if to_regprocedure('public.set_updated_at()') is not null
    and not exists (
      select 1
      from pg_trigger
      where tgname = 'trg_saas_plan_precios_updated_at'
        and tgrelid = 'public.saas_plan_precios'::regclass
    ) then
    create trigger trg_saas_plan_precios_updated_at
      before update on public.saas_plan_precios
      for each row execute function public.set_updated_at();
  end if;
end;
$$;

alter table public.saas_plan_precios enable row level security;

drop policy if exists saas_plan_precios_authenticated_read on public.saas_plan_precios;
create policy saas_plan_precios_authenticated_read
  on public.saas_plan_precios
  for select to authenticated
  using (true);

revoke insert, update, delete on public.saas_plan_precios from anon, authenticated;
grant select on public.saas_plan_precios to authenticated, service_role;

insert into public.saas_plan_precios (
  plan_codigo, proveedor_codigo, pais_codigo, moneda, importe, periodicidad, entorno, activo, habilitado, metadata
)
values ('starter', 'mercadopago', 'AR', 'ARS', 15000, 'monthly', 'sandbox', true, false,
  jsonb_build_object('source', 'sandbox_authorized_price', 'configured_at', now()))
on conflict (plan_codigo, proveedor_codigo, pais_codigo, moneda, periodicidad, entorno)
do update set importe = excluded.importe, activo = true, updated_at = now();

commit;
