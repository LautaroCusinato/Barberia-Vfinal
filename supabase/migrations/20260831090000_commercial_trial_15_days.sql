-- Comercial: trial de 15 días y enforcement post-trial.
-- Esta migración no reescribe fechas existentes ni habilita proveedores.
begin;

alter table public.saas_planes alter column trial_dias set default 15;
update public.saas_planes
set trial_dias = 15, updated_at = now()
where activo = true;

create or replace function public.bootstrap_barberia_saas()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trial_days integer;
  v_started_at timestamptz := now();
  v_ends_at timestamptz;
begin
  select coalesce(trial_dias, 15) into v_trial_days
  from public.saas_planes
  where codigo = coalesce(new.plan_codigo, 'starter') and activo = true;
  v_trial_days := coalesce(v_trial_days, 15);
  v_ends_at := v_started_at + make_interval(days => v_trial_days);

  insert into public.saas_suscripciones (barberia_id, plan_codigo, estado, trial_started_at, trial_ends_at)
  values (new.id, coalesce(new.plan_codigo, 'starter'), 'trialing', v_started_at, v_ends_at)
  on conflict (barberia_id) do nothing;

  update public.barberias
  set trial_ends_at = coalesce(trial_ends_at, v_ends_at)
  where id = new.id;
  return new;
end;
$$;

