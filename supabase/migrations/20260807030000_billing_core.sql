-- Núcleo de billing SaaS, aditivo y agnóstico del proveedor.
--
-- Esta migración no llama APIs externas, no guarda secretos y no cambia
-- integraciones de WhatsApp. Las referencias a Mercado Pago y PayPal son
-- identificadores no sensibles; las credenciales sólo vivirán en un backend
--/worker cuando el piloto sandbox sea autorizado.
begin;

alter table public.saas_planes
  add column if not exists periodicidad text not null default 'monthly',
  add column if not exists funcionalidades jsonb not null default '[]'::jsonb,
  add column if not exists orden smallint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'saas_planes_periodicidad_check') then
    alter table public.saas_planes add constraint saas_planes_periodicidad_check
      check (periodicidad in ('monthly', 'yearly'));
  end if;
end
$$;

alter table public.saas_suscripciones
  add column if not exists precio numeric(12,2),
  add column if not exists moneda text,
  add column if not exists periodicidad text not null default 'monthly',
  add column if not exists grace_ends_at timestamptz,
  add column if not exists status_reason text,
  add column if not exists last_provider_event_id text,
  add column if not exists last_provider_event_at timestamptz,
  add column if not exists state_version integer not null default 1,
  add column if not exists state_changed_at timestamptz not null default now();

update public.saas_suscripciones s
set precio = coalesce(s.precio, p.precio_mensual),
    moneda = coalesce(nullif(s.moneda, ''), p.moneda),
    periodicidad = coalesce(nullif(s.periodicidad, ''), 'monthly')
from public.saas_planes p
where p.codigo = s.plan_codigo;

alter table public.saas_suscripciones alter column precio set default 0;
alter table public.saas_suscripciones alter column moneda set default 'USD';
alter table public.saas_suscripciones alter column precio set not null;
alter table public.saas_suscripciones alter column moneda set not null;

alter table public.saas_suscripciones drop constraint if exists saas_suscripciones_estado_check;
alter table public.saas_suscripciones add constraint saas_suscripciones_estado_check
  check (estado in (
    'trialing', 'active', 'past_due', 'grace_period', 'suspended',
    'canceled', 'incomplete', 'payment_review', 'refunded', 'paused', 'expired'
  ));

alter table public.saas_suscripciones drop constraint if exists saas_suscripciones_periodicidad_check;
alter table public.saas_suscripciones add constraint saas_suscripciones_periodicidad_check
  check (periodicidad in ('monthly', 'yearly'));

create table if not exists public.saas_proveedores_pago (
  codigo text primary key check (codigo in ('mercadopago', 'paypal')),
  nombre text not null,
  entorno text not null default 'sandbox' check (entorno in ('sandbox', 'production')),
  activo boolean not null default false,
  monedas text[] not null default '{}',
  paises text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.saas_proveedores_pago (codigo, nombre, entorno, activo, monedas, paises, metadata)
values
  ('mercadopago', 'Mercado Pago', 'sandbox', false, array['ARS','BRL','MXN','CLP','COP','UYU'], array['AR','BR','MX','CL','CO','UY'], '{"credentials_required":true}'::jsonb),
  ('paypal', 'PayPal', 'sandbox', false, array['USD','EUR','BRL','MXN'], array['US','ES','BR','MX'], '{"credentials_required":true}'::jsonb)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  entorno = 'sandbox',
  monedas = excluded.monedas,
  paises = excluded.paises,
  metadata = public.saas_proveedores_pago.metadata || excluded.metadata;

create table if not exists public.saas_plan_proveedores (
  id bigint generated always as identity primary key,
  plan_codigo text not null references public.saas_planes(codigo) on delete cascade,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo) on delete cascade,
  external_product_id text,
  external_plan_id text,
  habilitado boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_codigo, proveedor_codigo)
);

insert into public.saas_plan_proveedores (plan_codigo, proveedor_codigo)
select p.codigo, provider.codigo
from public.saas_planes p cross join public.saas_proveedores_pago provider
on conflict (plan_codigo, proveedor_codigo) do nothing;

create table if not exists public.saas_billing_customers (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo),
  external_customer_id text not null,
  email text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, proveedor_codigo),
  unique (proveedor_codigo, external_customer_id)
);

