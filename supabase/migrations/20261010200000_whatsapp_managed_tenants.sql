-- WhatsApp administrado para cualquier negocio (QA y producción).
--
-- Hasta ahora la bandeja y el envío manual de la conversación real sólo
-- existían para el negocio QA 928. Esta migración generaliza esas piezas a
-- cualquier negocio cuya conexión fue vinculada desde el panel con su
-- instancia administrada:
--   * QA:         environment = 'qa',         instancia austral-qa-tenant-<id>
--   * producción: environment = 'production', instancia austral-prod-tenant-<id>
-- El negocio siempre sale de la integración/conexión (nunca del llamador) y
-- todas las funciones son sólo service_role.
--
-- Requiere 20261005120000_whatsapp_panel_send_atomic.sql (reservar_envio_panel).
-- Aditiva e idempotente. Rollback: drop de las tres funciones y del trigger
-- trg_promover_nombre_web_whatsapp; las columnas nuevas pueden quedar.
begin;

-- Columnas que el runtime administrado lee o escribe (ya existen en QA).
alter table public.saas_whatsapp_connections
  add column if not exists handoff_enabled boolean not null default false,
  add column if not exists qr_payload text,
  add column if not exists pairing_started_at timestamptz,
  add column if not exists pairing_expires_at timestamptz,
  add column if not exists provisioning_operation_id uuid,
  add column if not exists provisioning_lease_until timestamptz,
  add column if not exists webhook_verified_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.saas_whatsapp_connections'::regclass and conname = 'saas_whatsapp_connections_handoff_requires_automation') then
    alter table public.saas_whatsapp_connections add constraint saas_whatsapp_connections_handoff_requires_automation check (not handoff_enabled or automation_enabled);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.saas_whatsapp_connections'::regclass and conname = 'saas_whatsapp_connections_qr_payload_size') then
    alter table public.saas_whatsapp_connections add constraint saas_whatsapp_connections_qr_payload_size check (qr_payload is null or octet_length(qr_payload) <= 1048576);
  end if;
end
$$;

alter table public.clientes add column if not exists whatsapp_nombre_pendiente boolean not null default false;
alter table public.mensajes
  add column if not exists qa_whatsapp_integration_id bigint references public.saas_integraciones(id) on delete set null,
  add column if not exists qa_whatsapp_operation_id text;
create unique index if not exists uq_mensajes_qa_whatsapp_operation
  on public.mensajes (barberia_id, qa_whatsapp_integration_id, qa_whatsapp_operation_id)
  where qa_whatsapp_operation_id is not null;

-- Conexión administrada y vinculada de un negocio, o null.
create or replace function public.whatsapp_conexion_administrada(p_integration_id bigint)
returns public.saas_whatsapp_connections
language sql stable security definer set search_path = public, pg_temp
as $$
  select c.*
  from public.saas_whatsapp_connections c
  join public.saas_integraciones i on i.id = c.integration_id and i.barberia_id = c.barberia_id
  where c.integration_id = p_integration_id
    and c.provider = 'evolution' and i.proveedor = 'evolution' and i.integration_type = 'whatsapp'
    and lower(btrim(coalesce(c.instance_name, ''))) <> 'miwsp'
    and (
      (c.environment = 'qa' and c.instance_name = 'austral-qa-tenant-' || c.barberia_id)
      or (c.environment = 'production' and c.instance_name = 'austral-prod-tenant-' || c.barberia_id)
    )
  limit 1
$$;
revoke all on function public.whatsapp_conexion_administrada(bigint) from public, anon, authenticated;
grant execute on function public.whatsapp_conexion_administrada(bigint) to service_role;