create or replace function public.complete_self_service_onboarding(
  p_nombre text,
  p_vertical text,
  p_pais text,
  p_idioma text,
  p_zona_horaria text,
  p_moneda text,
  p_logo_url text default null,
  p_color_principal text default null,
  p_color_secundario text default null,
  p_source text default 'direct'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_existing public.barberias%rowtype;
  v_barberia public.barberias%rowtype;
  v_existing_subscription public.saas_suscripciones%rowtype;
  v_slug text;
  v_base_slug text;
  v_suffix integer := 1;
  v_trial_days integer := 15;
  v_trial_started timestamptz := now();
  v_trial_ends timestamptz;
  v_crm_id bigint;
  v_lead_id bigint;
  v_session public.saas_onboarding_sessions%rowtype;
begin
  if v_user_id is null then
    raise exception 'Autenticacion requerida.' using errcode = '28000';
  end if;
  perform pg_advisory_xact_lock(hashtext('self-service-onboarding:' || v_user_id::text));

  select email, email_confirmed_at into v_email, v_confirmed_at from auth.users where id = v_user_id;
  if v_confirmed_at is null then
    raise exception 'Verifica tu email antes de crear el negocio.' using errcode = '42501';
  end if;
  if p_nombre is null or btrim(p_nombre) !~ '^[[:alnum:]][[:alnum:] .&''-]{1,79}$' then
    raise exception 'El nombre del negocio debe tener entre 2 y 80 caracteres validos.' using errcode = '22023';
  end if;
  if p_vertical is null or not exists (select 1 from public.saas_verticales where codigo = lower(btrim(p_vertical)) and activo) then
    raise exception 'El rubro seleccionado no esta disponible.' using errcode = '22023';
  end if;
  if p_pais is null or btrim(p_pais) !~ '^[A-Za-z]{2,8}$' then
    raise exception 'Pais invalido.' using errcode = '22023';
  end if;
  if p_idioma is null or btrim(p_idioma) !~ '^[a-z]{2}(-[A-Z]{2})?$' then
    raise exception 'Idioma invalido.' using errcode = '22023';
  end if;
  if p_moneda is null or upper(btrim(p_moneda)) !~ '^[A-Z]{3}$' then
    raise exception 'Moneda invalida.' using errcode = '22023';
  end if;
  if p_zona_horaria is null or not exists (select 1 from pg_timezone_names where name = btrim(p_zona_horaria)) then
    raise exception 'Zona horaria invalida.' using errcode = '22023';
  end if;
  if p_logo_url is not null and (length(p_logo_url) > 500 or p_logo_url !~* '^https?://') then
    raise exception 'La URL del logo debe ser HTTPS o HTTP y no superar 500 caracteres.' using errcode = '22023';
  end if;
  if p_color_principal is not null and p_color_principal !~* '^#[0-9a-f]{6}$' then
    raise exception 'Color principal invalido.' using errcode = '22023';
  end if;
  if p_color_secundario is not null and p_color_secundario !~* '^#[0-9a-f]{6}$' then
    raise exception 'Color secundario invalido.' using errcode = '22023';
  end if;

  select b.* into v_existing
  from public.barberias b
  join public.barberia_members m on m.barberia_id = b.id
  where m.user_id = v_user_id and m.role = 'owner'
  order by b.created_at
  limit 1;

  if v_existing.id is not null and v_existing.onboarding_completed then
    return jsonb_build_object('barberia_id', v_existing.id, 'slug', v_existing.slug, 'status', 'already_completed');
  end if;

  if v_existing.id is null then
    v_base_slug := regexp_replace(
      regexp_replace(lower(translate(btrim(p_nombre), 'áéíóúüñ', 'aeiouun')), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'
    );
    v_base_slug := left(coalesce(nullif(v_base_slug, ''), 'negocio'), 70);
    v_slug := v_base_slug;
    while exists (select 1 from public.barberias where slug = v_slug) loop
      v_suffix := v_suffix + 1;
      v_slug := left(v_base_slug, 70 - length(v_suffix::text) - 1) || '-' || v_suffix::text;
    end loop;

    insert into public.barberias (
      nombre, slug, logo_url, color_principal, color_secundario, zona_horaria,
      vertical, estado_cuenta, plan_codigo, locale, billing_email,
      onboarding_completed, metadata, pais, moneda
    ) values (
      btrim(p_nombre), v_slug, nullif(btrim(p_logo_url), ''),
      coalesce(nullif(btrim(p_color_principal), ''), '#9B6A2F'),
      coalesce(nullif(btrim(p_color_secundario), ''), '#EDE6D8'),
      btrim(p_zona_horaria), lower(btrim(p_vertical)), 'trial', 'starter', lower(btrim(p_idioma)),
      lower(v_email), false,
      jsonb_build_object('onboarding_source', left(coalesce(nullif(btrim(p_source), ''), 'direct'), 80), 'created_by', v_user_id),
      upper(btrim(p_pais)), upper(btrim(p_moneda))
    ) returning * into v_barberia;

    insert into public.barberia_members (barberia_id, user_id, role)
    values (v_barberia.id, v_user_id, 'owner')
    on conflict (barberia_id, user_id) do update set role = 'owner';
  else
    v_barberia := v_existing;
    update public.barberias
    set nombre = btrim(p_nombre), vertical = lower(btrim(p_vertical)), pais = upper(btrim(p_pais)),
        locale = lower(btrim(p_idioma)), zona_horaria = btrim(p_zona_horaria), moneda = upper(btrim(p_moneda)),
        logo_url = coalesce(nullif(btrim(p_logo_url), ''), logo_url),
        color_principal = coalesce(nullif(btrim(p_color_principal), ''), color_principal),
        color_secundario = coalesce(nullif(btrim(p_color_secundario), ''), color_secundario),
        billing_email = lower(v_email), metadata = metadata || jsonb_build_object('onboarding_source', left(coalesce(nullif(btrim(p_source), ''), 'direct'), 80))
    where id = v_barberia.id
    returning * into v_barberia;
  end if;

  select coalesce(trial_dias, 15) into v_trial_days from public.saas_planes where codigo = 'starter' and activo;
  v_trial_days := coalesce(v_trial_days, 15);
  select * into v_existing_subscription from public.saas_suscripciones where barberia_id = v_barberia.id;
  if v_existing.id is not null then
    -- Re-running onboarding for a pre-existing tenant must never reset its
    -- trial. A missing legacy date remains missing instead of starting a new
    -- commercial trial implicitly.
    v_trial_ends := coalesce(v_existing_subscription.trial_ends_at, v_barberia.trial_ends_at);
  else
    v_trial_ends := coalesce(v_existing_subscription.trial_ends_at, v_barberia.trial_ends_at, v_trial_started + make_interval(days => v_trial_days));
  end if;

  update public.barberias
  set estado_cuenta = case when v_existing.id is null then coalesce(estado_cuenta, 'trial') else estado_cuenta end,
      plan_codigo = case when v_existing.id is null then coalesce(plan_codigo, 'starter') else plan_codigo end,
      -- New tenants receive the server-authoritative date. Existing tenants
      -- keep their barberia date byte-for-byte, including NULL legacy data.
      trial_ends_at = case when v_existing.id is null then coalesce(trial_ends_at, v_trial_ends) else trial_ends_at end,
      onboarding_completed = true
  where id = v_barberia.id;

  insert into public.saas_suscripciones (barberia_id, plan_codigo, estado, trial_started_at, trial_ends_at, metadata)
  values (v_barberia.id, 'starter', 'trialing', v_trial_started, v_trial_ends, jsonb_build_object('source', 'self_service_onboarding'))
  on conflict (barberia_id) do update set
    -- Existing subscription dates are immutable here as well. The fallback
    -- is only allowed while inserting/updating the subscription of a new
    -- tenant created by this onboarding call.
    trial_ends_at = case when v_existing.id is null
      then coalesce(public.saas_suscripciones.trial_ends_at, excluded.trial_ends_at)
      else public.saas_suscripciones.trial_ends_at end,
    metadata = public.saas_suscripciones.metadata || excluded.metadata;

  insert into public.profiles (id, full_name) values (v_user_id, btrim(p_nombre))
  on conflict (id) do update set full_name = coalesce(public.profiles.full_name, excluded.full_name);

  insert into public.config (barberia_id, clave, valor) values
    (v_barberia.id, 'horarios_default', '{"dias":[1,2,3,4,5],"inicio":"09:00","fin":"18:00","breaks":[{"inicio":"13:00","fin":"14:00"}]}'::text),
    (v_barberia.id, 'reservas_config', '{"intervalo_min":30,"anticipacion_horas":1,"max_dias":60,"confirmacion":"manual"}'::text),
    (v_barberia.id, 'branding', jsonb_build_object('logo_url', v_barberia.logo_url, 'color_principal', v_barberia.color_principal, 'color_secundario', v_barberia.color_secundario)::text)
  on conflict (barberia_id, clave) do update set valor = excluded.valor;

  select id into v_crm_id from public.crm_negocios where barberia_id = v_barberia.id limit 1;
  if v_crm_id is null then
    insert into public.crm_negocios (barberia_id, nombre, rubro, pais, idioma, zona_horaria, email, canal_origen, etapa, moneda, metadata)
    values (v_barberia.id, v_barberia.nombre, v_barberia.vertical, v_barberia.pais, v_barberia.locale, v_barberia.zona_horaria,
      v_barberia.billing_email, coalesce(nullif(btrim(p_source), ''), 'direct'), 'prueba', v_barberia.moneda,
      jsonb_build_object('source', 'self_service_onboarding')) returning id into v_crm_id;
  else
    update public.crm_negocios set nombre = v_barberia.nombre, rubro = v_barberia.vertical, pais = v_barberia.pais,
      idioma = v_barberia.locale, zona_horaria = v_barberia.zona_horaria, email = v_barberia.billing_email,
      etapa = case when etapa = 'cliente' then etapa else 'prueba' end, moneda = v_barberia.moneda,
      metadata = metadata || jsonb_build_object('source', 'self_service_onboarding') where id = v_crm_id;
  end if;

  select id into v_lead_id from public.crm_leads where negocio_id = v_crm_id and metadata ->> 'onboarding_user_id' = v_user_id::text limit 1;
  if v_lead_id is null then
    insert into public.crm_leads (negocio_id, nombre_contacto, email, canal_preferido, estado_conversacion, interes, moneda, metadata)
    values (v_crm_id, (select full_name from public.profiles where id = v_user_id), v_barberia.billing_email,
      coalesce(nullif(btrim(p_source), ''), 'direct'), 'convertido', 'trial_saas', v_barberia.moneda,
      jsonb_build_object('onboarding_user_id', v_user_id, 'converted_at', now())) returning id into v_lead_id;
  end if;

  insert into public.saas_onboarding_sessions (user_id, barberia_id, status, current_step, source, completed_at, last_seen_at)
  values (v_user_id, v_barberia.id, 'completed', 8, coalesce(nullif(btrim(p_source), ''), 'direct'), now(), now())
  on conflict (user_id) do update set barberia_id = excluded.barberia_id, status = 'completed', current_step = 8,
    completed_at = coalesce(public.saas_onboarding_sessions.completed_at, excluded.completed_at), last_seen_at = now();

  select * into v_session from public.saas_onboarding_sessions where user_id = v_user_id;
  insert into public.saas_onboarding_events (session_id, user_id, barberia_id, event_name, step, metadata)
  values (v_session.id, v_user_id, v_barberia.id, 'onboarding_completed', 8, jsonb_build_object('crm_negocio_id', v_crm_id, 'crm_lead_id', v_lead_id));
  insert into public.saas_audit_log (event_key, event_name, user_id, barberia_id, metadata)
  values ('onboarding_completed:' || v_user_id::text, 'onboarding_completed', v_user_id, v_barberia.id,
    jsonb_build_object('crm_negocio_id', v_crm_id, 'crm_lead_id', v_lead_id, 'trial_ends_at', v_trial_ends))
  on conflict (event_key) do nothing;

  return jsonb_build_object('barberia_id', v_barberia.id, 'slug', v_barberia.slug, 'status', 'completed', 'trial_ends_at', v_trial_ends, 'crm_negocio_id', v_crm_id);
end;
$$;

-- Trial expiry is a terminal commercial state. The access function checks the
-- timestamp on every request, so a stale scheduler can never leave an expired
-- trial operational. Paid payment failures continue to use past_due/grace.
create or replace function public.barberia_access_state(p_barberia_id bigint)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when b.estado_cuenta = 'suspended' then 'suspended'
    when s.estado = 'active' then 'active'
    when s.estado = 'trialing' and s.trial_ends_at is not null and s.trial_ends_at <= now() then 'expired'
    when s.estado = 'trialing' and coalesce(s.trial_ends_at, now()) > now() then 'trialing'
    -- Keep compatibility with installations where an older job already
    -- recorded trial_expired as past_due, while preserving paid past_due.
    when s.estado = 'past_due' and s.status_reason = 'trial_expired' then 'expired'
    when s.estado = 'grace_period' and coalesce(s.grace_ends_at, now()) >= now() then 'grace_period'
    when s.estado = 'past_due' then 'past_due'
    when s.estado = 'grace_period' then 'suspended'
    when s.estado in ('suspended','canceled','refunded','expired') then s.estado
    when s.estado in ('incomplete','payment_review','paused') then 'past_due'
    else coalesce(b.estado_cuenta, 'trial')
  end
  from public.barberias b
  left join public.saas_suscripciones s on s.barberia_id = b.id
  where b.id = p_barberia_id;
$$;

create or replace function public.barberia_operational_access(p_barberia_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(public.barberia_access_state(p_barberia_id) in ('active', 'trialing', 'past_due'), false);
$$;

-- Existing member read policies stay intact; these additive replacements stop
-- operational writes for expired tenants while retaining historical data.
drop policy if exists "servicios_write_owner" on public.servicios;
create policy "servicios_write_owner" on public.servicios for all
using (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id));

drop policy if exists "barberos_write_owner" on public.barberos;
create policy "barberos_write_owner" on public.barberos for all
using (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id));

drop policy if exists "clientes_write_staff" on public.clientes;
create policy "clientes_write_staff" on public.clientes for all
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id));

