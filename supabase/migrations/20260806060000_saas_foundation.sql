-- Base aditiva para convertir el producto actual en una plataforma SaaS.
-- No cambia las políticas existentes de agenda ni guarda secretos de terceros.
-- La aplicación de esta migración debe hacerse después de revisar el plan y
-- crear el primer usuario de plataforma en platform_members.
begin;

-- Metadatos comerciales y de onboarding por tenant. `barberia_id` se conserva
-- como nombre físico por compatibilidad; conceptualmente representa tenant_id.
alter table public.barberias add column if not exists vertical text;
alter table public.barberias add column if not exists estado_cuenta text;
alter table public.barberias add column if not exists plan_codigo text;
alter table public.barberias add column if not exists trial_ends_at timestamptz;
alter table public.barberias add column if not exists locale text;
alter table public.barberias add column if not exists billing_email text;
alter table public.barberias add column if not exists onboarding_completed boolean;
alter table public.barberias add column if not exists metadata jsonb;

update public.barberias
set vertical = coalesce(nullif(vertical, ''), 'barberia'),
    estado_cuenta = coalesce(nullif(estado_cuenta, ''), 'active'),
    plan_codigo = coalesce(nullif(plan_codigo, ''), 'starter'),
    locale = coalesce(nullif(locale, ''), 'es-AR'),
    onboarding_completed = coalesce(onboarding_completed, true),
    metadata = coalesce(metadata, '{}'::jsonb);

alter table public.barberias alter column vertical set default 'barberia';
alter table public.barberias alter column vertical set not null;
alter table public.barberias alter column estado_cuenta set default 'trial';
alter table public.barberias alter column estado_cuenta set not null;
alter table public.barberias alter column plan_codigo set default 'starter';
alter table public.barberias alter column plan_codigo set not null;
alter table public.barberias alter column locale set default 'es-AR';
alter table public.barberias alter column locale set not null;
alter table public.barberias alter column onboarding_completed set default false;
alter table public.barberias alter column onboarding_completed set not null;
alter table public.barberias alter column metadata set default '{}'::jsonb;
alter table public.barberias alter column metadata set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'barberias_vertical_check') then
    alter table public.barberias add constraint barberias_vertical_check
      check (vertical in ('barberia', 'peluqueria', 'salon', 'spa', 'veterinaria', 'gimnasio', 'clinica', 'taller', 'custom'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'barberias_estado_cuenta_check') then
    alter table public.barberias add constraint barberias_estado_cuenta_check
      check (estado_cuenta in ('trial', 'active', 'past_due', 'suspended', 'canceled'));
  end if;
end
$$;

create table if not exists public.saas_planes (
  codigo text primary key,
  nombre text not null,
  descripcion text,
  precio_mensual numeric(12,2) not null default 0 check (precio_mensual >= 0),
  moneda text not null default 'USD',
  trial_dias integer not null default 14 check (trial_dias between 0 and 90),
  limites jsonb not null default '{}'::jsonb,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.saas_planes (codigo, nombre, descripcion, precio_mensual, moneda, trial_dias, limites)
values
  ('starter', 'Starter', 'Agenda, clientes y reservas online', 19, 'USD', 14, '{"usuarios": 3, "reservas_mensuales": 500}'::jsonb),
  ('pro', 'Pro', 'Automatizaciones, WhatsApp y métricas avanzadas', 39, 'USD', 14, '{"usuarios": 10, "reservas_mensuales": 2000}'::jsonb),
  ('business', 'Business', 'Operación multi-sede y soporte prioritario', 79, 'USD', 14, '{"usuarios": 50, "reservas_mensuales": 10000}'::jsonb)
on conflict (codigo) do nothing;

create table if not exists public.saas_suscripciones (
  id bigint generated always as identity primary key,
  barberia_id bigint not null unique references public.barberias(id) on delete cascade,
  plan_codigo text not null references public.saas_planes(codigo),
  estado text not null default 'trialing' check (estado in ('trialing', 'active', 'past_due', 'paused', 'canceled', 'expired')),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Las cuentas existentes siguen operativas. Las nuevas cuentas se inicializan
-- con trialing mediante el trigger de bootstrap de abajo.
insert into public.saas_suscripciones (barberia_id, plan_codigo, estado, trial_started_at)
select b.id, coalesce(b.plan_codigo, 'starter'), 'active', b.created_at
from public.barberias b
on conflict (barberia_id) do nothing;

create or replace function public.bootstrap_barberia_saas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.saas_suscripciones (barberia_id, plan_codigo, estado, trial_started_at, trial_ends_at)
  values (new.id, coalesce(new.plan_codigo, 'starter'), 'trialing', now(), now() + interval '14 days')
  on conflict (barberia_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_barberias_bootstrap_saas on public.barberias;
create trigger trg_barberias_bootstrap_saas
after insert on public.barberias
for each row execute function public.bootstrap_barberia_saas();

create or replace function public.barberia_access_state(p_barberia_id bigint)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when b.estado_cuenta = 'suspended' then 'suspended'
    when s.estado = 'active' then 'active'
    when s.estado = 'trialing' and coalesce(s.trial_ends_at, now()) >= now() then 'trialing'
    when s.estado = 'past_due' then 'past_due'
    when s.estado in ('paused', 'canceled', 'expired') then s.estado
    else coalesce(b.estado_cuenta, 'trial')
  end
  from public.barberias b
  left join public.saas_suscripciones s on s.barberia_id = b.id
  where b.id = p_barberia_id;
$$;

-- Usuarios internos de la empresa SaaS. No se mezclan con los miembros de un
-- tenant: un vendedor o soporte puede trabajar con muchos negocios.
create table if not exists public.platform_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'sales', 'support', 'automation')),
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_member()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.platform_members where user_id = auth.uid());
$$;

-- Registro de integraciones por tenant. Los secretos viven en n8n/Cloudflare,
-- nunca en esta tabla ni en variables VITE_*.
create table if not exists public.saas_integraciones (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  proveedor text not null check (proveedor in ('supabase', 'cloudflare', 'github', 'n8n', 'deepseek', 'evolution')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'conectado', 'error', 'desactivado')),
  base_url text,
  referencia_externa text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, proveedor)
);

