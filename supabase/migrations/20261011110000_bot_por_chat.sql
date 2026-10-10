-- Bot de WhatsApp por chat.
--
-- Antes responder a mano a un cliente pausaba el bot para TODO el negocio
-- (config.bot_activo = false) hasta que el dueño lo reanudara. Ahora cada
-- chat tiene su propia pausa (clientes.bot_pausado): responder a mano pausa
-- sólo ese chat y el panel la muestra/alterna con el ícono del bot junto al
-- botón de enviar. config.bot_activo queda como apagado general del servidor.
--
-- Las pausas generales existentes se originaron todas en respuestas manuales
-- (no había otra forma de pausar): se reactivan para no dejar negocios con
-- el bot apagado sin un control visible.
-- Rollback: volver a aplicar reservar_envio_panel de 20261005120000 y
-- dejar la columna (no afecta a nadie si nadie la lee).

alter table public.clientes add column if not exists bot_pausado boolean not null default false;

-- Pausa o reanuda el bot en un chat. Cualquier miembro del negocio puede
-- tomar o devolver una conversación (igual que la pausa por respuesta manual).
create or replace function public.pausar_bot_chat(p_barberia_id bigint, p_cliente_id bigint, p_pausado boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_estado boolean;
begin
  if p_pausado is null or not public.is_barberia_member(p_barberia_id) then
    raise exception 'chat_bot_not_allowed' using errcode = '42501';
  end if;
  update public.clientes set bot_pausado = p_pausado
    where id = p_cliente_id and barberia_id = p_barberia_id
    returning bot_pausado into v_estado;
  if not found then raise exception 'customer_not_found' using errcode = 'P0002'; end if;
  return v_estado;
end;
$$;
revoke all on function public.pausar_bot_chat(bigint, bigint, boolean) from public, anon;
grant execute on function public.pausar_bot_chat(bigint, bigint, boolean) to authenticated, service_role;

create or replace function public.reservar_envio_panel(
  p_barberia_id bigint,
  p_cliente_id bigint,
  p_client_message_id uuid,
  p_texto text,
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
  v_texto text := btrim(coalesce(p_texto, ''));
  v_hora text := case when p_hora ~ '^[0-2][0-9]:[0-5][0-9]$' then p_hora else to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') end;
  v_cliente record;
  v_telefono text;
  v_existing public.mensajes;
  v_row public.mensajes;
  v_count integer;
  v_bot text;
  v_bot_was_active boolean;
begin
  if p_barberia_id is null or p_barberia_id <= 0 or p_cliente_id is null or p_cliente_id <= 0 or p_client_message_id is null then
    raise exception 'invalid_target' using errcode = '22023';
  end if;
  if v_texto = '' or char_length(v_texto) > 4096 then
    raise exception 'invalid_text' using errcode = '22023';
  end if;
  if p_rate_limit is null or p_rate_limit < 1 or p_rate_window_seconds is null or p_rate_window_seconds < 1
     or p_duplicate_window_seconds is null or p_duplicate_window_seconds < 0
     or p_stale_pending_seconds is null or p_stale_pending_seconds < 30 then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;

  -- Todos los envíos del panel de un negocio pasan de a uno por esta sección.
  perform pg_advisory_xact_lock(hashtextextended('austral_panel_send:' || p_barberia_id::text, 0));

  perform public.recuperar_envios_panel_pendientes(p_barberia_id, p_stale_pending_seconds);

  -- La ficha debe ser del mismo negocio; el teléfono y el nombre salen de ella.
  select c.id, c.nombre, c.telefono into v_cliente
  from public.clientes c
  where c.id = p_cliente_id and c.barberia_id = p_barberia_id;
  if not found then
    return jsonb_build_object('status', 'customer_not_found');
  end if;
  v_telefono := public.telefono_whatsapp_canonico(v_cliente.telefono);
  if v_telefono is null then
    return jsonb_build_object('status', 'customer_phone_invalid');
  end if;

  -- Idempotencia: el mismo identificador nunca crea otra fila.
  select * into v_existing
  from public.mensajes m
  where m.barberia_id = p_barberia_id and m.client_message_id = p_client_message_id;
  if found then
    if v_existing.cliente_id is distinct from p_cliente_id or v_existing.texto is distinct from v_texto or v_existing.de <> 'clinica' then
      return jsonb_build_object('status', 'idempotency_conflict');
    end if;
    -- Sólo se vuelve a intentar un rechazo confirmado, o un resultado incierto
    -- con confirmación explícita del operador. Lo demás es una repetición.
    if not (v_existing.estado_envio = 'fallido' or (v_existing.estado_envio = 'incierto' and coalesce(p_confirm_resend, false))) then
      return jsonb_build_object('status', 'replay', 'mensaje', to_jsonb(v_existing));
    end if;
    select count(*) into v_count
    from public.mensajes m
    where m.barberia_id = p_barberia_id and m.de = 'clinica' and m.id <> v_existing.id
      and m.estado_envio <> 'fallido'
      and m.created_at >= now() - make_interval(secs => p_rate_window_seconds);
    if v_count >= p_rate_limit then
      return jsonb_build_object('status', 'rate_limited');
    end if;
    update public.mensajes
    set estado_envio = 'pendiente', enviado_wsp = false, telefono = v_telefono, envio_actualizado_at = now()
    where id = v_existing.id
    returning * into v_row;
  else
    if not coalesce(p_confirm_resend, false) and p_duplicate_window_seconds > 0 and exists (
      select 1 from public.mensajes m
      where m.barberia_id = p_barberia_id and m.cliente_id = p_cliente_id and m.de = 'clinica'
        and m.texto = v_texto
        and m.estado_envio in ('enviado', 'pendiente', 'recibido_n8n', 'aceptado', 'entregado', 'incierto')
        and m.created_at >= now() - make_interval(secs => p_duplicate_window_seconds)
    ) then
      return jsonb_build_object('status', 'possible_duplicate');
    end if;

    select count(*) into v_count
    from public.mensajes m
    where m.barberia_id = p_barberia_id and m.de = 'clinica'
      and m.estado_envio <> 'fallido'
      and m.created_at >= now() - make_interval(secs => p_rate_window_seconds);
    if v_count >= p_rate_limit then
      return jsonb_build_object('status', 'rate_limited');
    end if;

    insert into public.mensajes (barberia_id, cliente_id, paciente, texto, de, hora, leido, telefono, enviado_wsp, estado_envio, client_message_id, envio_actualizado_at)
    values (p_barberia_id, p_cliente_id, coalesce(nullif(btrim(v_cliente.nombre), ''), 'Cliente'), v_texto, 'clinica', v_hora, true, v_telefono, false, 'pendiente', p_client_message_id, now())
    returning * into v_row;
  end if;

  -- P4: traspaso a atención humana antes del envío, sólo en ESTE chat. El
  -- resto de los clientes del negocio sigue atendido por el bot.
  select not coalesce(c.bot_pausado, false) into v_bot_was_active
    from public.clientes c where c.id = p_cliente_id and c.barberia_id = p_barberia_id;
  update public.clientes set bot_pausado = true
    where id = p_cliente_id and barberia_id = p_barberia_id and not bot_pausado;

  return jsonb_build_object('status', 'reserved', 'mensaje', to_jsonb(v_row), 'bot_was_active', v_bot_was_active);
end;
$$;

update public.config set valor = 'true' where clave = 'bot_activo' and lower(btrim(valor)) = 'false';
