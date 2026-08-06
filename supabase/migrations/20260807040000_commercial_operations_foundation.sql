-- Preparación comercial y operativa multi-tenant.
-- Aditiva, idempotente y sin activar proveedores ni automatizaciones externas.
begin;

alter table public.barberias add column if not exists descripcion text;
alter table public.barberias add column if not exists email_contacto text;
alter table public.barberias add column if not exists telefono_contacto text;
alter table public.barberias add column if not exists logo_storage_path text;
alter table public.barberias add column if not exists reservas_publicas boolean not null default true;
alter table public.barberias add column if not exists politica_cancelacion text;
alter table public.barberias add column if not exists anticipacion_minutos integer not null default 60;
alter table public.barberias add column if not exists max_dias_reserva integer not null default 60;
alter table public.barberias add column if not exists intervalo_reserva_min integer not null default 15;

update public.barberias
set email_contacto = coalesce(nullif(email_contacto, ''), billing_email),
    reservas_publicas = coalesce(reservas_publicas, true),
    anticipacion_minutos = greatest(0, coalesce(anticipacion_minutos, 60)),
    max_dias_reserva = greatest(1, coalesce(max_dias_reserva, 60)),
    intervalo_reserva_min = greatest(5, coalesce(intervalo_reserva_min, 15));

alter table public.barberias drop constraint if exists barberias_anticipacion_minutos_check;
alter table public.barberias add constraint barberias_anticipacion_minutos_check check (anticipacion_minutos between 0 and 10080);
alter table public.barberias drop constraint if exists barberias_max_dias_reserva_check;
alter table public.barberias add constraint barberias_max_dias_reserva_check check (max_dias_reserva between 1 and 365);
alter table public.barberias drop constraint if exists barberias_intervalo_reserva_check;
alter table public.barberias add constraint barberias_intervalo_reserva_check check (intervalo_reserva_min between 5 and 120);

alter table public.barberia_members drop constraint if exists barberia_members_role_check;
alter table public.barberia_members add constraint barberia_members_role_check
  check (role in ('owner', 'admin', 'recepcionista', 'empleado', 'readonly', 'barbero'));

create table if not exists public.barberia_invitaciones (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'recepcionista', 'empleado', 'readonly', 'barbero')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'canceled', 'expired')),
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_barberia_invitacion_pending
  on public.barberia_invitaciones (barberia_id, lower(email))
  where status = 'pending';
create index if not exists idx_barberia_invitaciones_lookup
  on public.barberia_invitaciones (barberia_id, status, created_at desc);

alter table public.crm_negocios add column if not exists do_not_contact boolean not null default false;
alter table public.crm_leads add column if not exists do_not_contact boolean not null default false;

alter table public.crm_negocios drop constraint if exists crm_negocios_etapa_check;
alter table public.crm_negocios add constraint crm_negocios_etapa_check check (etapa in (
  'prospecto', 'discovered', 'contactado', 'contacted', 'calificado', 'qualified',
  'replied', 'interesado', 'interested', 'demo', 'prueba', 'trial', 'negociando',
  'negotiating', 'cliente', 'won', 'pausado', 'perdido', 'lost', 'do_not_contact'
));

alter table public.crm_leads drop constraint if exists crm_leads_estado_conversacion_check;
alter table public.crm_leads add constraint crm_leads_estado_conversacion_check check (estado_conversacion in (
  'nuevo', 'discovered', 'en_conversacion', 'contacted', 'esperando', 'replied',
  'interesado', 'interested', 'demo', 'trial', 'negociando', 'negotiating',
  'no_interesado', 'lost', 'convertido', 'won', 'sin_respuesta', 'do_not_contact'
));

