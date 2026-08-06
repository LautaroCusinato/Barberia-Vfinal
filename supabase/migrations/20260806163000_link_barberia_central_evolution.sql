-- Vincula la instancia Evolution verificada de Barberia Central.
-- El número se guarda en el formato canónico argentino 54911XXXXXXXX.
-- No contiene API keys ni secretos y es idempotente.
begin;

do $$
declare
  v_tenant public.barberias%rowtype;
  v_existing public.saas_integraciones%rowtype;
  v_receiver text := '5491168280107';
  v_instance text := 'miwsp';
begin
  select * into v_tenant
  from public.barberias
  where lower(slug) = 'barberia-central';
  if not found then
    raise exception 'No se encontró el tenant Barberia Central.' using errcode = '22023';
  end if;

  -- Nunca reasignar una instancia o receptor que ya pertenezca a otro tenant.
  if exists (
    select 1 from public.saas_integraciones i
    where i.proveedor = 'evolution'
      and i.integration_type = 'whatsapp'
      and i.barberia_id <> v_tenant.id
      and (
        lower(btrim(i.external_instance_id)) = lower(v_instance)
        or regexp_replace(coalesce(i.receiver_number, ''), '[^0-9]', '', 'g') = v_receiver
      )
  ) then
    raise exception 'La instancia o el número ya pertenecen a otro tenant.' using errcode = '23505';
  end if;

  -- El valor anterior era el placeholder confirmado por el usuario. Si aparece
  -- otro valor no lo pisamos automáticamente para evitar perder configuración.
  if nullif(regexp_replace(coalesce(v_tenant.whatsapp, ''), '[^0-9]', '', 'g'), '') is not null
     and regexp_replace(v_tenant.whatsapp, '[^0-9]', '', 'g') not in ('5491100000000', v_receiver) then
    raise exception 'El WhatsApp actual del tenant no coincide con el placeholder esperado.' using errcode = '22023';
  end if;
  update public.barberias
  set whatsapp = v_receiver, updated_at = now()
  where id = v_tenant.id;

  select i.* into v_existing
  from public.saas_integraciones i
  where i.barberia_id = v_tenant.id
    and i.proveedor = 'evolution'
    and i.integration_type = 'whatsapp'
    and (
      lower(btrim(i.external_instance_id)) = lower(v_instance)
      or regexp_replace(coalesce(i.receiver_number, ''), '[^0-9]', '', 'g') = v_receiver
    )
  order by i.id
  limit 1
  for update;

  if found then
    update public.saas_integraciones
    set estado = 'conectado',
        external_instance_id = v_instance,
        receiver_number = v_receiver,
        base_url = 'https://evolution.cuchitron.lat',
        credential_reference = 'n8n:EVOLUTION_API_KEY',
        locale = coalesce(nullif(locale, ''), v_tenant.locale, 'es-AR'),
        timezone = coalesce(nullif(timezone, ''), v_tenant.zona_horaria, 'America/Argentina/Buenos_Aires'),
        ai_provider = coalesce(nullif(ai_provider, ''), 'deepseek'),
        ai_model = coalesce(nullif(ai_model, ''), 'deepseek-chat'),
        last_verified_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'verification_source', 'evolution_manager',
          'verified_instance', v_instance,
          'verified_receiver_number', v_receiver,
          'workflow_pilot_id', '5UQMp5vAMfBfJtSy',
          'pilot_mode', 'shadow',
          'verified_at', now()
        )
    where id = v_existing.id;
  else
    insert into public.saas_integraciones (
      barberia_id, proveedor, estado, integration_type, external_instance_id,
      receiver_number, base_url, credential_reference, locale, timezone,
      ai_provider, ai_model, last_verified_at, metadata
    ) values (
      v_tenant.id, 'evolution', 'conectado', 'whatsapp', v_instance,
      v_receiver, 'https://evolution.cuchitron.lat', 'n8n:EVOLUTION_API_KEY',
      coalesce(v_tenant.locale, 'es-AR'),
      coalesce(v_tenant.zona_horaria, 'America/Argentina/Buenos_Aires'),
      'deepseek', 'deepseek-chat', now(), jsonb_build_object(
        'verification_source', 'evolution_manager',
        'verified_instance', v_instance,
        'verified_receiver_number', v_receiver,
        'workflow_pilot_id', '5UQMp5vAMfBfJtSy',
        'pilot_mode', 'shadow',
        'verified_at', now()
      )
    );
  end if;
end;
$$;

commit;
