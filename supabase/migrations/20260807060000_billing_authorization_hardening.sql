-- Separa lectura comercial, administración, reconciliación y checkout.
-- No procesa pagos ni llama proveedores externos.
begin;

create or replace function public.billing_can_view(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or public.billing_is_platform_admin()
    or public.is_barberia_role(p_barberia_id, array['owner']);
$$;

create or replace function public.billing_can_view_commercial(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or exists (
      select 1
      from public.platform_members
      where user_id = auth.uid()
        and role in ('owner', 'admin', 'sales', 'support', 'readonly')
    )
    or public.is_barberia_role(p_barberia_id, array['owner']);
$$;

create or replace function public.billing_can_manage(p_barberia_id bigint default null)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or public.billing_is_platform_admin();
$$;

create or replace function public.billing_can_reconcile()
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or public.billing_is_platform_admin();
$$;

create or replace function public.billing_can_checkout_for_tenant(p_barberia_id bigint)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$
  select current_setting('request.jwt.claim.role', true) = 'service_role'
    or public.billing_is_platform_admin()
    or public.is_barberia_role(p_barberia_id, array['owner']);
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
      then jsonb_build_object('id', v_barberia.id, 'nombre', v_barberia.nombre, 'estado_cuenta', v_barberia.estado_cuenta, 'moneda', v_barberia.moneda, 'billing_email', v_barberia.billing_email)
      else jsonb_build_object('id', v_barberia.id, 'nombre', v_barberia.nombre, 'estado_cuenta', v_barberia.estado_cuenta, 'moneda', v_barberia.moneda)
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
  if not public.billing_can_checkout_for_tenant(p_barberia_id) then
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
begin
  select * into v_sub from public.saas_suscripciones where id = p_subscription_id for update;
  if v_sub.id is null then raise exception 'Suscripción inexistente.' using errcode = 'P0002'; end if;
  if not public.billing_can_manage(v_sub.barberia_id) then
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
  v_sub record;
begin
  if not public.billing_can_reconcile() then
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
begin
  if not public.billing_can_reconcile() then
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
  if not public.billing_can_manage() then
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

revoke all on function public.billing_can_view(bigint), public.billing_can_view_commercial(bigint), public.billing_can_manage(bigint), public.billing_can_reconcile(), public.billing_can_checkout_for_tenant(bigint) from public, anon;
grant execute on function public.billing_can_view(bigint), public.billing_can_view_commercial(bigint), public.billing_can_manage(bigint), public.billing_can_reconcile(), public.billing_can_checkout_for_tenant(bigint) to authenticated, service_role;

commit;
