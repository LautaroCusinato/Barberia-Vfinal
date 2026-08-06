-- El lock se toma antes de leer el intento existente. Así dos reintentos
-- concurrentes con la misma clave devuelven exactamente el mismo registro.
begin;

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
  perform pg_advisory_xact_lock(hashtextextended(p_barberia_id::text || ':' || v_key, 0));

  select * into v_attempt from public.saas_billing_checkout_attempts where barberia_id = p_barberia_id and idempotency_key = v_key;
  if v_attempt.id is not null then
    return jsonb_build_object('checkout_attempt_id', v_attempt.id, 'status', v_attempt.estado, 'provider', v_attempt.proveedor_codigo, 'amount', v_attempt.amount, 'currency', v_attempt.currency, 'checkout_url', v_attempt.checkout_url, 'idempotent', true);
  end if;

  select * into v_plan from public.saas_planes where codigo = lower(btrim(p_plan_codigo)) and activo;
  if v_plan.codigo is null then raise exception 'Plan no disponible.' using errcode = '22023'; end if;
  select * into v_provider from public.saas_proveedores_pago where codigo = lower(btrim(p_proveedor_codigo));
  if v_provider.codigo is null then raise exception 'Proveedor no soportado.' using errcode = '22023'; end if;
  select * into v_sub from public.saas_suscripciones where barberia_id = p_barberia_id;

  insert into public.saas_billing_checkout_attempts (barberia_id, suscripcion_id, plan_codigo, proveedor_codigo, idempotency_key, estado, amount, currency, expires_at, metadata)
  values (p_barberia_id, v_sub.id, v_plan.codigo, v_provider.codigo, v_key,
    case when v_provider.activo then 'pending_provider' else 'created' end,
    v_plan.precio_mensual, v_plan.moneda, now() + interval '30 minutes',
    jsonb_build_object('environment', v_provider.entorno, 'provider_configured', v_provider.activo));
  select * into v_attempt from public.saas_billing_checkout_attempts where barberia_id = p_barberia_id and idempotency_key = v_key;

  return jsonb_build_object('checkout_attempt_id', v_attempt.id, 'status', v_attempt.estado, 'provider', v_attempt.proveedor_codigo, 'amount', v_attempt.amount, 'currency', v_attempt.currency, 'checkout_url', v_attempt.checkout_url, 'idempotent', false, 'message', case when v_provider.activo then 'El backend sandbox debe crear el checkout.' else 'El proveedor todavía no está configurado.' end);
end;
$$;

commit;