drop policy if exists "turnos_write_staff" on public.turnos;
create policy "turnos_write_staff" on public.turnos for all
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id));

drop policy if exists "mensajes_write_staff" on public.mensajes;
create policy "mensajes_write_staff" on public.mensajes for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id));

drop policy if exists "conversaciones_write_staff" on public.conversaciones;
create policy "conversaciones_write_staff" on public.conversaciones for all to authenticated
using (barberia_id is not null and public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id))
with check (barberia_id is not null and public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id));

drop policy if exists "pagos_write_staff" on public.pagos;
create policy "pagos_write_staff" on public.pagos for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id));

drop policy if exists "notas_write_staff" on public.notas;
create policy "notas_write_staff" on public.notas for all
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']) and public.barberia_operational_access(barberia_id));

drop policy if exists "config_write_owner" on public.config;
create policy "config_write_owner" on public.config for all
using (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id));

drop policy if exists "horarios_write_owner" on public.horarios_barbero;
create policy "horarios_write_owner" on public.horarios_barbero for all
using (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id));

drop policy if exists "barbero_servicios_write_owner" on public.barbero_servicios;
create policy "barbero_servicios_write_owner" on public.barbero_servicios for all
using (public.is_barberia_role((select barberia_id from public.barberos where id = barbero_id), array['owner']) and public.barberia_operational_access((select barberia_id from public.barberos where id = barbero_id)))
with check (public.is_barberia_role((select barberia_id from public.barberos where id = barbero_id), array['owner']) and public.barberia_operational_access((select barberia_id from public.barberos where id = barbero_id)));