create table if not exists public.saas_suscripciones_externas (
  id bigint generated always as identity primary key,
  suscripcion_id bigint not null references public.saas_suscripciones(id) on delete cascade,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo),
  external_subscription_id text not null,
  external_plan_id text,
  estado_externo text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  last_synced_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proveedor_codigo, external_subscription_id),
  unique (suscripcion_id, proveedor_codigo)
);

create table if not exists public.saas_billing_checkout_attempts (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  suscripcion_id bigint references public.saas_suscripciones(id) on delete set null,
  plan_codigo text not null references public.saas_planes(codigo),
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo),
  idempotency_key text not null,
  estado text not null default 'created' check (estado in ('created','pending_provider','ready','completed','failed','expired','canceled')),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null,
  checkout_url text,
  external_checkout_id text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, idempotency_key)
);

create table if not exists public.saas_billing_payments (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  suscripcion_id bigint references public.saas_suscripciones(id) on delete set null,
  checkout_attempt_id bigint references public.saas_billing_checkout_attempts(id) on delete set null,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo),
  external_payment_id text not null,
  estado text not null check (estado in ('pending','approved','failed','refunded','review','canceled')),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null,
  paid_at timestamptz,
  failure_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proveedor_codigo, external_payment_id)
);

create table if not exists public.saas_billing_invoices (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  suscripcion_id bigint references public.saas_suscripciones(id) on delete set null,
  payment_id bigint references public.saas_billing_payments(id) on delete set null,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo),
  external_invoice_id text not null,
  estado text not null check (estado in ('draft','issued','paid','void','uncollectible')),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null,
  invoice_url text,
  issued_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proveedor_codigo, external_invoice_id)
);

create table if not exists public.saas_billing_refunds (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  payment_id bigint not null references public.saas_billing_payments(id) on delete cascade,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo),
  external_refund_id text not null,
  estado text not null check (estado in ('pending','approved','failed','canceled')),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (proveedor_codigo, external_refund_id)
);

create table if not exists public.saas_billing_webhook_events (
  id bigint generated always as identity primary key,
  proveedor_codigo text not null references public.saas_proveedores_pago(codigo),
  external_event_id text not null,
  event_type text not null,
  barberia_id bigint references public.barberias(id) on delete set null,
  suscripcion_id bigint references public.saas_suscripciones(id) on delete set null,
  signature_valid boolean not null default false,
  estado text not null default 'received' check (estado in ('received','processing','processed','ignored','failed')),
  payload_min jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  unique (proveedor_codigo, external_event_id)
);

create table if not exists public.saas_billing_state_history (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  suscripcion_id bigint not null references public.saas_suscripciones(id) on delete cascade,
  from_state text,
  to_state text not null,
  reason text,
  source text not null check (source in ('trial','provider','admin','system','reconciliation')),
  provider_event_id text,
  state_version integer not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (suscripcion_id, state_version)
);

create table if not exists public.saas_billing_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  barberia_id bigint references public.barberias(id) on delete set null,
  suscripcion_id bigint references public.saas_suscripciones(id) on delete set null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  estado text not null default 'pending' check (estado in ('pending','published','failed')),
  occurred_at timestamptz not null default now(),
  published_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  last_error text
);

create index if not exists idx_billing_external_sub_tenant on public.saas_suscripciones_externas(barberia_id, proveedor_codigo);
create index if not exists idx_billing_attempts_tenant on public.saas_billing_checkout_attempts(barberia_id, created_at desc);
create index if not exists idx_billing_payments_tenant on public.saas_billing_payments(barberia_id, created_at desc);
create index if not exists idx_billing_invoices_tenant on public.saas_billing_invoices(barberia_id, issued_at desc);
create index if not exists idx_billing_webhooks_state on public.saas_billing_webhook_events(estado, received_at);
create index if not exists idx_billing_history_subscription on public.saas_billing_state_history(suscripcion_id, created_at desc);
create index if not exists idx_billing_events_pending on public.saas_billing_events(estado, occurred_at);

create or replace function public.billing_can_view(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_platform_member()
    or public.is_barberia_role(p_barberia_id, array['owner']);
$$;

create or replace function public.billing_is_platform_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.platform_members
    where user_id = auth.uid() and role in ('owner','admin')
  );
