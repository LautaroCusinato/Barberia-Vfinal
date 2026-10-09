-- QA manual 928: el teléfono permitido se valida en la misma transacción
-- que reserva el mensaje. Conserva intacto el contrato general de tarea 38.
-- Requiere 20261005120000_whatsapp_panel_send_atomic.sql.
-- Rollback: scripts/sql/qa-manual-panel/rollback.sql.
begin;

create or replace function public.reservar_envio_panel_qa_manual(
  p_barberia_id bigint,
  p_cliente_id bigint,
  p_client_message_id uuid,
  p_texto text,
  p_allowed_phones text[],
  p_hora text default null,
  p_confirm_resend boolean default false,
  p_rate_limit integer default 20,
  p_rate_window_seconds integer default 60,
  p_duplicate_window_seconds integer default 300,
  p_stale_pending_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_phone text;
begin
  if p_barberia_id is distinct from 928 or not exists (
    select 1 from public.barberias b where b.id = p_barberia_id
      and b.slug = 'austral-prueba-lautaro'
      and b.metadata->>'environment' = 'qa'
      and b.metadata->>'whatsapp_manual_testing_authorized' = 'true'
  ) then
    return jsonb_build_object('status', 'qa_manual_not_authorized');
  end if;
  if p_allowed_phones is null or cardinality(p_allowed_phones) not between 1 and 2
    or exists (select 1 from unnest(p_allowed_phones) p where p is null or p !~ '^549[1-9][0-9]{9}$') then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;

  -- Mismo orden de lock que la reserva original. FOR UPDATE impide que otra
  -- edición cambie el teléfono entre esta validación y la relectura de la RPC.
  perform pg_advisory_xact_lock(hashtextextended('austral_panel_send:' || p_barberia_id::text, 0));
  select public.telefono_whatsapp_canonico(c.telefono) into v_phone
    from public.clientes c
    where c.id = p_cliente_id and c.barberia_id = p_barberia_id
    for update;
  if not found then return jsonb_build_object('status', 'customer_not_found'); end if;
  if v_phone is null then return jsonb_build_object('status', 'customer_phone_invalid'); end if;
  if not (v_phone = any(p_allowed_phones)) then
    -- Sin INSERT ni pausa: conserva también un intento anterior incierto.
    return jsonb_build_object('status', 'qa_recipient_not_allowed');
  end if;
  return public.reservar_envio_panel(
    p_barberia_id,p_cliente_id,p_client_message_id,p_texto,p_hora,p_confirm_resend,
    p_rate_limit,p_rate_window_seconds,p_duplicate_window_seconds,p_stale_pending_seconds
  );
end;
$$;
revoke all on function public.reservar_envio_panel_qa_manual(bigint,bigint,uuid,text,text[],text,boolean,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reservar_envio_panel_qa_manual(bigint,bigint,uuid,text,text[],text,boolean,integer,integer,integer,integer) to service_role;
commit;