drop policy if exists "bloqueos_write_owner" on public.bloqueos_agenda;
create policy "bloqueos_write_owner" on public.bloqueos_agenda for all
using (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner']) and public.barberia_operational_access(barberia_id));

revoke all on function public.barberia_operational_access(bigint) from public, anon;
grant execute on function public.barberia_operational_access(bigint) to authenticated, service_role;

-- Reuse the existing transition RPC and audit/history contract. The only
-- additional transition is trialing -> expired; no grace period is created
-- for an unpaid trial. Expected-version checks keep retries safe.
create or replace function public.transition_saas_subscription(
  p_subscription_id bigint,
  p_to_state text,
  p_reason text default null,
  p_source text default 'system',
  p_provider_event_id text default null,
  p_provider_event_at timestamptz default null,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
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
    (v_from = 'trialing' and v_to in ('active','past_due','grace_period','canceled','incomplete','expired')) or
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
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
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
    where estado = 'trialing' and trial_ends_at is not null and trial_ends_at <= now()
    order by trial_ends_at limit greatest(1, least(coalesce(p_limit, 100), 1000))
  loop
    perform public.transition_saas_subscription(v_sub.id, 'expired', 'trial_expired', 'trial');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- PlatformCRM receives only the subscription metadata needed to call the
-- guarded transition RPC. Existing consumers can ignore the additive keys.
create or replace function public.get_platform_billing_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.billing_can_manage() then
    raise exception 'Sólo owner/admin de plataforma puede consultar billing global.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'subscriptions_by_state', coalesce((select jsonb_object_agg(estado, total) from (select estado, count(*) total from public.saas_suscripciones group by estado) s), '{}'::jsonb),
    'tenants', coalesce((select jsonb_agg(jsonb_build_object(
      'barberia_id', b.id,
      'nombre', b.nombre,
      'plan_codigo', s.plan_codigo,
      'estado', s.estado,
      'status_reason', s.status_reason,
      'state_version', s.state_version,
      'subscription_id', s.id,
      'access_state', public.barberia_access_state(b.id),
      'trial_ends_at', s.trial_ends_at,
      'current_period_end', s.current_period_end
    ) order by b.nombre) from public.barberias b join public.saas_suscripciones s on s.barberia_id = b.id), '[]'::jsonb),
    'pending_webhooks', (select count(*) from public.saas_billing_webhook_events where estado in ('received','processing','failed')),
    'pending_events', (select count(*) from public.saas_billing_events where estado = 'pending')
  ) into v_result;
  return v_result;
end;
$$;

commit;