$$;

create or replace function public.get_billing_catalog()
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'codigo', p.codigo,
      'nombre', p.nombre,
      'descripcion', p.descripcion,
      'precio_mensual', p.precio_mensual,
      'moneda', p.moneda,
      'trial_dias', p.trial_dias,
      'limites', p.limites,
      'funcionalidades', p.funcionalidades,
      'periodicidad', p.periodicidad,
      'orden', p.orden
    ) order by p.orden, p.precio_mensual
  ), '[]'::jsonb)
  from public.saas_planes p
  where p.activo;
$$;

create or replace function public.get_billing_portal(p_barberia_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_sub public.saas_suscripciones%rowtype;
  v_plan public.saas_planes%rowtype;
  v_barberia public.barberias%rowtype;
begin
  if not public.billing_can_view(p_barberia_id) then
    raise exception 'No autorizado para consultar facturación.' using errcode = '42501';
  end if;

  select * into v_barberia from public.barberias where id = p_barberia_id;
  select * into v_sub from public.saas_suscripciones where barberia_id = p_barberia_id;
  if v_sub.id is null then
    raise exception 'La cuenta no tiene una suscripción.' using errcode = 'P0002';
  end if;
  select * into v_plan from public.saas_planes where codigo = v_sub.plan_codigo;

  return jsonb_build_object(
    'tenant', jsonb_build_object('id', v_barberia.id, 'nombre', v_barberia.nombre, 'estado_cuenta', v_barberia.estado_cuenta, 'moneda', v_barberia.moneda, 'billing_email', v_barberia.billing_email),
    'subscription', to_jsonb(v_sub) || jsonb_build_object('plan', to_jsonb(v_plan)),
    'access_state', public.barberia_access_state(p_barberia_id),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('codigo', pp.codigo, 'nombre', pp.nombre, 'entorno', pp.entorno, 'activo', pp.activo)) from public.saas_proveedores_pago pp where pp.codigo in ('mercadopago','paypal')), '[]'::jsonb),
    'external_subscriptions', coalesce((select jsonb_agg(to_jsonb(es) - 'metadata') from public.saas_suscripciones_externas es where es.barberia_id = p_barberia_id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('id', pay.id, 'provider', pay.proveedor_codigo, 'status', pay.estado, 'amount', pay.amount, 'currency', pay.currency, 'paid_at', pay.paid_at) order by pay.created_at desc) from public.saas_billing_payments pay where pay.barberia_id = p_barberia_id limit 20), '[]'::jsonb),
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', inv.id, 'provider', inv.proveedor_codigo, 'status', inv.estado, 'amount', inv.amount, 'currency', inv.currency, 'invoice_url', inv.invoice_url, 'issued_at', inv.issued_at) order by inv.issued_at desc nulls last) from public.saas_billing_invoices inv where inv.barberia_id = p_barberia_id limit 20), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('from_state', h.from_state, 'to_state', h.to_state, 'reason', h.reason, 'source', h.source, 'created_at', h.created_at) order by h.created_at desc) from public.saas_billing_state_history h where h.barberia_id = p_barberia_id limit 20), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_billing_checkout_intent(
  p_barberia_id bigint,
  p_plan_codigo text,
  p_proveedor_codigo text,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_plan public.saas_planes%rowtype;
  v_sub public.saas_suscripciones%rowtype;
  v_provider public.saas_proveedores_pago%rowtype;
  v_attempt public.saas_billing_checkout_attempts%rowtype;
  v_key text := left(btrim(coalesce(p_idempotency_key, '')), 120);