-- CRM interno de la empresa SaaS. Un negocio puede empezar como prospecto y
-- luego vincularse al tenant real cuando se convierte en cliente.
create table if not exists public.crm_negocios (
  id bigint generated always as identity primary key,
  barberia_id bigint references public.barberias(id) on delete set null,
  nombre text not null,
  rubro text not null default 'custom',
  pais text,
  idioma text not null default 'es',
  zona_horaria text,
  sitio_web text,
  telefono text,
  email text,
  canal_origen text,
  etapa text not null default 'prospecto' check (etapa in ('prospecto', 'contactado', 'calificado', 'demo', 'prueba', 'cliente', 'pausado', 'perdido')),
  interes text,
  precio_ofrecido numeric(12,2) check (precio_ofrecido is null or precio_ofrecido >= 0),
  moneda text default 'USD',
  proxima_accion_at timestamptz,
  resultado text,
  notas text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_leads (
  id bigint generated always as identity primary key,
  negocio_id bigint not null references public.crm_negocios(id) on delete cascade,
  nombre_contacto text,
  cargo text,
  email text,
  telefono text,
  canal_preferido text,
  estado_conversacion text not null default 'nuevo' check (estado_conversacion in ('nuevo', 'en_conversacion', 'esperando', 'interesado', 'no_interesado', 'convertido', 'sin_respuesta')),
  interes text,
  precio_ofrecido numeric(12,2) check (precio_ofrecido is null or precio_ofrecido >= 0),
  moneda text default 'USD',
  proxima_accion_at timestamptz,
  resultado text,
  responsable_id uuid references auth.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.crm_interacciones (
  id bigint generated always as identity primary key,
  lead_id bigint not null references public.crm_leads(id) on delete cascade,
  canal text not null,
  direccion text not null check (direccion in ('entrante', 'saliente', 'interna')),
  mensaje text,
  resumen text,
  external_id text,
  proxima_accion_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_saas_suscripciones_estado on public.saas_suscripciones (estado);
create index if not exists idx_crm_negocios_etapa on public.crm_negocios (etapa, proxima_accion_at);
create index if not exists idx_crm_leads_estado on public.crm_leads (estado_conversacion, proxima_accion_at);
create index if not exists idx_crm_interacciones_lead on public.crm_interacciones (lead_id, created_at desc);
create index if not exists idx_saas_integraciones_barberia on public.saas_integraciones (barberia_id);

alter table public.saas_planes enable row level security;
alter table public.saas_suscripciones enable row level security;
alter table public.platform_members enable row level security;
alter table public.saas_integraciones enable row level security;
alter table public.crm_negocios enable row level security;
alter table public.crm_leads enable row level security;
alter table public.crm_interacciones enable row level security;

drop policy if exists "saas_planes_select_platform" on public.saas_planes;
create policy "saas_planes_select_platform" on public.saas_planes
for select to authenticated using (public.is_platform_member());

drop policy if exists "saas_suscripciones_select_platform" on public.saas_suscripciones;
create policy "saas_suscripciones_select_platform" on public.saas_suscripciones
for select to authenticated using (public.is_platform_member());
drop policy if exists "saas_suscripciones_select_owner" on public.saas_suscripciones;
create policy "saas_suscripciones_select_owner" on public.saas_suscripciones
for select to authenticated using (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "platform_members_select_platform" on public.platform_members;
create policy "platform_members_select_platform" on public.platform_members
for select to authenticated using (public.is_platform_member());

drop policy if exists "saas_integraciones_select_member" on public.saas_integraciones;
create policy "saas_integraciones_select_member" on public.saas_integraciones
for select to authenticated using (public.is_barberia_member(barberia_id));
drop policy if exists "saas_integraciones_write_owner" on public.saas_integraciones;
create policy "saas_integraciones_write_owner" on public.saas_integraciones
for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner']))
with check (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "crm_negocios_platform_all" on public.crm_negocios;
create policy "crm_negocios_platform_all" on public.crm_negocios
for all to authenticated using (public.is_platform_member()) with check (public.is_platform_member());
drop policy if exists "crm_leads_platform_all" on public.crm_leads;
create policy "crm_leads_platform_all" on public.crm_leads
for all to authenticated using (public.is_platform_member()) with check (public.is_platform_member());
drop policy if exists "crm_interacciones_platform_all" on public.crm_interacciones;
create policy "crm_interacciones_platform_all" on public.crm_interacciones
for all to authenticated using (public.is_platform_member()) with check (public.is_platform_member());

drop trigger if exists trg_saas_planes_updated_at on public.saas_planes;
create trigger trg_saas_planes_updated_at before update on public.saas_planes
for each row execute function public.set_updated_at();
drop trigger if exists trg_saas_suscripciones_updated_at on public.saas_suscripciones;
create trigger trg_saas_suscripciones_updated_at before update on public.saas_suscripciones
for each row execute function public.set_updated_at();
drop trigger if exists trg_saas_integraciones_updated_at on public.saas_integraciones;
create trigger trg_saas_integraciones_updated_at before update on public.saas_integraciones
for each row execute function public.set_updated_at();
drop trigger if exists trg_crm_negocios_updated_at on public.crm_negocios;
create trigger trg_crm_negocios_updated_at before update on public.crm_negocios
for each row execute function public.set_updated_at();
drop trigger if exists trg_crm_leads_updated_at on public.crm_leads;
create trigger trg_crm_leads_updated_at before update on public.crm_leads
for each row execute function public.set_updated_at();

revoke all on function public.barberia_access_state(bigint) from public, anon;
grant execute on function public.barberia_access_state(bigint) to authenticated;
revoke all on function public.is_platform_member() from public, anon;
grant execute on function public.is_platform_member() to authenticated;

commit;