-- Bandeja: mismo contrato que registrar_mensaje_whatsapp_qa928, para el
-- negocio dueño de la integración administrada.
create or replace function public.registrar_mensaje_whatsapp(
  p_integration_id bigint,
  p_operation_id text,
  p_de text,
  p_telefono text,
  p_texto text,
  p_message_at timestamptz,
  p_provider_message_id text default null,
  p_customer_name text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_connection public.saas_whatsapp_connections;
  v_tenant bigint;
  v_cliente public.clientes;
  v_message public.mensajes;
  v_telefono text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_placeholder text;
  v_name text := nullif(btrim(p_customer_name), '');
  v_zone text;
begin
  v_connection := public.whatsapp_conexion_administrada(p_integration_id);
  if v_connection.id is null then raise exception 'managed_whatsapp_scope_required' using errcode = '42501'; end if;
  v_tenant := v_connection.barberia_id;
  if p_de not in ('paciente', 'bot') or p_de is null or v_telefono !~ '^549[1-9][0-9]{9}$'
    or nullif(btrim(p_texto), '') is null or char_length(p_texto) > 4096
    or p_message_at is null or not isfinite(p_message_at)
    or nullif(btrim(p_operation_id), '') is null or char_length(p_operation_id) > 240
    or (p_de = 'bot' and nullif(btrim(p_provider_message_id), '') is null)
    or char_length(coalesce(p_provider_message_id, '')) > 200
    or char_length(coalesce(v_name, '')) > 60
  then raise exception 'managed_whatsapp_invalid_message' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('whatsapp_message:' || p_integration_id || ':' || p_operation_id, 0));
  v_placeholder := 'Contacto WhatsApp · …' || right(v_telefono, 4);
  insert into public.clientes (barberia_id, nombre, telefono, whatsapp_nombre_pendiente)
    values (v_tenant, coalesce(v_name, v_placeholder), v_telefono, v_name is null)
    on conflict (barberia_id, telefono) do nothing;
  select * into v_cliente from public.clientes
    where barberia_id = v_tenant and telefono = v_telefono for update;
  -- Sólo completa la ficha provisional creada por esta ruta. Nunca reemplaza
  -- un nombre real; si un operador ya la editó, se respeta esa edición.
  if v_cliente.whatsapp_nombre_pendiente then
    if v_cliente.nombre is distinct from v_placeholder and nullif(btrim(v_cliente.nombre), '') is not null then
      update public.clientes set whatsapp_nombre_pendiente = false where id = v_cliente.id returning * into v_cliente;
    elsif v_name is not null then
      update public.clientes set nombre = v_name, whatsapp_nombre_pendiente = false where id = v_cliente.id returning * into v_cliente;
    elsif nullif(btrim(v_cliente.nombre), '') is null then
      update public.clientes set nombre = v_placeholder where id = v_cliente.id returning * into v_cliente;
    end if;
  elsif nullif(btrim(v_cliente.nombre), '') is null and v_name is not null then
    update public.clientes set nombre = v_name where id = v_cliente.id returning * into v_cliente;
  end if;

  select * into v_message from public.mensajes
    where barberia_id = v_tenant and qa_whatsapp_integration_id = p_integration_id and qa_whatsapp_operation_id = p_operation_id;
  if found then
    if v_message.de is distinct from p_de or v_message.telefono is distinct from v_telefono or v_message.texto is distinct from p_texto
      or (p_de = 'bot' and v_message.whatsapp_id is distinct from nullif(btrim(p_provider_message_id), ''))
    then raise exception 'managed_whatsapp_message_identity_conflict' using errcode = '22023'; end if;
    return jsonb_build_object('status', 'replay', 'mensaje', to_jsonb(v_message), 'cliente', to_jsonb(v_cliente));
  end if;
  select b.zona_horaria into v_zone from public.barberias b where b.id = v_tenant;
  if not exists (select 1 from pg_timezone_names where name = v_zone) then v_zone := 'America/Argentina/Buenos_Aires'; end if;
  insert into public.mensajes (barberia_id, cliente_id, paciente, texto, de, hora, leido,
    enviado_wsp, created_at, telefono, whatsapp_id, estado_envio, qa_whatsapp_integration_id, qa_whatsapp_operation_id)
  values (v_tenant, v_cliente.id, v_cliente.nombre, p_texto, p_de, to_char(p_message_at at time zone v_zone, 'HH24:MI'),
    p_de = 'bot', p_de = 'bot', p_message_at, v_telefono, nullif(btrim(p_provider_message_id), ''),
    'aceptado', p_integration_id, p_operation_id)
  returning * into v_message;
  return jsonb_build_object('status', 'persisted', 'mensaje', to_jsonb(v_message), 'cliente', to_jsonb(v_cliente));
