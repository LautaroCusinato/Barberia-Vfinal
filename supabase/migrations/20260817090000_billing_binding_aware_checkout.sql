-- Resolve checkout intents from the tenant/provider binding instead of the
-- legacy global provider environment. This keeps sandbox tenant 6 and the
-- production pilot tenant isolated while preserving the existing RPC shape.
begin;

create or replace function public.create_billing_checkout_intent_with_price(
  p_barberia_id bigint,
  p_plan_codigo text,
  p_proveedor_codigo text,
  p_precio_id bigint,
  p_idempotency_key text
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_plan public.saas_planes%rowtype;
  v_sub public.saas_suscripciones%rowtype;
  v_provider public.saas_proveedores_pago%rowtype;
  v_binding public.saas_billing_provider_bindings%rowtype;
  v_price public.saas_plan_precios%rowtype;
  v_attempt public.saas_billing_checkout_attempts%rowtype;
  v_environment text;
  v_binding_count integer := 0;
  v_key text := left(btrim(coalesce(p_idempotency_key, '')), 120);
begin
  if not public.billing_can_checkout_for_tenant(p_barberia_id) then
    raise exception 'No autorizado para iniciar facturación.' using errcode = '42501';
  end if;
  if v_key !~ '^[A-Za-z0-9._:-]{8,120}$' then
    raise exception 'Clave de idempotencia inválida.' using errcode = '22023';
  end if;
  if p_precio_id is null or p_precio_id <= 0 then
    raise exception 'Precio externo inválido.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_barberia_id::text || ':' || v_key, 0));

  select * into v_attempt
    from public.saas_billing_checkout_attempts
   where barberia_id = p_barberia_id and idempotency_key = v_key;
  if v_attempt.id is not null then
    return jsonb_build_object(
      'checkout_attempt_id', v_attempt.id,
      'status', v_attempt.estado,
      'provider', v_attempt.proveedor_codigo,
      'amount', v_attempt.amount,
      'currency', v_attempt.currency,
      'checkout_url', v_attempt.checkout_url,
      'price_id', (v_attempt.metadata ->> 'price_id')::bigint,
      'idempotent', true
    );
  end if;

  select * into v_plan from public.saas_planes
   where codigo = lower(btrim(p_plan_codigo)) and activo;
  if v_plan.codigo is null then
    raise exception 'Plan no disponible.' using errcode = '22023';
  end if;

  select * into v_provider from public.saas_proveedores_pago
   where codigo = lower(btrim(p_proveedor_codigo));
  if v_provider.codigo is null then
    raise exception 'Proveedor no soportado.' using errcode = '22023';
  end if;

  select count(*) into v_binding_count
    from public.saas_billing_provider_bindings
   where barberia_id = p_barberia_id
     and proveedor_codigo = v_provider.codigo
     and activo;
  if v_binding_count > 1 then
    raise exception 'El tenant tiene más de un entorno de billing activo.' using errcode = '22023';
  end if;
  select * into v_binding
    from public.saas_billing_provider_bindings
   where barberia_id = p_barberia_id
     and proveedor_codigo = v_provider.codigo
     and activo
   limit 1;
  if v_binding.id is not null then
    v_environment := v_binding.entorno;
  else
    v_environment := v_provider.entorno;
  end if;

  select * into v_price from public.saas_plan_precios
   where id = p_precio_id
     and plan_codigo = v_plan.codigo
     and proveedor_codigo = v_provider.codigo
     and entorno = v_environment
     and activo;
  if v_price.id is null then
    raise exception 'Precio externo no disponible para el binding del proveedor.' using errcode = '22023';
  end if;

  select * into v_sub from public.saas_suscripciones
   where barberia_id = p_barberia_id;
  if v_sub.id is null then
    raise exception 'La cuenta no tiene una suscripción.' using errcode = 'P0002';
  end if;

  insert into public.saas_billing_checkout_attempts (
    barberia_id, suscripcion_id, plan_codigo, proveedor_codigo,
    idempotency_key, estado, amount, currency, expires_at, metadata
  ) values (
    p_barberia_id, v_sub.id, v_plan.codigo, v_provider.codigo, v_key,
    case when v_provider.activo then 'pending_provider' else 'created' end,
    v_price.importe, v_price.moneda, now() + interval '30 minutes',
    jsonb_build_object(
      'environment', v_environment,
      'provider_configured', v_provider.activo,
      'price_id', v_price.id,
      'pais_codigo', v_price.pais_codigo,
      'periodicidad', v_price.periodicidad
    )
  );
  select * into v_attempt from public.saas_billing_checkout_attempts
   where barberia_id = p_barberia_id and idempotency_key = v_key;

  return jsonb_build_object(
    'checkout_attempt_id', v_attempt.id,
    'status', v_attempt.estado,
    'provider', v_attempt.proveedor_codigo,
    'environment', v_environment,
    'amount', v_attempt.amount,
    'currency', v_attempt.currency,
    'checkout_url', v_attempt.checkout_url,
    'price_id', v_price.id,
    'idempotent', false,
    'message', case when v_provider.activo then 'El backend crea el checkout.' else 'El proveedor se mantiene globalmente deshabilitado; el binding controla el entorno.' end
  );
end;
$$;

revoke all on function public.create_billing_checkout_intent_with_price(bigint,text,text,bigint,text) from public, anon;
grant execute on function public.create_billing_checkout_intent_with_price(bigint,text,text,bigint,text) to authenticated, service_role;

commit;