begin
  if not public.billing_can_view(p_barberia_id) then
    raise exception 'No autorizado para iniciar facturación.' using errcode = '42501';
  end if;
  if v_key !~ '^[A-Za-z0-9._:-]{8,120}$' then
    raise exception 'Clave de idempotencia inválida.' using errcode = '22023';
  end if;

  select * into v_plan from public.saas_planes where codigo = lower(btrim(p_plan_codigo)) and activo;
  if v_plan.codigo is null then raise exception 'Plan no disponible.' using errcode = '22023'; end if;
  select * into v_provider from public.saas_proveedores_pago where codigo = lower(btrim(p_proveedor_codigo));
  if v_provider.codigo is null then raise exception 'Proveedor no soportado.' using errcode = '22023'; end if;
  select * into v_sub from public.saas_suscripciones where barberia_id = p_barberia_id;

  select * into v_attempt from public.saas_billing_checkout_attempts
  where barberia_id = p_barberia_id and idempotency_key = v_key;
  if v_attempt.id is not null then
    return jsonb_build_object('checkout_attempt_id', v_attempt.id, 'status', v_attempt.estado, 'provider', v_attempt.proveedor_codigo, 'amount', v_attempt.amount, 'currency', v_attempt.currency, 'checkout_url', v_attempt.checkout_url, 'idempotent', true);
  end if;

  insert into public.saas_billing_checkout_attempts (barberia_id, suscripcion_id, plan_codigo, proveedor_codigo, idempotency_key, estado, amount, currency, expires_at, metadata)
  values (p_barberia_id, v_sub.id, v_plan.codigo, v_provider.codigo,
    v_key,
    case when v_provider.activo then 'pending_provider' else 'created' end,
    v_plan.precio_mensual, v_plan.moneda, now() + interval '30 minutes',
    jsonb_build_object('environment', v_provider.entorno, 'provider_configured', v_provider.activo));
  select * into v_attempt from public.saas_billing_checkout_attempts where barberia_id = p_barberia_id and idempotency_key = v_key;

  return jsonb_build_object('checkout_attempt_id', v_attempt.id, 'status', v_attempt.estado, 'provider', v_attempt.proveedor_codigo, 'amount', v_attempt.amount, 'currency', v_attempt.currency, 'checkout_url', v_attempt.checkout_url, 'idempotent', false, 'message', case when v_provider.activo then 'El backend sandbox debe crear el checkout.' else 'El proveedor todavía no está configurado.' end);
end;
$$;