create table if not exists public.crm_agent_drafts (
  id bigint generated always as identity primary key,
  negocio_id bigint not null references public.crm_negocios(id) on delete cascade,
  lead_id bigint references public.crm_leads(id) on delete set null,
  tipo text not null check (tipo in ('email_inicial', 'seguimiento', 'demo', 'trial', 'precio', 'objecion', 'cierre')),
  idioma text not null default 'es',
  canal text not null check (canal in ('email', 'whatsapp', 'manual')),
  asunto text,
  contenido text not null,
  estado text not null default 'pending_approval' check (estado in ('pending_approval', 'approved', 'rejected', 'sent', 'canceled')),
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_agent_drafts_review on public.crm_agent_drafts (estado, created_at desc);
create index if not exists idx_crm_agent_drafts_business on public.crm_agent_drafts (negocio_id, created_at desc);

create table if not exists public.saas_product_events (
  id bigint generated always as identity primary key,
  event_name text not null,
  environment text not null default 'production' check (environment in ('sandbox', 'demo', 'production', 'internal')),
  user_id uuid references auth.users(id) on delete set null,
  barberia_id bigint references public.barberias(id) on delete set null,
  source text not null default 'app',
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists idx_saas_product_events_time on public.saas_product_events (event_name, occurred_at desc);
create index if not exists idx_saas_product_events_tenant on public.saas_product_events (barberia_id, occurred_at desc);

-- Bucket público sólo para lectura de logos. La escritura continúa protegida
-- por RLS y por la carpeta numérica del tenant.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-logos', 'tenant-logos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

alter table public.barberia_invitaciones enable row level security;
alter table public.crm_agent_drafts enable row level security;
alter table public.saas_product_events enable row level security;

drop policy if exists saas_audit_log_select_authorized on public.saas_audit_log;
create policy saas_audit_log_select_authorized on public.saas_audit_log
for select to authenticated using (public.is_platform_member() or (barberia_id is not null and public.is_barberia_member(barberia_id)));

drop policy if exists barberia_invitaciones_select on public.barberia_invitaciones;
create policy barberia_invitaciones_select on public.barberia_invitaciones
for select to authenticated using (public.is_barberia_role(barberia_id, array['owner', 'admin']));
drop policy if exists barberia_invitaciones_write on public.barberia_invitaciones;
create policy barberia_invitaciones_write on public.barberia_invitaciones
for all to authenticated using (public.is_barberia_role(barberia_id, array['owner', 'admin']))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin']));

drop policy if exists crm_agent_drafts_platform on public.crm_agent_drafts;
create policy crm_agent_drafts_platform on public.crm_agent_drafts
for all to authenticated using (public.is_platform_member()) with check (public.is_platform_member());

drop policy if exists saas_product_events_tenant_select on public.saas_product_events;
create policy saas_product_events_tenant_select on public.saas_product_events
for select to authenticated using (public.is_platform_member() or public.is_barberia_member(barberia_id));

drop policy if exists tenant_logo_insert on storage.objects;
create policy tenant_logo_insert on storage.objects for insert to authenticated
with check (bucket_id = 'tenant-logos' and (storage.foldername(name))[1]::bigint is not null
  and public.is_barberia_role((storage.foldername(name))[1]::bigint, array['owner', 'admin']));
drop policy if exists tenant_logo_update on storage.objects;
create policy tenant_logo_update on storage.objects for update to authenticated
using (bucket_id = 'tenant-logos' and public.is_barberia_role((storage.foldername(name))[1]::bigint, array['owner', 'admin']))
with check (bucket_id = 'tenant-logos' and public.is_barberia_role((storage.foldername(name))[1]::bigint, array['owner', 'admin']));
drop policy if exists tenant_logo_delete on storage.objects;
create policy tenant_logo_delete on storage.objects for delete to authenticated
using (bucket_id = 'tenant-logos' and public.is_barberia_role((storage.foldername(name))[1]::bigint, array['owner', 'admin']));

create or replace function public.get_tenant_settings(p_barberia_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_barberia public.barberias%rowtype;
begin
  if not public.is_barberia_member(p_barberia_id) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  select * into v_barberia from public.barberias where id = p_barberia_id;
  if v_barberia.id is null then raise exception 'Negocio inexistente.' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v_barberia.id, 'nombre', v_barberia.nombre, 'descripcion', v_barberia.descripcion,
    'slug', v_barberia.slug, 'vertical', v_barberia.vertical, 'pais', v_barberia.pais, 'locale', v_barberia.locale,
    'zona_horaria', v_barberia.zona_horaria, 'moneda', v_barberia.moneda, 'direccion', v_barberia.direccion,
    'email', coalesce(v_barberia.email_contacto, v_barberia.billing_email), 'telefono', v_barberia.telefono_contacto,
    'whatsapp', v_barberia.whatsapp, 'logo_url', v_barberia.logo_url, 'logo_storage_path', v_barberia.logo_storage_path,
    'color_principal', v_barberia.color_principal, 'color_secundario', v_barberia.color_secundario,
    'reservas_publicas', v_barberia.reservas_publicas, 'politica_cancelacion', v_barberia.politica_cancelacion,
    'anticipacion_minutos', v_barberia.anticipacion_minutos, 'max_dias_reserva', v_barberia.max_dias_reserva,
    'intervalo_reserva_min', v_barberia.intervalo_reserva_min);
end; $$;

create or replace function public.update_tenant_settings(
  p_barberia_id bigint, p_nombre text, p_descripcion text, p_slug text, p_vertical text,
  p_pais text, p_locale text, p_zona_horaria text, p_moneda text, p_direccion text,
  p_email text, p_telefono text, p_whatsapp text, p_logo_url text, p_logo_storage_path text,
  p_color_principal text, p_color_secundario text, p_reservas_publicas boolean,
  p_politica_cancelacion text, p_anticipacion_minutos integer, p_max_dias_reserva integer,
  p_intervalo_reserva_min integer
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_barberia public.barberias%rowtype; v_slug text := lower(btrim(p_slug));
begin
  if not public.is_barberia_role(p_barberia_id, array['owner', 'admin']) then raise exception 'Sólo owner/admin puede editar la configuración.' using errcode = '42501'; end if;
  if btrim(coalesce(p_nombre, '')) !~ '^[[:alnum:]][[:alnum:] .&''-]{1,79}$' then raise exception 'Nombre de negocio inválido.' using errcode = '22023'; end if;
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(v_slug) > 80 then raise exception 'Slug inválido.' using errcode = '22023'; end if;
  if exists (select 1 from public.barberias where slug = v_slug and id <> p_barberia_id) then raise exception 'Ese slug ya está en uso.' using errcode = '23505'; end if;
  if p_email is not null and btrim(p_email) <> '' and p_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Email inválido.' using errcode = '22023'; end if;
  if p_logo_url is not null and btrim(p_logo_url) <> '' and p_logo_url !~* '^https?://' then raise exception 'Logo inválido.' using errcode = '22023'; end if;
  if p_color_principal is not null and p_color_principal !~* '^#[0-9a-f]{6}$' then raise exception 'Color principal inválido.' using errcode = '22023'; end if;
  if p_color_secundario is not null and p_color_secundario !~* '^#[0-9a-f]{6}$' then raise exception 'Color secundario inválido.' using errcode = '22023'; end if;
  if p_zona_horaria is null or not exists (select 1 from pg_timezone_names where name = btrim(p_zona_horaria)) then raise exception 'Zona horaria inválida.' using errcode = '22023'; end if;
  if p_anticipacion_minutos not between 0 and 10080 or p_max_dias_reserva not between 1 and 365 or p_intervalo_reserva_min not between 5 and 120 then raise exception 'Parámetros de reserva inválidos.' using errcode = '22023'; end if;
  update public.barberias set nombre = btrim(p_nombre), descripcion = nullif(btrim(p_descripcion), ''), slug = v_slug,
    vertical = lower(btrim(p_vertical)), pais = upper(btrim(p_pais)), locale = lower(btrim(p_locale)), zona_horaria = btrim(p_zona_horaria),
    moneda = upper(btrim(p_moneda)), direccion = nullif(btrim(p_direccion), ''), email_contacto = lower(nullif(btrim(p_email), '')),
    billing_email = coalesce(lower(nullif(btrim(p_email), '')), billing_email), telefono_contacto = nullif(btrim(p_telefono), ''),
    whatsapp = nullif(btrim(p_whatsapp), ''), logo_url = nullif(btrim(p_logo_url), ''), logo_storage_path = nullif(btrim(p_logo_storage_path), ''),
    color_principal = coalesce(nullif(btrim(p_color_principal), ''), color_principal), color_secundario = coalesce(nullif(btrim(p_color_secundario), ''), color_secundario),
    reservas_publicas = coalesce(p_reservas_publicas, true), politica_cancelacion = nullif(btrim(p_politica_cancelacion), ''),
    anticipacion_minutos = p_anticipacion_minutos, max_dias_reserva = p_max_dias_reserva, intervalo_reserva_min = p_intervalo_reserva_min
  where id = p_barberia_id returning * into v_barberia;
  insert into public.saas_audit_log (event_key, event_name, user_id, barberia_id, metadata)
  values ('tenant_settings:' || p_barberia_id || ':' || extract(epoch from clock_timestamp())::bigint, 'tenant_settings_updated', auth.uid(), p_barberia_id, jsonb_build_object('slug', v_slug)) ;
  return public.get_tenant_settings(p_barberia_id);
end; $$;

create or replace function public.create_barberia_invitation(p_barberia_id bigint, p_email text, p_role text, p_expires_days integer default 7)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''); v_id bigint; v_expires timestamptz;
begin
  if not public.is_barberia_role(p_barberia_id, array['owner', 'admin']) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  if lower(btrim(p_email)) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Email inválido.' using errcode = '22023'; end if;
  if p_role not in ('admin', 'recepcionista', 'empleado', 'readonly', 'barbero') then raise exception 'Rol inválido.' using errcode = '22023'; end if;
  if exists (select 1 from public.barberia_invitaciones where barberia_id = p_barberia_id and lower(email) = lower(btrim(p_email)) and status = 'pending' and expires_at > now()) then raise exception 'Ya existe una invitación pendiente para ese email.' using errcode = '23505'; end if;
  v_expires := now() + make_interval(days => greatest(1, least(coalesce(p_expires_days, 7), 30)));
  insert into public.barberia_invitaciones (barberia_id, email, role, token_hash, expires_at, invited_by)
  values (p_barberia_id, lower(btrim(p_email)), p_role, md5(v_token), v_expires, auth.uid()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'email', lower(btrim(p_email)), 'role', p_role, 'token', v_token, 'expires_at', v_expires);
end; $$;

create or replace function public.accept_barberia_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_inv public.barberia_invitaciones%rowtype; v_email text;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida.' using errcode = '28000'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into v_inv from public.barberia_invitaciones where token_hash = md5(btrim(p_token)) for update;
  if v_inv.id is null or v_inv.status <> 'pending' or v_inv.expires_at <= now() then raise exception 'La invitación no es válida o expiró.' using errcode = '22023'; end if;
  if lower(v_inv.email) <> coalesce(v_email, '') then raise exception 'La invitación pertenece a otro email.' using errcode = '42501'; end if;
  insert into public.barberia_members (barberia_id, user_id, role) values (v_inv.barberia_id, auth.uid(), v_inv.role) on conflict (barberia_id, user_id) do update set role = case when public.barberia_members.role = 'owner' then 'owner' else excluded.role end;
  update public.barberia_invitaciones set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = v_inv.id;
  insert into public.saas_audit_log (event_key, event_name, user_id, barberia_id, metadata) values ('invitation_accepted:' || v_inv.id, 'invitation_accepted', auth.uid(), v_inv.barberia_id, jsonb_build_object('role', v_inv.role));
  return jsonb_build_object('barberia_id', v_inv.barberia_id, 'role', v_inv.role);
end; $$;

create or replace function public.reject_barberia_invitation(p_token text)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_email text;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida.' using errcode = '28000'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  update public.barberia_invitaciones set status = 'rejected', updated_at = now()
  where token_hash = md5(btrim(p_token)) and status = 'pending' and lower(email) = coalesce(v_email, '');
  return found;
end; $$;

create or replace function public.transfer_barberia_ownership(p_barberia_id bigint, p_new_owner uuid, p_confirm boolean)
returns boolean language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_old_owner uuid;
begin
  if not p_confirm or not public.is_barberia_role(p_barberia_id, array['owner']) then raise exception 'Confirmación o permisos insuficientes.' using errcode = '42501'; end if;
  if not exists (select 1 from public.barberia_members where barberia_id = p_barberia_id and user_id = p_new_owner) then raise exception 'El nuevo owner debe ser miembro del negocio.' using errcode = '22023'; end if;
  select user_id into v_old_owner from public.barberia_members where barberia_id = p_barberia_id and role = 'owner' limit 1;
  update public.barberia_members set role = 'admin' where barberia_id = p_barberia_id and user_id = v_old_owner;
  update public.barberia_members set role = 'owner' where barberia_id = p_barberia_id and user_id = p_new_owner;
  insert into public.saas_audit_log (event_key, event_name, user_id, barberia_id, metadata) values ('ownership_transfer:' || p_barberia_id || ':' || extract(epoch from clock_timestamp())::bigint, 'ownership_transferred', auth.uid(), p_barberia_id, jsonb_build_object('new_owner', p_new_owner));
  return true;
end; $$;

create or replace function public.record_product_event(p_event_name text, p_barberia_id bigint default null, p_environment text default 'production', p_source text default 'app', p_metadata jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id bigint;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida.' using errcode = '28000'; end if;
  if p_barberia_id is not null and not (public.is_platform_member() or public.is_barberia_member(p_barberia_id)) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  insert into public.saas_product_events (event_name, environment, user_id, barberia_id, source, metadata) values (left(btrim(p_event_name), 100), coalesce(nullif(p_environment, ''), 'production'), auth.uid(), p_barberia_id, left(coalesce(nullif(p_source, ''), 'app'), 80), coalesce(p_metadata, '{}'::jsonb)) returning id into v_id;
  return v_id;
end; $$;

-- La reserva pública ahora respeta la configuración central del tenant.
create or replace function public.catalogo_reserva_publica(p_slug text)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('barberia', jsonb_build_object('nombre', b.nombre, 'slug', b.slug, 'logo_url', b.logo_url, 'color_principal', b.color_principal, 'color_secundario', b.color_secundario, 'whatsapp', b.whatsapp, 'direccion', b.direccion, 'zona_horaria', b.zona_horaria, 'reservas_publicas', b.reservas_publicas, 'max_dias_reserva', b.max_dias_reserva), 'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'descripcion', s.descripcion, 'precio', s.precio, 'duracion_min', s.duracion_min) order by s.nombre) from public.servicios s where s.barberia_id = b.id and s.activo and exists (select 1 from public.barbero_servicios bs join public.barberos br on br.id = bs.barbero_id where bs.servicio_id = s.id and br.activo)), '[]'::jsonb))
  from public.barberias b where b.slug = p_slug and b.reservas_publicas = true;
$$;

revoke all on function public.get_tenant_settings(bigint), public.update_tenant_settings(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text,integer,integer,integer) from public, anon;
grant execute on function public.get_tenant_settings(bigint), public.update_tenant_settings(bigint,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,boolean,text,integer,integer,integer) to authenticated;
revoke all on function public.create_barberia_invitation(bigint,text,text,integer), public.accept_barberia_invitation(text), public.reject_barberia_invitation(text), public.transfer_barberia_ownership(bigint,uuid,boolean), public.record_product_event(text,bigint,text,text,jsonb) from public, anon;
grant execute on function public.create_barberia_invitation(bigint,text,text,integer), public.accept_barberia_invitation(text), public.reject_barberia_invitation(text), public.transfer_barberia_ownership(bigint,uuid,boolean), public.record_product_event(text,bigint,text,text,jsonb) to authenticated;

grant select, insert, update on public.barberia_invitaciones to authenticated;
grant select, insert, update on public.crm_agent_drafts to authenticated;
grant select, insert on public.saas_product_events to authenticated;
grant select on public.saas_audit_log to authenticated;

commit;
