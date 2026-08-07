-- Billing siempre resuelve el precio externo en backend. Los precios base
-- internacionales de saas_planes permanecen intactos.
begin;

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
      'orden', p.orden,
      'precios_externos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', ep.id,
          'proveedor_codigo', ep.proveedor_codigo,
          'pais_codigo', ep.pais_codigo,
          'moneda', ep.moneda,
          'importe', ep.importe,
          'periodicidad', ep.periodicidad,
          'entorno', ep.entorno,
          'habilitado', ep.habilitado
        ) order by ep.proveedor_codigo, ep.pais_codigo, ep.moneda)
        from public.saas_plan_precios ep
        where ep.plan_codigo = p.codigo and ep.activo
      ), '[]'::jsonb)
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
  v_full boolean := public.billing_can_view(p_barberia_id);
begin
  if not public.billing_can_view_commercial(p_barberia_id) then
    raise exception 'No autorizado para consultar facturación.' using errcode = '42501';
  end if;

  select * into v_barberia from public.barberias where id = p_barberia_id;
  select * into v_sub from public.saas_suscripciones where barberia_id = p_barberia_id;
  if v_sub.id is null then
    raise exception 'La cuenta no tiene una suscripción.' using errcode = 'P0002';
  end if;
  select * into v_plan from public.saas_planes where codigo = v_sub.plan_codigo;

  return jsonb_build_object(
    'tenant', case when v_full
      then jsonb_build_object('id', v_barberia.id, 'nombre', v_barberia.nombre, 'estado_cuenta', v_barberia.estado_cuenta, 'pais', v_barberia.pais, 'moneda', v_barberia.moneda, 'billing_email', v_barberia.billing_email)
      else jsonb_build_object('id', v_barberia.id, 'nombre', v_barberia.nombre, 'estado_cuenta', v_barberia.estado_cuenta, 'pais', v_barberia.pais, 'moneda', v_barberia.moneda)
    end,
    'subscription', case when v_full
      then to_jsonb(v_sub) || jsonb_build_object('plan', to_jsonb(v_plan))
      else jsonb_build_object(
        'id', v_sub.id,
        'plan_codigo', v_sub.plan_codigo,
        'estado', v_sub.estado,
        'precio', v_sub.precio,
        'moneda', v_sub.moneda,
        'periodicidad', v_sub.periodicidad,
        'trial_ends_at', v_sub.trial_ends_at,
        'current_period_end', v_sub.current_period_end,
        'state_changed_at', v_sub.state_changed_at,
        'plan', jsonb_build_object('codigo', v_plan.codigo, 'nombre', v_plan.nombre, 'descripcion', v_plan.descripcion, 'precio_mensual', v_plan.precio_mensual, 'moneda', v_plan.moneda, 'trial_dias', v_plan.trial_dias, 'funcionalidades', v_plan.funcionalidades, 'periodicidad', v_plan.periodicidad)
      )
    end,
    'access_state', public.barberia_access_state(p_barberia_id),
    'providers', coalesce((select jsonb_agg(jsonb_build_object('codigo', pp.codigo, 'nombre', pp.nombre, 'entorno', pp.entorno, 'activo', pp.activo)) from public.saas_proveedores_pago pp where pp.codigo in ('mercadopago','paypal')), '[]'::jsonb),
    'external_subscriptions', case when v_full then coalesce((select jsonb_agg(to_jsonb(es) - 'metadata') from public.saas_suscripciones_externas es where es.barberia_id = p_barberia_id), '[]'::jsonb) else '[]'::jsonb end,
    'payments', case when v_full then coalesce((select jsonb_agg(jsonb_build_object('id', pay.id, 'provider', pay.proveedor_codigo, 'status', pay.estado, 'amount', pay.amount, 'currency', pay.currency, 'paid_at', pay.paid_at) order by pay.created_at desc) from public.saas_billing_payments pay where pay.barberia_id = p_barberia_id limit 20), '[]'::jsonb) else '[]'::jsonb end,
    'invoices', case when v_full then coalesce((select jsonb_agg(jsonb_build_object('id', inv.id, 'provider', inv.proveedor_codigo, 'status', inv.estado, 'amount', inv.amount, 'currency', inv.currency, 'invoice_url', inv.invoice_url, 'issued_at', inv.issued_at) order by inv.issued_at desc nulls last) from public.saas_billing_invoices inv where inv.barberia_id = p_barberia_id limit 20), '[]'::jsonb) else '[]'::jsonb end,
    'history', case when v_full then coalesce((select jsonb_agg(jsonb_build_object('from_state', h.from_state, 'to_state', h.to_state, 'reason', h.reason, 'source', h.source, 'created_at', h.created_at) order by h.created_at desc) from public.saas_billing_state_history h where h.barberia_id = p_barberia_id limit 20), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

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
  v_price public.saas_plan_precios%rowtype;
  v_attempt public.saas_billing_checkout_attempts%rowtype;
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

  select * into v_attempt from public.saas_billing_checkout_attempts where barberia_id = p_barberia_id and idempotency_key = v_key;
  if v_attempt.id is not null then
    return jsonb_build_object('checkout_attempt_id', v_attempt.id, 'status', v_attempt.estado, 'provider', v_attempt.proveedor_codigo, 'amount', v_attempt.amount, 'currency', v_attempt.currency, 'checkout_url', v_attempt.checkout_url, 'price_id', (v_attempt.metadata ->> 'price_id')::bigint, 'idempotent', true);
  end if;

  select * into v_plan from public.saas_planes where codigo = lower(btrim(p_plan_codigo)) and activo;
  if v_plan.codigo is null then raise exception 'Plan no disponible.' using errcode = '22023'; end if;
  select * into v_provider from public.saas_proveedores_pago where codigo = lower(btrim(p_proveedor_codigo));
  if v_provider.codigo is null then raise exception 'Proveedor no soportado.' using errcode = '22023'; end if;
  select * into v_price from public.saas_plan_precios
    where id = p_precio_id and plan_codigo = v_plan.codigo and proveedor_codigo = v_provider.codigo
      and entorno = v_provider.entorno and activo;
  if v_price.id is null then raise exception 'Precio externo no disponible para el proveedor.' using errcode = '22023'; end if;
  select * into v_sub from public.saas_suscripciones where barberia_id = p_barberia_id;
  if v_sub.id is null then raise exception 'La cuenta no tiene una suscripción.' using errcode = 'P0002'; end if;

  insert into public.saas_billing_checkout_attempts (barberia_id, suscripcion_id, plan_codigo, proveedor_codigo, idempotency_key, estado, amount, currency, expires_at, metadata)
  values (p_barberia_id, v_sub.id, v_plan.codigo, v_provider.codigo, v_key,
    case when v_provider.activo then 'pending_provider' else 'created' end,
    v_price.importe, v_price.moneda, now() + interval '30 minutes',
    jsonb_build_object('environment', v_provider.entorno, 'provider_configured', v_provider.activo, 'price_id', v_price.id, 'pais_codigo', v_price.pais_codigo, 'periodicidad', v_price.periodicidad));
  select * into v_attempt from public.saas_billing_checkout_attempts where barberia_id = p_barberia_id and idempotency_key = v_key;

  return jsonb_build_object('checkout_attempt_id', v_attempt.id, 'status', v_attempt.estado, 'provider', v_attempt.proveedor_codigo, 'amount', v_attempt.amount, 'currency', v_attempt.currency, 'checkout_url', v_attempt.checkout_url, 'price_id', v_price.id, 'idempotent', false, 'message', case when v_provider.activo then 'El backend crea el checkout.' else 'El proveedor todavía no está configurado.' end);
end;
$$;

revoke all on function public.create_billing_checkout_intent_with_price(bigint,text,text,bigint,text) from public, anon;
grant execute on function public.create_billing_checkout_intent_with_price(bigint,text,text,bigint,text) to authenticated, service_role;

commit;
