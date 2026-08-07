-- Auditoría dedicada para las cuatro acciones del control técnico de
-- Mercado Pago sandbox. El tenant, plan, proveedor y entorno son fijos por
-- diseño y no pueden ser reemplazados por el cliente.
create or replace function public.record_billing_sandbox_audit(
  p_action text,
  p_status text,
  p_metadata jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if not exists (
    select 1 from public.platform_members
    where user_id = auth.uid() and role in ('owner', 'admin')
  ) then
    raise exception 'Sólo owner/admin de plataforma puede auditar billing sandbox.' using errcode = '42501';
  end if;
  if v_action not in ('config-status', 'sync-plans', 'checkout', 'external-status') then
    raise exception 'Acción de billing sandbox inválida.' using errcode = '22023';
  end if;
  if v_status not in ('succeeded', 'failed') then
    raise exception 'Estado de auditoría inválido.' using errcode = '22023';
  end if;

  insert into public.saas_audit_log (event_key, event_name, user_id, barberia_id, metadata)
  values (
    'billing_sandbox:' || auth.uid()::text || ':' || extract(epoch from clock_timestamp())::bigint || ':' || replace(gen_random_uuid()::text, '-', ''),
    'billing_sandbox_' || replace(v_action, '-', '_'),
    auth.uid(),
    6,
    jsonb_build_object(
      'tenant_id', 6,
      'plan_codigo', 'starter',
      'proveedor_codigo', 'mercadopago',
      'environment', 'sandbox',
      'action', v_action,
      'status', v_status,
      'error_code', case when v_metadata ? 'error_code' then left(v_metadata->>'error_code', 80) end,
      'result', case when v_metadata ? 'result' then left(v_metadata->>'result', 80) end,
      'checkout_attempt_id', case when (v_metadata->>'checkout_attempt_id') ~ '^[0-9]+$' then (v_metadata->>'checkout_attempt_id')::bigint end,
      'has_checkout_url', case when v_metadata->>'has_checkout_url' in ('true', 'false') then (v_metadata->>'has_checkout_url')::boolean else null end,
      'token_kind', case when v_metadata ? 'token_kind' then left(v_metadata->>'token_kind', 20) end,
      'sandbox_token_valid', case when v_metadata->>'sandbox_token_valid' in ('true', 'false') then (v_metadata->>'sandbox_token_valid')::boolean else null end,
      'production_enabled', case when v_metadata->>'production_enabled' in ('true', 'false') then (v_metadata->>'production_enabled')::boolean else null end
    )
  ) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.record_billing_sandbox_audit(text, text, jsonb) from public, anon;
grant execute on function public.record_billing_sandbox_audit(text, text, jsonb) to authenticated, service_role;