create or replace function public.transition_saas_subscription(
  p_subscription_id bigint,
  p_to_state text,
  p_reason text default null,
  p_source text default 'system',
  p_provider_event_id text default null,
  p_provider_event_at timestamptz default null,
  p_expected_version integer default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_sub public.saas_suscripciones%rowtype;
  v_from text;
  v_to text := lower(btrim(coalesce(p_to_state, '')));
  v_source text := lower(btrim(coalesce(p_source, 'system')));
  v_access text;
  v_new_version integer;
  v_idempotent boolean := false;
  v_service boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  select * into v_sub from public.saas_suscripciones where id = p_subscription_id for update;
  if v_sub.id is null then raise exception 'Suscripción inexistente.' using errcode = 'P0002'; end if;
  if not v_service and not public.billing_can_view(v_sub.barberia_id) then
    raise exception 'No autorizado para cambiar la suscripción.' using errcode = '42501';
  end if;
  if v_to not in ('trialing','active','past_due','grace_period','suspended','canceled','incomplete','payment_review','refunded','paused','expired') then
    raise exception 'Estado de suscripción inválido.' using errcode = '22023';
  end if;
  if v_source not in ('trial','provider','admin','system','reconciliation') then
    raise exception 'Origen de transición inválido.' using errcode = '22023';
  end if;
  if p_expected_version is not null and p_expected_version <> v_sub.state_version then
    raise exception 'Versión de suscripción desactualizada.' using errcode = '40001';
  end if;
  if p_provider_event_id is not null and v_sub.last_provider_event_id = p_provider_event_id then
    v_idempotent := true;
    v_access := public.barberia_access_state(v_sub.barberia_id);
    return jsonb_build_object('subscription_id', v_sub.id, 'state', v_sub.estado, 'state_version', v_sub.state_version, 'access_state', v_access, 'idempotent', true);
  end if;
  if p_provider_event_at is not null and v_sub.last_provider_event_at is not null and p_provider_event_at < v_sub.last_provider_event_at then
    raise exception 'Evento de proveedor más antiguo que el último aplicado.' using errcode = '40001';
  end if;

  v_from := v_sub.estado;
  if v_from <> v_to and not (
    (v_from = 'trialing' and v_to in ('active','past_due','grace_period','canceled','incomplete')) or
    (v_from = 'incomplete' and v_to in ('trialing','active','past_due','canceled')) or
    (v_from = 'active' and v_to in ('past_due','grace_period','canceled','suspended','refunded')) or
    (v_from = 'past_due' and v_to in ('active','grace_period','suspended','canceled','payment_review')) or
    (v_from = 'payment_review' and v_to in ('active','past_due','grace_period','suspended','canceled')) or
    (v_from = 'grace_period' and v_to in ('active','suspended','canceled')) or
    (v_from = 'suspended' and v_to in ('active','canceled')) or
    (v_from = 'canceled' and v_to = 'active') or
    (v_from = 'paused' and v_to in ('active','canceled')) or
    (v_from = 'expired' and v_to in ('active','canceled'))
  ) then
    raise exception 'Transición no permitida: % -> %.', v_from, v_to using errcode = '22023';
  end if;

  v_new_version := case when v_from = v_to then v_sub.state_version else v_sub.state_version + 1 end;
  update public.saas_suscripciones
  set estado = v_to,
      status_reason = left(nullif(btrim(p_reason), ''), 240),
      last_provider_event_id = coalesce(nullif(btrim(p_provider_event_id), ''), last_provider_event_id),
      last_provider_event_at = coalesce(p_provider_event_at, last_provider_event_at),
      state_version = v_new_version,
      state_changed_at = case when v_from = v_to then state_changed_at else now() end,
      grace_ends_at = case when v_to = 'grace_period' and grace_ends_at is null then now() + interval '7 days' when v_to <> 'grace_period' then null else grace_ends_at end,
      updated_at = now()
  where id = v_sub.id;

  if v_from <> v_to then
    insert into public.saas_billing_state_history (barberia_id, suscripcion_id, from_state, to_state, reason, source, provider_event_id, state_version, created_by)
    values (v_sub.barberia_id, v_sub.id, v_from, v_to, left(nullif(btrim(p_reason), ''), 240), v_source, p_provider_event_id, v_new_version, auth.uid());
    insert into public.saas_billing_events (event_name, barberia_id, suscripcion_id, dedupe_key, payload)
    values ('subscription.state_changed', v_sub.barberia_id, v_sub.id, 'subscription:' || v_sub.id || ':state:' || v_new_version,
      jsonb_build_object('from_state', v_from, 'to_state', v_to, 'source', v_source, 'state_version', v_new_version));
  end if;

  update public.barberias
  set estado_cuenta = case
    when v_to = 'active' then 'active'
    when v_to = 'trialing' then 'trial'
    when v_to in ('past_due','grace_period','incomplete','payment_review','paused') then 'past_due'
    when v_to = 'suspended' then 'suspended'
    when v_to in ('canceled','refunded','expired') then 'canceled'
    else estado_cuenta
  end
  where id = v_sub.barberia_id;

  v_access := public.barberia_access_state(v_sub.barberia_id);
  return jsonb_build_object('subscription_id', v_sub.id, 'state', v_to, 'state_version', v_new_version, 'access_state', v_access, 'idempotent', v_idempotent);
end;
$$;

create or replace function public.expire_saas_trials(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_count integer := 0;
  v_service boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
  v_sub record;
begin
  if not v_service and not public.billing_is_platform_admin() then
    raise exception 'No autorizado para vencer trials.' using errcode = '42501';
  end if;
  for v_sub in
    select id from public.saas_suscripciones
    where estado = 'trialing' and trial_ends_at is not null and trial_ends_at < now()
    order by trial_ends_at limit greatest(1, least(coalesce(p_limit, 100), 1000))
  loop
    perform public.transition_saas_subscription(v_sub.id, 'past_due', 'trial_expired', 'trial');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.record_billing_webhook_event(
  p_proveedor_codigo text,
  p_external_event_id text,
  p_event_type text,
  p_barberia_id bigint default null,
  p_suscripcion_id bigint default null,
  p_signature_valid boolean default false,
  p_payload_min jsonb default '{}'::jsonb,
  p_external_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_service boolean := current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  if not v_service and not public.billing_is_platform_admin() then
    raise exception 'Sólo el backend o plataforma puede registrar webhooks.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_proveedor_codigo,''))) not in ('mercadopago','paypal') then raise exception 'Proveedor no soportado.' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_external_event_id,''))) not between 1 and 200 then raise exception 'ID de evento inválido.' using errcode = '22023'; end if;
  insert into public.saas_billing_webhook_events (proveedor_codigo, external_event_id, event_type, barberia_id, suscripcion_id, signature_valid, payload_min, external_updated_at)
  values (lower(btrim(p_proveedor_codigo)), left(btrim(p_external_event_id),200), left(btrim(coalesce(p_event_type,'unknown')),120), p_barberia_id, p_suscripcion_id, p_signature_valid, coalesce(p_payload_min,'{}'::jsonb), p_external_updated_at)
  on conflict (proveedor_codigo, external_event_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.saas_billing_webhook_events where proveedor_codigo = lower(btrim(p_proveedor_codigo)) and external_event_id = left(btrim(p_external_event_id),200);
    return jsonb_build_object('webhook_event_id', v_id, 'idempotent', true);
  end if;
  return jsonb_build_object('webhook_event_id', v_id, 'idempotent', false);
end;
$$;

create or replace function public.get_platform_billing_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.billing_is_platform_admin() then
    raise exception 'Sólo owner/admin de plataforma puede consultar billing global.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'subscriptions_by_state', coalesce((select jsonb_object_agg(estado, total) from (select estado, count(*) total from public.saas_suscripciones group by estado) s), '{}'::jsonb),
    'tenants', coalesce((select jsonb_agg(jsonb_build_object('barberia_id', b.id, 'nombre', b.nombre, 'plan_codigo', s.plan_codigo, 'estado', s.estado, 'access_state', public.barberia_access_state(b.id), 'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end) order by b.nombre) from public.barberias b join public.saas_suscripciones s on s.barberia_id = b.id), '[]'::jsonb),
    'pending_webhooks', (select count(*) from public.saas_billing_webhook_events where estado in ('received','processing','failed')),
    'pending_events', (select count(*) from public.saas_billing_events where estado = 'pending')
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.barberia_access_state(p_barberia_id bigint)
returns text language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when b.estado_cuenta = 'suspended' then 'suspended'
    when s.estado = 'active' then 'active'
    when s.estado = 'trialing' and coalesce(s.trial_ends_at, now()) >= now() then 'trialing'
    when s.estado = 'grace_period' and coalesce(s.grace_ends_at, now()) >= now() then 'grace_period'
    when s.estado = 'past_due' then 'past_due'
    when s.estado = 'grace_period' then 'suspended'
    when s.estado in ('suspended','canceled','refunded','expired') then s.estado
    when s.estado in ('incomplete','payment_review','paused') then 'past_due'
    else coalesce(b.estado_cuenta, 'trial')
  end
  from public.barberias b
  left join public.saas_suscripciones s on s.barberia_id = b.id
  where b.id = p_barberia_id;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_saas_proveedores_pago_updated_at') then
    create trigger trg_saas_proveedores_pago_updated_at before update on public.saas_proveedores_pago for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_saas_plan_proveedores_updated_at') then
    create trigger trg_saas_plan_proveedores_updated_at before update on public.saas_plan_proveedores for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_saas_billing_customers_updated_at') then
    create trigger trg_saas_billing_customers_updated_at before update on public.saas_billing_customers for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_saas_suscripciones_externas_updated_at') then
    create trigger trg_saas_suscripciones_externas_updated_at before update on public.saas_suscripciones_externas for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_saas_billing_attempts_updated_at') then
    create trigger trg_saas_billing_attempts_updated_at before update on public.saas_billing_checkout_attempts for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_saas_billing_payments_updated_at') then
    create trigger trg_saas_billing_payments_updated_at before update on public.saas_billing_payments for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_saas_billing_invoices_updated_at') then
    create trigger trg_saas_billing_invoices_updated_at before update on public.saas_billing_invoices for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_saas_billing_refunds_updated_at') then
    create trigger trg_saas_billing_refunds_updated_at before update on public.saas_billing_refunds for each row execute function public.set_updated_at();
  end if;
end
$$;

alter table public.saas_proveedores_pago enable row level security;
alter table public.saas_plan_proveedores enable row level security;
alter table public.saas_billing_customers enable row level security;
alter table public.saas_suscripciones_externas enable row level security;
alter table public.saas_billing_checkout_attempts enable row level security;
alter table public.saas_billing_payments enable row level security;
alter table public.saas_billing_invoices enable row level security;
alter table public.saas_billing_refunds enable row level security;
alter table public.saas_billing_webhook_events enable row level security;
alter table public.saas_billing_state_history enable row level security;
alter table public.saas_billing_events enable row level security;

drop policy if exists billing_providers_select on public.saas_proveedores_pago;
create policy billing_providers_select on public.saas_proveedores_pago for select to authenticated using (public.is_platform_member() or exists (select 1 from public.barberia_members bm where bm.user_id = auth.uid()));
drop policy if exists billing_plan_providers_select on public.saas_plan_proveedores;
create policy billing_plan_providers_select on public.saas_plan_proveedores for select to authenticated using (public.is_platform_member() or exists (select 1 from public.barberia_members bm where bm.user_id = auth.uid()));

drop policy if exists billing_customers_select on public.saas_billing_customers;
create policy billing_customers_select on public.saas_billing_customers for select to authenticated using (public.billing_can_view(barberia_id));
drop policy if exists billing_external_subscriptions_select on public.saas_suscripciones_externas;
create policy billing_external_subscriptions_select on public.saas_suscripciones_externas for select to authenticated using (public.billing_can_view(barberia_id));
drop policy if exists billing_attempts_select on public.saas_billing_checkout_attempts;
create policy billing_attempts_select on public.saas_billing_checkout_attempts for select to authenticated using (public.billing_can_view(barberia_id));
drop policy if exists billing_payments_select on public.saas_billing_payments;
create policy billing_payments_select on public.saas_billing_payments for select to authenticated using (public.billing_can_view(barberia_id));
drop policy if exists billing_invoices_select on public.saas_billing_invoices;
create policy billing_invoices_select on public.saas_billing_invoices for select to authenticated using (public.billing_can_view(barberia_id));
drop policy if exists billing_refunds_select on public.saas_billing_refunds;
create policy billing_refunds_select on public.saas_billing_refunds for select to authenticated using (public.billing_can_view(barberia_id));
drop policy if exists billing_webhooks_platform on public.saas_billing_webhook_events;
create policy billing_webhooks_platform on public.saas_billing_webhook_events for select to authenticated using (public.billing_is_platform_admin());
drop policy if exists billing_history_select on public.saas_billing_state_history;
create policy billing_history_select on public.saas_billing_state_history for select to authenticated using (public.billing_can_view(barberia_id));
drop policy if exists billing_events_platform on public.saas_billing_events;
create policy billing_events_platform on public.saas_billing_events for select to authenticated using (public.billing_is_platform_admin());

revoke all on public.saas_proveedores_pago, public.saas_plan_proveedores, public.saas_billing_customers, public.saas_suscripciones_externas, public.saas_billing_checkout_attempts, public.saas_billing_payments, public.saas_billing_invoices, public.saas_billing_refunds, public.saas_billing_webhook_events, public.saas_billing_state_history, public.saas_billing_events from anon;
grant select on public.saas_proveedores_pago, public.saas_plan_proveedores, public.saas_billing_customers, public.saas_suscripciones_externas, public.saas_billing_checkout_attempts, public.saas_billing_payments, public.saas_billing_invoices, public.saas_billing_refunds, public.saas_billing_webhook_events, public.saas_billing_state_history, public.saas_billing_events to authenticated;

revoke all on function public.billing_can_view(bigint), public.billing_is_platform_admin(), public.get_billing_catalog(), public.get_billing_portal(bigint), public.create_billing_checkout_intent(bigint,text,text,text), public.transition_saas_subscription(bigint,text,text,text,text,timestamptz,integer), public.expire_saas_trials(integer), public.record_billing_webhook_event(text,text,text,bigint,bigint,boolean,jsonb,timestamptz), public.get_platform_billing_overview() from public, anon;
grant execute on function public.billing_can_view(bigint), public.billing_is_platform_admin(), public.get_billing_catalog(), public.get_billing_portal(bigint), public.create_billing_checkout_intent(bigint,text,text,text), public.transition_saas_subscription(bigint,text,text,text,text,timestamptz,integer), public.expire_saas_trials(integer), public.record_billing_webhook_event(text,text,text,bigint,bigint,boolean,jsonb,timestamptz), public.get_platform_billing_overview() to authenticated, service_role;

commit;