end;
$$;
revoke all on function public.registrar_mensaje_whatsapp(bigint,text,text,text,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.registrar_mensaje_whatsapp(bigint,text,text,text,text,timestamptz,text,text) to service_role;

-- Envío manual desde la bandeja de un negocio administrado: el teléfono de la
-- ficha se vuelve a validar bajo el mismo lock que reserva el mensaje.
create or replace function public.reservar_envio_panel_administrado(
  p_barberia_id bigint,
  p_cliente_id bigint,
  p_client_message_id uuid,
  p_texto text,
  p_expected_phone text,
  p_hora text default null,
  p_confirm_resend boolean default false,
  p_rate_limit integer default 20,
  p_rate_window_seconds integer default 60,
  p_duplicate_window_seconds integer default 300,
  p_stale_pending_seconds integer default 120
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_phone text;
begin
  if not exists (
    select 1 from public.saas_whatsapp_connections c
    where c.barberia_id = p_barberia_id and c.provider = 'evolution' and c.state = 'CONNECTED'
      and c.outbound_enabled
      and (public.whatsapp_conexion_administrada(c.integration_id)).id = c.id
  ) then
    return jsonb_build_object('status', 'qa_manual_not_authorized');
  end if;
  if p_expected_phone is null or p_expected_phone !~ '^549[1-9][0-9]{9}$' then
    raise exception 'invalid_settings' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('austral_panel_send:' || p_barberia_id::text, 0));
  select public.telefono_whatsapp_canonico(c.telefono) into v_phone
    from public.clientes c
    where c.id = p_cliente_id and c.barberia_id = p_barberia_id
    for update;
  if not found then return jsonb_build_object('status', 'customer_not_found'); end if;
  if v_phone is null then return jsonb_build_object('status', 'customer_phone_invalid'); end if;
  if v_phone <> p_expected_phone then
    return jsonb_build_object('status', 'qa_recipient_not_allowed');
  end if;
  return public.reservar_envio_panel(
    p_barberia_id,p_cliente_id,p_client_message_id,p_texto,p_hora,p_confirm_resend,
    p_rate_limit,p_rate_window_seconds,p_duplicate_window_seconds,p_stale_pending_seconds
  );
end;
$$;
revoke all on function public.reservar_envio_panel_administrado(bigint,bigint,uuid,text,text,text,boolean,integer,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reservar_envio_panel_administrado(bigint,bigint,uuid,text,text,text,boolean,integer,integer,integer,integer) to service_role;

-- Una reserva web confirmada completa el nombre de la ficha provisional que
-- creó el chat (cualquier negocio). Reemplaza el trigger exclusivo de QA928.
create or replace function public.promover_nombre_web_whatsapp()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_cliente public.clientes;
  v_nombre text := nullif(btrim(new.paciente), '');
  v_placeholder text := 'Contacto WhatsApp · …' || right(new.telefono, 4);
begin
  if new.origen is distinct from 'reserva_web' or new.cliente_id is null
    or new.telefono is null or new.telefono !~ '^549[1-9][0-9]{9}$'
    or v_nombre is null or char_length(v_nombre) > 120 or v_nombre = v_placeholder
  then return new; end if;
  select * into v_cliente from public.clientes
    where id = new.cliente_id and barberia_id = new.barberia_id
      and telefono = new.telefono for update;
  if found and v_cliente.whatsapp_nombre_pendiente and v_cliente.nombre = v_placeholder then
    update public.clientes set nombre = v_nombre, whatsapp_nombre_pendiente = false
      where id = v_cliente.id and barberia_id = new.barberia_id;
  end if;
  return new;
end;
$$;
revoke all on function public.promover_nombre_web_whatsapp() from public, anon, authenticated;
drop trigger if exists trg_promover_nombre_web_qa928 on public.turnos;
drop trigger if exists trg_promover_nombre_web_whatsapp on public.turnos;
create trigger trg_promover_nombre_web_whatsapp after insert on public.turnos
  for each row execute function public.promover_nombre_web_whatsapp();
commit;
