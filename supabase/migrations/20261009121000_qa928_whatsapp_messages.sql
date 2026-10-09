-- Bandeja real para la prueba manual QA928. No habilita ni envía WhatsApp.
-- Aditiva, idempotente y restringida a service_role. Rollback:
-- scripts/sql/qa928-whatsapp-messages/rollback.sql (conserva fichas/mensajes).
begin;

alter table public.clientes add column if not exists whatsapp_nombre_pendiente boolean not null default false;
alter table public.mensajes
  add column if not exists qa_whatsapp_integration_id bigint references public.saas_integraciones(id) on delete set null,
  add column if not exists qa_whatsapp_operation_id text;
create unique index if not exists uq_mensajes_qa_whatsapp_operation
  on public.mensajes (barberia_id, qa_whatsapp_integration_id, qa_whatsapp_operation_id)
  where qa_whatsapp_operation_id is not null;

create or replace function public.registrar_mensaje_whatsapp_qa928(
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
  v_tenant constant bigint := 928;
  v_cliente public.clientes;
  v_message public.mensajes;
  v_telefono text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_placeholder text;
  v_name text := nullif(btrim(p_customer_name), '');
  v_zone text;
begin
  -- Aunque el caller sea service_role, no acepta otro negocio/integración.
  if not exists (
    select 1 from public.saas_integraciones i
    join public.saas_whatsapp_connections c on c.integration_id = i.id and c.barberia_id = i.barberia_id
    join public.barberias b on b.id = i.barberia_id
    where i.id = p_integration_id and i.barberia_id = v_tenant
      and i.proveedor = 'evolution' and i.integration_type = 'whatsapp'
      and i.external_instance_id = 'austral-qa-tenant-928'
      and c.provider = 'evolution' and c.environment = 'qa' and c.instance_name = 'austral-qa-tenant-928'
      and b.metadata->>'environment' = 'qa' and b.metadata->>'whatsapp_manual_testing_authorized' = 'true'
  ) then raise exception 'qa928_scope_required' using errcode = '42501'; end if;
  if p_de not in ('paciente', 'bot') or p_de is null or v_telefono !~ '^549[1-9][0-9]{9}$'
    or nullif(btrim(p_texto), '') is null or char_length(p_texto) > 4096
    or p_message_at is null or not isfinite(p_message_at)
    or nullif(btrim(p_operation_id), '') is null or char_length(p_operation_id) > 240
    or (p_de = 'bot' and nullif(btrim(p_provider_message_id), '') is null)
    or char_length(coalesce(p_provider_message_id, '')) > 200
    or char_length(coalesce(v_name, '')) > 60
  then raise exception 'qa928_invalid_message' using errcode = '22023'; end if;

  perform pg_advisory_xact_lock(hashtextextended('qa928_message:' || p_integration_id || ':' || p_operation_id, 0));
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
    then raise exception 'qa928_message_identity_conflict' using errcode = '22023'; end if;
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
  -- «aceptado» registra evidencia del proveedor, no entrega al teléfono.
  -- No se toca bot_activo ni se invoca ninguna integración externa.
  return jsonb_build_object('status', 'persisted', 'mensaje', to_jsonb(v_message), 'cliente', to_jsonb(v_cliente));
end;
$$;
revoke all on function public.registrar_mensaje_whatsapp_qa928(bigint,text,text,text,text,timestamptz,text,text) from public, anon, authenticated;
grant execute on function public.registrar_mensaje_whatsapp_qa928(bigint,text,text,text,text,timestamptz,text,text) to service_role;
commit;
