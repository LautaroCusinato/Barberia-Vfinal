-- Envío manual del panel (tarea 38, propuestas P2/P3/P4). Aditiva e idempotente.
--
-- * P2: `mensajes.client_message_id` (único por negocio) identifica cada envío
--   del panel: reintentar el mismo envío nunca crea otra fila ni otro envío.
--   `reservar_envio_panel` serializa los envíos de un negocio con un lock
--   transaccional y, en una sola transacción, aplica idempotencia, control de
--   texto repetido, límite por ventana e inserción. Los valores (límite,
--   ventanas) llegan como parámetros desde la Edge Function: son propuestas
--   configurables pendientes de decisión, no reglas comerciales.
-- * P3: estados de envío validados para escrituras nuevas y recuperación de
--   filas `pendiente` abandonadas, que pasan a `incierto` y NUNCA se reenvían
--   automáticamente.
-- * P4: la misma reserva pausa el bot del negocio (traspaso a atención
--   humana) antes de que la función reenvíe el mensaje.
--
-- Las funciones son SECURITY DEFINER y sólo las ejecuta service_role (la Edge
-- Function, que ya resolvió sesión, membresía, rol, plan e integración). El
-- navegador no puede llamarlas ni elegir negocio, teléfono, remitente o límites.
--
-- Compatibilidad: no cambia columnas existentes ni políticas. El panel y la
-- función anteriores siguen insertando filas con `estado_envio` por defecto
-- ('enviado'), que sigue siendo un valor válido. La restricción se agrega
-- NOT VALID: no revisa filas históricas (validar aparte, ver rollback/plan).
--
-- Estados de `estado_envio`:
--   enviado       histórico/por defecto (bot, panel anterior); sin detalle.
--   pendiente     guardado por el panel, todavía no reenviado.
--   recibido_n8n  n8n confirmó la recepción (no prueba que Evolution lo aceptó).
--   aceptado      Evolution aceptó el mensaje (con su id en `whatsapp_id`).
--   entregado     reservado: sólo con evidencia de entrega del proveedor.
--   incierto      pudo haber salido; no se reenvía sin confirmación humana.
--   fallido       rechazo confirmado; reintentable con el mismo identificador.
--
-- Rollback: scripts/sql/whatsapp-panel-send/rollback.sql.
begin;

alter table public.mensajes
  add column if not exists client_message_id uuid,
  add column if not exists envio_actualizado_at timestamptz;

create unique index if not exists uq_mensajes_barberia_client_message
  on public.mensajes (barberia_id, client_message_id)
  where client_message_id is not null;

create index if not exists idx_mensajes_panel_envios
  on public.mensajes (barberia_id, created_at)
  where de = 'clinica';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mensajes'::regclass
      and conname = 'mensajes_estado_envio_valido'
  ) then
    alter table public.mensajes
      add constraint mensajes_estado_envio_valido
      check (estado_envio in ('enviado', 'pendiente', 'recibido_n8n', 'aceptado', 'entregado', 'incierto', 'fallido'))
      not valid;
  end if;
end
$$;

-- Teléfono canónico 549 + área + número, igual que whatsappCustomer.mjs.
create or replace function public.telefono_whatsapp_canonico(p_telefono text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when d ~ '^549[1-9][0-9]{9}$' then d
    when d ~ '^54[1-9][0-9]{9}$' then '549' || substr(d, 3)
    else null
  end
  from (select regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g') as d) s
$$;

-- P3: las filas `pendiente` sin novedades pasan a `incierto`. No se reenvían.
create or replace function public.recuperar_envios_panel_pendientes(
  p_barberia_id bigint default null,
  p_stale_seconds integer default 120
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_stale_seconds is null or p_stale_seconds < 30 then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  update public.mensajes
  set estado_envio = 'incierto', envio_actualizado_at = now()
  where de = 'clinica'
    and estado_envio = 'pendiente'
    and client_message_id is not null
    and (p_barberia_id is null or barberia_id = p_barberia_id)
    and coalesce(envio_actualizado_at, created_at) < now() - make_interval(secs => p_stale_seconds);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

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

  -- P4: traspaso a atención humana antes del envío. Fila ausente = bot activo.
  select c.valor into v_bot from public.config c where c.barberia_id = p_barberia_id and c.clave = 'bot_activo';
  v_bot_was_active := v_bot is null or lower(btrim(v_bot)) = 'true';
  insert into public.config (barberia_id, clave, valor)
  values (p_barberia_id, 'bot_activo', 'false')
  on conflict (barberia_id, clave) do update set valor = 'false';

  return jsonb_build_object('status', 'reserved', 'mensaje', to_jsonb(v_row), 'bot_was_active', v_bot_was_active);
end;
$$;

-- Registra el resultado del reenvío. Sólo avanza desde `pendiente` o
-- `incierto` (una evidencia tardía mejora un resultado incierto). `entregado`
-- no se acepta acá: requiere evidencia de entrega del proveedor.
create or replace function public.completar_envio_panel(
  p_barberia_id bigint,
  p_mensaje_id bigint,
  p_resultado text,
  p_proveedor_mensaje_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.mensajes;
  v_provider_id text := nullif(btrim(coalesce(p_proveedor_mensaje_id, '')), '');
begin
  if p_resultado is null or p_resultado not in ('recibido_n8n', 'aceptado', 'incierto', 'fallido') then
    raise exception 'invalid_result' using errcode = '22023';
  end if;
  if v_provider_id is not null and char_length(v_provider_id) > 200 then
    raise exception 'invalid_provider_id' using errcode = '22023';
  end if;
  update public.mensajes m
  set estado_envio = p_resultado,
      enviado_wsp = p_resultado in ('recibido_n8n', 'aceptado'),
      whatsapp_id = case when p_resultado = 'aceptado' then coalesce(v_provider_id, m.whatsapp_id) else m.whatsapp_id end,
      envio_actualizado_at = now()
  where m.id = p_mensaje_id and m.barberia_id = p_barberia_id and m.de = 'clinica'
    and m.client_message_id is not null
    and m.estado_envio in ('pendiente', 'incierto')
  returning * into v_row;
  if not found then
    select * into v_row from public.mensajes m where m.id = p_mensaje_id and m.barberia_id = p_barberia_id;
    if not found then
      return jsonb_build_object('status', 'not_found');
    end if;
    return jsonb_build_object('status', 'not_pending', 'mensaje', to_jsonb(v_row));
  end if;
  return jsonb_build_object('status', 'updated', 'mensaje', to_jsonb(v_row));
end;
$$;

revoke all on function public.telefono_whatsapp_canonico(text) from public, anon, authenticated;
revoke all on function public.recuperar_envios_panel_pendientes(bigint, integer) from public, anon, authenticated;
revoke all on function public.reservar_envio_panel(bigint, bigint, uuid, text, text, boolean, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.completar_envio_panel(bigint, bigint, text, text) from public, anon, authenticated;
grant execute on function public.telefono_whatsapp_canonico(text) to service_role;
grant execute on function public.recuperar_envios_panel_pendientes(bigint, integer) to service_role;
grant execute on function public.reservar_envio_panel(bigint, bigint, uuid, text, text, boolean, integer, integer, integer, integer) to service_role;
grant execute on function public.completar_envio_panel(bigint, bigint, text, text) to service_role;

commit;
