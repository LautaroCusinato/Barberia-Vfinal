-- Tenant técnico aislado para validar Mercado Pago Sandbox.
-- No agrega membresías ni modifica tenants de clientes. Es idempotente.
begin;

insert into public.barberias as b (
  nombre, slug, vertical, estado_cuenta, plan_codigo, trial_ends_at, locale,
  billing_email, onboarding_completed, metadata, pais, moneda, reservas_publicas
)
values (
  'Mercado Pago Sandbox Técnico',
  'austral-mp-sandbox',
  'saas',
  'trial',
  'starter',
  now() + interval '14 days',
  'es-AR',
  'australautomatizaciones@gmail.com',
  true,
  jsonb_build_object(
    'environment', 'sandbox',
    'technical', true,
    'purpose', 'mercadopago_checkout_validation',
    'billing_provider', 'mercadopago',
    'billing_enabled', true,
    'billing_plan', 'starter'
  ),
  'Argentina',
  'USD',
  false
)
on conflict (slug) do update
set metadata = coalesce(b.metadata, '{}'::jsonb) || jsonb_build_object(
  'environment', 'sandbox',
  'technical', true,
  'purpose', 'mercadopago_checkout_validation',
  'billing_provider', 'mercadopago',
  'billing_enabled', true,
  'billing_plan', 'starter'
),
    onboarding_completed = true;

insert into public.saas_suscripciones as s (
  barberia_id, plan_codigo, estado, trial_started_at, trial_ends_at,
  precio, moneda, periodicidad, metadata
)
select
  b.id,
  p.codigo,
  'trialing',
  now(),
  now() + interval '14 days',
  p.precio_mensual,
  p.moneda,
  p.periodicidad,
  jsonb_build_object('environment', 'sandbox', 'technical', true, 'source', 'mercadopago_sandbox_setup')
from public.barberias b
join public.saas_planes p on p.codigo = 'starter'
where b.slug = 'austral-mp-sandbox'
on conflict (barberia_id) do update
set plan_codigo = excluded.plan_codigo,
    estado = case when s.provider is null then 'trialing' else s.estado end,
    precio = excluded.precio,
    moneda = excluded.moneda,
    periodicidad = excluded.periodicidad,
    metadata = coalesce(s.metadata, '{}'::jsonb) || excluded.metadata;

insert into public.crm_negocios as n (
  barberia_id, nombre, rubro, pais, idioma, zona_horaria, email,
  canal_origen, etapa, pipeline_stage, environment, metadata
)
select
  b.id,
  b.nombre,
  'saas',
  b.pais,
  'es',
  b.zona_horaria,
  b.billing_email,
  'mercadopago_sandbox',
  'prueba',
  'trial',
  'sandbox',
  jsonb_build_object('environment', 'sandbox', 'technical', true, 'source', 'mercadopago_sandbox_setup')
from public.barberias b
where b.slug = 'austral-mp-sandbox'
on conflict (barberia_id) where barberia_id is not null do update
set environment = 'sandbox',
    etapa = 'prueba',
    pipeline_stage = 'trial',
    metadata = coalesce(n.metadata, '{}'::jsonb) || excluded.metadata;

commit;
