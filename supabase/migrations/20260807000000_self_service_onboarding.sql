-- Onboarding self-service seguro, idempotente y multi-tenant.
-- No modifica integraciones ni workflows de WhatsApp. Todas las mutaciones
-- sensibles pasan por funciones con validacion server-side y una transaccion.
begin;

alter table public.barberias add column if not exists pais text;
alter table public.barberias add column if not exists moneda text;

update public.barberias
set pais = coalesce(nullif(pais, ''), metadata ->> 'pais', 'AR'),
    moneda = coalesce(nullif(moneda, ''), metadata ->> 'moneda', 'ARS');

alter table public.barberias alter column moneda set default 'ARS';
alter table public.barberias alter column moneda set not null;

-- Los verticales son datos configurables. La restriccion anterior de la
-- fundacion quedaba acoplada al frontend y bloqueaba nuevos rubros.
alter table public.barberias drop constraint if exists barberias_vertical_check;

create table if not exists public.saas_verticales (
  codigo text primary key check (codigo ~ '^[a-z][a-z0-9_-]{1,39}$'),
  nombre text not null,
  descripcion text,
  activo boolean not null default true,
  orden smallint not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.saas_verticales (codigo, nombre, descripcion, orden)
values
  ('barberia', 'Barberia', 'Barberias y estudios de grooming', 10),
  ('peluqueria', 'Peluqueria', 'Peluquerias y salones de cabello', 20),
  ('salon', 'Salon de belleza', 'Salones de belleza', 30),
  ('spa', 'Centro de estetica', 'Spa y centros de estetica', 40),
  ('veterinaria', 'Veterinaria', 'Clinicas y consultorios veterinarios', 50),
  ('gimnasio', 'Gimnasio', 'Gimnasios y estudios de entrenamiento', 60),
  ('clinica', 'Clinica', 'Consultorios y clinicas', 70),
  ('taller', 'Taller', 'Talleres y servicios tecnicos', 80),
  ('custom', 'Otro', 'Otro tipo de negocio', 90)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion, orden = excluded.orden;

create table if not exists public.saas_onboarding_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  barberia_id bigint references public.barberias(id) on delete set null,
  status text not null default 'started' check (status in ('started', 'in_progress', 'completed', 'abandoned')),
  current_step smallint not null default 0 check (current_step between 0 and 8),
  source text not null default 'direct',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  abandoned_at timestamptz,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saas_onboarding_events (
  id bigint generated always as identity primary key,
  session_id bigint references public.saas_onboarding_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  barberia_id bigint references public.barberias(id) on delete set null,
  event_name text not null,
  step smallint check (step is null or step between 0 and 8),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.saas_audit_log (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  event_name text not null,
  user_id uuid references auth.users(id) on delete set null,
  barberia_id bigint references public.barberias(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_saas_onboarding_events_user on public.saas_onboarding_events (user_id, created_at desc);
create index if not exists idx_saas_onboarding_events_tenant on public.saas_onboarding_events (barberia_id, created_at desc);
create index if not exists idx_saas_audit_log_tenant on public.saas_audit_log (barberia_id, created_at desc);

alter table public.saas_verticales enable row level security;
alter table public.saas_onboarding_sessions enable row level security;
alter table public.saas_onboarding_events enable row level security;
alter table public.saas_audit_log enable row level security;

revoke all on table public.saas_verticales from anon, authenticated;
revoke all on table public.saas_onboarding_sessions from anon, authenticated;
revoke all on table public.saas_onboarding_events from anon, authenticated;
revoke all on table public.saas_audit_log from anon, authenticated;

drop trigger if exists trg_saas_verticales_updated_at on public.saas_verticales;
create trigger trg_saas_verticales_updated_at
before update on public.saas_verticales
for each row execute function public.set_updated_at();

drop trigger if exists trg_saas_onboarding_sessions_updated_at on public.saas_onboarding_sessions;
create trigger trg_saas_onboarding_sessions_updated_at
before update on public.saas_onboarding_sessions
for each row execute function public.set_updated_at();

-- Refuerza el bootstrap existente: toda alta directa de tenant tambien recibe
-- una fecha de trial coherente, sin resetear suscripciones ya existentes.
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
  select coalesce(trial_dias, 14) into v_trial_days
  from public.saas_planes
  where codigo = coalesce(new.plan_codigo, 'starter') and activo = true;
  v_trial_days := coalesce(v_trial_days, 14);
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

create or replace function public.get_self_service_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Autenticacion requerida.' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'verticales', coalesce((select jsonb_agg(to_jsonb(v) order by v.orden, v.nombre) from public.saas_verticales v where v.activo), '[]'::jsonb),
    'paises', jsonb_build_array(
      jsonb_build_object('codigo','AR','nombre','Argentina'),
      jsonb_build_object('codigo','UY','nombre','Uruguay'),
      jsonb_build_object('codigo','CL','nombre','Chile'),
      jsonb_build_object('codigo','MX','nombre','Mexico'),
      jsonb_build_object('codigo','ES','nombre','Espana'),
      jsonb_build_object('codigo','OTRO','nombre','Otro')
    ),
    'idiomas', jsonb_build_array(
      jsonb_build_object('codigo','es-AR','nombre','Espanol'),
      jsonb_build_object('codigo','en','nombre','English'),
      jsonb_build_object('codigo','pt-BR','nombre','Portugues')
    ),
    'monedas', jsonb_build_array(
      jsonb_build_object('codigo','ARS','nombre','Peso argentino'),
      jsonb_build_object('codigo','USD','nombre','Dolar estadounidense'),
      jsonb_build_object('codigo','UYU','nombre','Peso uruguayo'),
      jsonb_build_object('codigo','CLP','nombre','Peso chileno'),
      jsonb_build_object('codigo','MXN','nombre','Peso mexicano'),
      jsonb_build_object('codigo','EUR','nombre','Euro')
    )
  );
end;
$$;

create or replace function public.track_self_service_onboarding(
  p_event_name text,
  p_step smallint default null,
  p_source text default 'direct',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.saas_onboarding_sessions%rowtype;
begin
  if v_user_id is null then
    raise exception 'Autenticacion requerida.' using errcode = '28000';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_user_id and u.email_confirmed_at is not null) then
    raise exception 'El email debe estar verificado antes de iniciar el onboarding.' using errcode = '42501';
  end if;
  if p_event_name is null or length(btrim(p_event_name)) not between 2 and 80 then
    raise exception 'Evento de onboarding invalido.' using errcode = '22023';
  end if;
  if p_step is not null and (p_step < 0 or p_step > 8) then
    raise exception 'Paso de onboarding invalido.' using errcode = '22023';
  end if;

  insert into public.saas_onboarding_sessions (user_id, status, current_step, source, metadata)
  values (v_user_id, 'in_progress', coalesce(p_step, 0), left(coalesce(nullif(btrim(p_source), ''), 'direct'), 80), coalesce(p_metadata, '{}'::jsonb))
  on conflict (user_id) do update set
    status = case when public.saas_onboarding_sessions.status = 'completed' then 'completed' else 'in_progress' end,
    current_step = greatest(public.saas_onboarding_sessions.current_step, coalesce(excluded.current_step, 0)),
    source = coalesce(nullif(excluded.source, ''), public.saas_onboarding_sessions.source),
    last_seen_at = now(),
    metadata = public.saas_onboarding_sessions.metadata || excluded.metadata;

  select * into v_session from public.saas_onboarding_sessions where user_id = v_user_id;
  insert into public.saas_onboarding_events (session_id, user_id, barberia_id, event_name, step, metadata)
  values (v_session.id, v_user_id, v_session.barberia_id, left(btrim(p_event_name), 80), p_step, coalesce(p_metadata, '{}'::jsonb));

  return jsonb_build_object('session_id', v_session.id, 'status', v_session.status, 'current_step', v_session.current_step);
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
  v_slug text;
  v_base_slug text;
  v_suffix integer := 1;
  v_trial_days integer := 14;
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

  select coalesce(trial_dias, 14) into v_trial_days from public.saas_planes where codigo = 'starter' and activo;
  v_trial_days := coalesce(v_trial_days, 14);
  v_trial_ends := coalesce(v_barberia.trial_ends_at, v_trial_started + make_interval(days => v_trial_days));

  update public.barberias
  set estado_cuenta = case when estado_cuenta in ('suspended', 'canceled') then 'trial' else coalesce(estado_cuenta, 'trial') end,
      plan_codigo = coalesce(plan_codigo, 'starter'), trial_ends_at = v_trial_ends,
      onboarding_completed = true
  where id = v_barberia.id;

  insert into public.saas_suscripciones (barberia_id, plan_codigo, estado, trial_started_at, trial_ends_at, metadata)
  values (v_barberia.id, 'starter', 'trialing', v_trial_started, v_trial_ends, jsonb_build_object('source', 'self_service_onboarding'))
  on conflict (barberia_id) do update set
    trial_ends_at = coalesce(public.saas_suscripciones.trial_ends_at, excluded.trial_ends_at),
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

create or replace function public.get_onboarding_status(p_barberia_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia public.barberias%rowtype;
  v_items jsonb;
  v_done integer;
begin
  select * into v_barberia from public.barberias where id = p_barberia_id;
  if v_barberia.id is null or not (public.is_platform_member() or public.is_barberia_member(p_barberia_id)) then
    raise exception 'No autorizado.' using errcode = '42501';
  end if;

  v_items := jsonb_build_array(
    jsonb_build_object('key','horarios','label','Configurar horarios','done',exists (select 1 from public.config where barberia_id = p_barberia_id and clave = 'horarios_default')),
    jsonb_build_object('key','empleados','label','Agregar empleados','done',exists (select 1 from public.barberos where barberia_id = p_barberia_id and activo)),
    jsonb_build_object('key','servicios','label','Crear servicios','done',exists (select 1 from public.servicios where barberia_id = p_barberia_id and activo)),
    jsonb_build_object('key','whatsapp','label','Conectar WhatsApp','done',exists (select 1 from public.saas_integraciones where barberia_id = p_barberia_id and proveedor = 'evolution' and estado = 'conectado')),
    jsonb_build_object('key','reserva','label','Hacer primera reserva','done',exists (select 1 from public.turnos where barberia_id = p_barberia_id and estado <> 'cancelado')),
    jsonb_build_object('key','marca','label','Personalizar marca','done',v_barberia.logo_url is not null or v_barberia.color_principal is not null),
    jsonb_build_object('key','colaboradores','label','Invitar colaboradores','done',(select count(*) > 1 from public.barberia_members where barberia_id = p_barberia_id))
  );
  select count(*) into v_done from jsonb_array_elements(v_items) item where (item ->> 'done')::boolean;
  return jsonb_build_object('barberia_id', p_barberia_id, 'completed', v_barberia.onboarding_completed, 'progress', round((v_done::numeric / 7) * 100), 'items', v_items);
end;
$$;

revoke all on function public.get_self_service_catalog() from public, anon;
grant execute on function public.get_self_service_catalog() to authenticated;
revoke all on function public.track_self_service_onboarding(text, smallint, text, jsonb) from public, anon;
grant execute on function public.track_self_service_onboarding(text, smallint, text, jsonb) to authenticated;
revoke all on function public.complete_self_service_onboarding(text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.complete_self_service_onboarding(text, text, text, text, text, text, text, text, text, text) to authenticated;
revoke all on function public.get_onboarding_status(bigint) from public, anon;
grant execute on function public.get_onboarding_status(bigint) to authenticated;

commit;
