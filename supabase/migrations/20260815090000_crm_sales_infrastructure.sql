-- Infraestructura comercial autoritativa para Sales Agent.
-- Aditiva, idempotente y sin proveedores externos ni envíos.
-- Las operaciones de escritura pasan por funciones SECURITY DEFINER que
-- validan platform_members y conservan los valores originales.
begin;

-- Valores originales y sus representaciones deterministas para deduplicación.
alter table public.crm_negocios add column if not exists ciudad text;
alter table public.crm_negocios add column if not exists provincia text;
alter table public.crm_negocios add column if not exists dominio text;
alter table public.crm_negocios add column if not exists instagram text;
alter table public.crm_negocios add column if not exists business_name_normalized text;
alter table public.crm_negocios add column if not exists email_normalized text;
alter table public.crm_negocios add column if not exists phone_normalized text;
alter table public.crm_negocios add column if not exists domain_normalized text;
alter table public.crm_negocios add column if not exists instagram_normalized text;
alter table public.crm_negocios add column if not exists city_normalized text;
alter table public.crm_negocios add column if not exists substage text;
alter table public.crm_negocios add column if not exists verification_quality text not null default 'unknown';

alter table public.crm_leads add column if not exists email_normalized text;
alter table public.crm_leads add column if not exists phone_normalized text;
alter table public.crm_leads add column if not exists domain text;
alter table public.crm_leads add column if not exists instagram text;
alter table public.crm_leads add column if not exists domain_normalized text;
alter table public.crm_leads add column if not exists instagram_normalized text;
alter table public.crm_leads add column if not exists substage text;
alter table public.crm_leads add column if not exists verification_quality text not null default 'unknown';
alter table public.crm_leads add column if not exists primary_source text;
alter table public.crm_leads add column if not exists secondary_source text;
alter table public.crm_leads add column if not exists verified_at timestamptz;
alter table public.crm_leads add column if not exists recommended_channel text;
alter table public.crm_leads add column if not exists switching_friction text;
alter table public.crm_leads add column if not exists message_prepared text;

alter table public.crm_importaciones add column if not exists idempotency_key text;
alter table public.crm_importaciones add column if not exists environment text not null default 'production';
alter table public.crm_importaciones drop constraint if exists crm_importaciones_environment_check;
alter table public.crm_importaciones add constraint crm_importaciones_environment_check
  check (environment in ('sandbox','demo','production','internal'));
create unique index if not exists idx_crm_importaciones_idempotency
  on public.crm_importaciones(environment, idempotency_key)
  where idempotency_key is not null;

alter table public.crm_importacion_filas drop constraint if exists crm_importacion_filas_estado_check;
alter table public.crm_importacion_filas add constraint crm_importacion_filas_estado_check
  check (estado in ('ok','error','duplicate','likely_duplicate','dnc','invalid'));

alter table public.crm_actividades drop constraint if exists crm_actividades_tipo_check;
alter table public.crm_actividades add constraint crm_actividades_tipo_check check (tipo in (
  'stage_changed','assigned','score_changed','note','imported','exported','merged',
  'draft_reviewed','do_not_contact','research_updated','action_created','action_completed',
  'initial_contact','follow_up_1','follow_up_2','replied','interested','demo_sent','trial_requested'
));

create index if not exists idx_crm_negocios_normalized_email on public.crm_negocios(environment, email_normalized);
create index if not exists idx_crm_negocios_normalized_phone on public.crm_negocios(environment, phone_normalized);
create index if not exists idx_crm_negocios_normalized_domain on public.crm_negocios(environment, domain_normalized);
create index if not exists idx_crm_negocios_normalized_instagram on public.crm_negocios(environment, instagram_normalized);
create index if not exists idx_crm_negocios_normalized_name_city on public.crm_negocios(environment, business_name_normalized, city_normalized);
create index if not exists idx_crm_leads_normalized_email on public.crm_leads(environment, email_normalized);
create index if not exists idx_crm_leads_normalized_phone on public.crm_leads(environment, phone_normalized);
create index if not exists idx_crm_leads_normalized_domain on public.crm_leads(environment, domain_normalized);
create index if not exists idx_crm_leads_normalized_instagram on public.crm_leads(environment, instagram_normalized);
create index if not exists idx_crm_leads_queue on public.crm_leads(environment, pipeline_stage, substage, do_not_contact, score desc, verified_at desc);

create or replace function public.crm_normalize_email(p_value text)
returns text language sql immutable strict
as $$ select nullif(lower(btrim(p_value)), '') $$;

create or replace function public.crm_normalize_phone(p_value text)
returns text language plpgsql immutable
as $$
declare v text;
begin
  v := nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]', '', 'g'), '');
  if v is null then return null; end if;
  if left(v, 2) = '00' then v := substr(v, 3); end if;
  return nullif(v, '');
end;
$$;

create or replace function public.crm_fold_text(p_value text)
returns text language sql immutable
as $$
  select translate(lower(coalesce(p_value, '')), 'áéíóúüñàèìòùç', 'aeiouunaeiouc');
$$;

create or replace function public.crm_normalize_business_name(p_value text)
returns text language sql immutable
as $$
  select nullif(regexp_replace(btrim(regexp_replace(public.crm_fold_text(p_value), '[^a-z0-9]+', ' ', 'g')), '\s+', ' ', 'g'), '');
$$;

create or replace function public.crm_normalize_city(p_value text)
returns text language sql immutable
as $$ select public.crm_normalize_business_name(p_value) $$;

create or replace function public.crm_normalize_domain(p_value text)
returns text language plpgsql immutable
as $$
declare v text;
begin
  v := lower(btrim(coalesce(p_value, '')));
  v := regexp_replace(v, '^https?://', '');
  v := regexp_replace(v, '^www\.', '');
  v := split_part(split_part(split_part(v, '/', 1), '?', 1), '#', 1);
  return nullif(v, '');
end;
$$;

create or replace function public.crm_normalize_instagram(p_value text)
returns text language plpgsql immutable
as $$
declare v text;
begin
  v := lower(btrim(coalesce(p_value, '')));
  v := regexp_replace(v, '^https?://(www\.)?instagram\.com/', '');
  v := regexp_replace(v, '^@', '');
  v := split_part(split_part(v, '/', 1), '?', 1);
  return nullif(regexp_replace(v, '[^a-z0-9._]', '', 'g'), '');
end;
$$;

-- crm_leads conserva un estado conversacional legado separado del pipeline.
-- Esta función evita escribir etapas comerciales nuevas en el enum textual legado.
create or replace function public.crm_legacy_conversation_state(p_stage text)
returns text language sql immutable strict
as $$
  select case lower(btrim(p_stage))
    when 'contacted' then 'en_conversacion'
    when 'replied' then 'en_conversacion'
    when 'interested' then 'interesado'
    when 'qualified' then 'interesado'
    when 'demo' then 'convertido'
    when 'trial' then 'convertido'
    when 'won' then 'convertido'
    when 'lost' then 'no_interesado'
    when 'do_not_contact' then 'no_interesado'
    else 'nuevo'
  end;
$$;

create or replace function public.crm_normalize_record()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'crm_negocios' then
    new.business_name_normalized := public.crm_normalize_business_name(new.nombre);
    new.email_normalized := public.crm_normalize_email(new.email);
    new.phone_normalized := public.crm_normalize_phone(new.telefono);
    new.domain_normalized := public.crm_normalize_domain(coalesce(new.dominio, new.sitio_web));
    new.instagram_normalized := public.crm_normalize_instagram(new.instagram);
    new.city_normalized := public.crm_normalize_city(new.ciudad);
  elsif tg_table_name = 'crm_leads' then
    new.email_normalized := public.crm_normalize_email(new.email);
    new.phone_normalized := public.crm_normalize_phone(new.telefono);
    new.domain_normalized := public.crm_normalize_domain(new.domain);
    new.instagram_normalized := public.crm_normalize_instagram(new.instagram);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_crm_negocios_normalize on public.crm_negocios;
create trigger trg_crm_negocios_normalize before insert or update on public.crm_negocios
for each row execute function public.crm_normalize_record();
drop trigger if exists trg_crm_leads_normalize on public.crm_leads;
create trigger trg_crm_leads_normalize before insert or update on public.crm_leads
for each row execute function public.crm_normalize_record();

update public.crm_negocios
set business_name_normalized = public.crm_normalize_business_name(nombre),
    email_normalized = public.crm_normalize_email(email),
    phone_normalized = public.crm_normalize_phone(telefono),
    domain_normalized = public.crm_normalize_domain(coalesce(dominio, sitio_web)),
    instagram_normalized = public.crm_normalize_instagram(instagram),
    city_normalized = public.crm_normalize_city(ciudad)
where business_name_normalized is null
   or email_normalized is null and email is not null
   or phone_normalized is null and telefono is not null;
update public.crm_leads
set email_normalized = public.crm_normalize_email(email),
    phone_normalized = public.crm_normalize_phone(telefono),
    domain_normalized = public.crm_normalize_domain(domain),
    instagram_normalized = public.crm_normalize_instagram(instagram)
where email_normalized is null and email is not null
   or phone_normalized is null and telefono is not null;

create or replace function public.crm_find_duplicate_candidates(p_payload jsonb, p_environment text default 'production')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_environment text := coalesce(nullif(lower(btrim(p_environment)), ''), 'production');
  v_email text := public.crm_normalize_email(p_payload->>'email');
  v_phone text := public.crm_normalize_phone(p_payload->>'telefono');
  v_domain text := public.crm_normalize_domain(coalesce(p_payload->>'dominio', p_payload->>'sitio_web'));
  v_instagram text := public.crm_normalize_instagram(p_payload->>'instagram');
  v_name text := public.crm_normalize_business_name(coalesce(p_payload->>'negocio', p_payload->>'business_name'));
  v_city text := public.crm_normalize_city(coalesce(p_payload->>'ciudad', p_payload->>'city'));
  v_candidates jsonb := '[]'::jsonb;
  v_dnc boolean := false;
begin
  if not public.is_platform_member() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  if v_environment not in ('sandbox','demo','production','internal') then raise exception 'Entorno inválido.' using errcode = '22023'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'negocio_id', c.negocio_id, 'lead_id', c.lead_id, 'match_type', c.match_type,
    'matched_on', c.matched_on, 'do_not_contact', c.do_not_contact
  ) order by case c.match_type when 'EXACT_MATCH' then 1 else 2 end, c.negocio_id), '[]'::jsonb)
  into v_candidates
  from (
    select distinct on (n.id)
      n.id as negocio_id,
      l.id as lead_id,
      case when (v_email is not null and (n.email_normalized = v_email or l.email_normalized = v_email))
             or (v_phone is not null and (n.phone_normalized = v_phone or l.phone_normalized = v_phone))
             or (v_domain is not null and (n.domain_normalized = v_domain or l.domain_normalized = v_domain))
             or (v_instagram is not null and (n.instagram_normalized = v_instagram or l.instagram_normalized = v_instagram))
           then 'EXACT_MATCH' else 'LIKELY_MATCH' end as match_type,
      array_remove(array[
        case when v_email is not null and (n.email_normalized = v_email or l.email_normalized = v_email) then 'email' end,
        case when v_phone is not null and (n.phone_normalized = v_phone or l.phone_normalized = v_phone) then 'phone' end,
        case when v_domain is not null and (n.domain_normalized = v_domain or l.domain_normalized = v_domain) then 'domain' end,
        case when v_instagram is not null and (n.instagram_normalized = v_instagram or l.instagram_normalized = v_instagram) then 'instagram' end,
        case when v_name is not null and n.business_name_normalized = v_name and (v_city is null or n.city_normalized = v_city) then 'business_name_city' end
      ], null) as matched_on,
      (n.do_not_contact or coalesce(l.do_not_contact, false)) as do_not_contact
    from public.crm_negocios n
    left join public.crm_leads l on l.negocio_id = n.id
    where n.environment = v_environment
      and (
        (v_email is not null and (n.email_normalized = v_email or l.email_normalized = v_email))
        or (v_phone is not null and (n.phone_normalized = v_phone or l.phone_normalized = v_phone))
        or (v_domain is not null and (n.domain_normalized = v_domain or l.domain_normalized = v_domain))
        or (v_instagram is not null and (n.instagram_normalized = v_instagram or l.instagram_normalized = v_instagram))
        or (v_name is not null and n.business_name_normalized = v_name and v_city is not null and n.city_normalized = v_city)
      )
    order by n.id, case when (v_email is not null and (n.email_normalized = v_email or l.email_normalized = v_email))
      or (v_phone is not null and (n.phone_normalized = v_phone or l.phone_normalized = v_phone))
      or (v_domain is not null and (n.domain_normalized = v_domain or l.domain_normalized = v_domain))
      or (v_instagram is not null and (n.instagram_normalized = v_instagram or l.instagram_normalized = v_instagram)) then 1 else 2 end
  ) c;

  select exists (
    select 1 from public.crm_negocios n left join public.crm_leads l on l.negocio_id = n.id
    where n.environment = v_environment
      and (n.do_not_contact or coalesce(l.do_not_contact, false))
      and (
        (v_email is not null and (n.email_normalized = v_email or l.email_normalized = v_email))
        or (v_phone is not null and (n.phone_normalized = v_phone or l.phone_normalized = v_phone))
        or (v_domain is not null and (n.domain_normalized = v_domain or l.domain_normalized = v_domain))
        or (v_instagram is not null and (n.instagram_normalized = v_instagram or l.instagram_normalized = v_instagram))
      )
  ) into v_dnc;

  return jsonb_build_object(
    'environment', v_environment,
    'match_type', case when v_dnc then 'EXACT_MATCH' when v_candidates @> '[{"match_type":"EXACT_MATCH"}]'::jsonb then 'EXACT_MATCH' when jsonb_array_length(v_candidates) > 0 then 'LIKELY_MATCH' else 'NO_MATCH' end,
    'do_not_contact', v_dnc,
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.crm_upsert_researched_lead(p_payload jsonb, p_environment text default 'production')
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_environment text := coalesce(nullif(lower(btrim(p_environment)), ''), 'production');
  v_business_name text := nullif(btrim(coalesce(p_payload->>'negocio', p_payload->>'business_name')), '');
  v_city text := nullif(btrim(coalesce(p_payload->>'ciudad', p_payload->>'city')), '');
  v_province text := nullif(btrim(coalesce(p_payload->>'provincia', p_payload->>'province')), '');
  v_country text := nullif(upper(btrim(coalesce(p_payload->>'pais', p_payload->>'country'))), '');
  v_email text := public.crm_normalize_email(p_payload->>'email');
  v_phone text := public.crm_normalize_phone(coalesce(p_payload->>'telefono', p_payload->>'phone'));
  v_domain text := public.crm_normalize_domain(coalesce(p_payload->>'dominio', p_payload->>'domain', p_payload->>'sitio_web'));
  v_instagram text := public.crm_normalize_instagram(p_payload->>'instagram');
  v_name_normalized text := public.crm_normalize_business_name(v_business_name);
  v_city_normalized text := public.crm_normalize_city(v_city);
  v_match jsonb;
  v_candidate jsonb;
  v_business_id bigint;
  v_lead_id bigint;
  v_score integer := greatest(0, least(100, coalesce((p_payload->>'score')::integer, 0)));
  v_stage text := lower(coalesce(nullif(btrim(p_payload->>'pipeline_stage'), ''), 'discovered'));
  v_substage text := nullif(btrim(p_payload->>'substage'), '');
  v_dnc boolean := coalesce((p_payload->>'do_not_contact')::boolean, false);
  v_dedupe_key text := md5(v_environment || '|' || coalesce(v_email, v_phone, v_domain, v_instagram, v_name_normalized || '|' || coalesce(v_city_normalized, '')));
begin
  if not public.platform_can_write() then raise exception 'Sólo ventas o administración puede operar el CRM.' using errcode = '42501'; end if;
  if v_environment not in ('sandbox','demo','production','internal') then raise exception 'Entorno inválido.' using errcode = '22023'; end if;
  if v_business_name is null or v_name_normalized is null then raise exception 'El nombre del negocio es obligatorio.' using errcode = '22023'; end if;
  if v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Email inválido.' using errcode = '22023'; end if;
  if v_phone is not null and length(v_phone) < 7 then raise exception 'Teléfono inválido.' using errcode = '22023'; end if;
  if v_stage not in ('discovered','qualified','contacted','replied','interested','demo','trial','negotiating','won','lost','do_not_contact') then raise exception 'Etapa inválida.' using errcode = '22023'; end if;

  v_match := public.crm_find_duplicate_candidates(p_payload, v_environment);
  if coalesce((v_match->>'do_not_contact')::boolean, false) then
    return jsonb_build_object('status','blocked_dnc','match_type','EXACT_MATCH','environment',v_environment,'candidates',v_match->'candidates');
  end if;
  if v_match->>'match_type' = 'LIKELY_MATCH' then
    return jsonb_build_object('status','needs_review','match_type','LIKELY_MATCH','environment',v_environment,'candidates',v_match->'candidates');
  end if;

  if v_match->>'match_type' = 'EXACT_MATCH' then
    v_candidate := (v_match->'candidates')->0;
    v_business_id := nullif(v_candidate->>'negocio_id', '')::bigint;
    v_lead_id := nullif(v_candidate->>'lead_id', '')::bigint;
    update public.crm_negocios set email = coalesce(email, p_payload->>'email'), telefono = coalesce(telefono, p_payload->>'telefono'), sitio_web = coalesce(sitio_web, p_payload->>'sitio_web'), dominio = coalesce(dominio, p_payload->>'dominio'), instagram = coalesce(instagram, p_payload->>'instagram'), ciudad = coalesce(ciudad, v_city), provincia = coalesce(provincia, v_province), do_not_contact = do_not_contact or v_dnc, updated_at = now() where id = v_business_id;
    if v_lead_id is null then
      insert into public.crm_leads(negocio_id,nombre_contacto,cargo,email,telefono,canal_preferido,pipeline_stage,estado_conversacion,dedupe_key,environment,score,substage,primary_source,secondary_source,verified_at,recommended_channel,switching_friction,message_prepared,metadata)
      values(v_business_id,nullif(btrim(p_payload->>'nombre_contacto'),''),nullif(btrim(p_payload->>'cargo'),''),p_payload->>'email',p_payload->>'telefono',coalesce(nullif(lower(btrim(p_payload->>'canal_preferido')), ''),'manual'),v_stage,public.crm_legacy_conversation_state(v_stage),v_dedupe_key,v_environment,v_score,v_substage,p_payload->>'fuente_primaria',p_payload->>'fuente_secundaria',nullif(p_payload->>'verified_at','')::timestamptz,p_payload->>'canal_recomendado',p_payload->>'switching_friction',p_payload->>'mensaje_preparado',jsonb_build_object('import_source','researched_upsert')) returning id into v_lead_id;
    else
      update public.crm_leads set do_not_contact = do_not_contact or v_dnc, updated_at = now() where id = v_lead_id;
    end if;
    return jsonb_build_object('status','exact_match','match_type','EXACT_MATCH','environment',v_environment,'negocio_id',v_business_id,'lead_id',v_lead_id);
  end if;

  insert into public.crm_negocios(nombre,rubro,pais,idioma,email,telefono,canal_origen,sitio_web,notas,etapa,pipeline_stage,environment,metadata,ciudad,provincia,dominio,instagram,substage,verification_quality,do_not_contact)
  values(v_business_name,coalesce(nullif(btrim(p_payload->>'rubro'),''),'custom'),v_country,coalesce(nullif(lower(btrim(coalesce(p_payload->>'idioma',''))),''),'es'),p_payload->>'email',p_payload->>'telefono',coalesce(nullif(btrim(p_payload->>'fuente_primaria'),''),p_payload->>'canal_origen'),p_payload->>'sitio_web',p_payload->>'notas',case when v_stage='qualified' then 'calificado' else 'prospecto' end,v_stage,v_environment,jsonb_build_object('source_secondary',p_payload->>'fuente_secundaria','rating',p_payload->>'rating','reviews',p_payload->>'reviews','competidor',p_payload->>'competidor','external_reference',p_payload->>'external_reference'),v_city,v_province,coalesce(p_payload->>'dominio',p_payload->>'domain'),p_payload->>'instagram',v_substage,coalesce(nullif(p_payload->>'verification_quality',''),'unknown'),v_dnc)
  returning id into v_business_id;
  insert into public.crm_leads(negocio_id,nombre_contacto,cargo,email,telefono,canal_preferido,pipeline_stage,estado_conversacion,dedupe_key,environment,score,score_reasons,substage,verification_quality,primary_source,secondary_source,verified_at,recommended_channel,switching_friction,message_prepared,do_not_contact,metadata)
  values(v_business_id,nullif(btrim(p_payload->>'nombre_contacto'),''),nullif(btrim(p_payload->>'cargo'),''),p_payload->>'email',p_payload->>'telefono',coalesce(nullif(lower(btrim(coalesce(p_payload->>'canal_recomendado',p_payload->>'canal_preferido'))),''),'manual'),v_stage,public.crm_legacy_conversation_state(v_stage),v_dedupe_key,v_environment,v_score,coalesce(p_payload->'score_reasons','[]'::jsonb),v_substage,coalesce(nullif(p_payload->>'verification_quality',''),'unknown'),p_payload->>'fuente_primaria',p_payload->>'fuente_secundaria',nullif(p_payload->>'verified_at','')::timestamptz,p_payload->>'canal_recomendado',p_payload->>'switching_friction',p_payload->>'mensaje_preparado',v_dnc,jsonb_build_object('researched',true,'source_secondary',p_payload->>'fuente_secundaria'))
  returning id into v_lead_id;
  insert into public.crm_investigaciones(negocio_id,sitio_web,instagram,sistema_reservas,fuente,verificado_at,confianza,metadata)
  values(v_business_id,p_payload->>'sitio_web',p_payload->>'instagram',p_payload->>'sistema_reservas',p_payload->>'fuente_primaria',nullif(p_payload->>'verified_at','')::timestamptz,coalesce(nullif(p_payload->>'verification_quality',''),'unknown'),jsonb_build_object('rating',p_payload->>'rating','reviews',p_payload->>'reviews','competidor',p_payload->>'competidor','switching_friction',p_payload->>'switching_friction'))
  on conflict (negocio_id) do update set sitio_web=coalesce(excluded.sitio_web,crm_investigaciones.sitio_web), instagram=coalesce(excluded.instagram,crm_investigaciones.instagram), sistema_reservas=coalesce(excluded.sistema_reservas,crm_investigaciones.sistema_reservas), fuente=coalesce(excluded.fuente,crm_investigaciones.fuente), verificado_at=coalesce(excluded.verificado_at,crm_investigaciones.verificado_at), confianza=excluded.confianza, metadata=crm_investigaciones.metadata || excluded.metadata, updated_at=now();
  insert into public.crm_actividades(negocio_id,lead_id,tipo,resumen,metadata,actor_id) values(v_business_id,v_lead_id,'imported','Lead investigado incorporado',jsonb_build_object('environment',v_environment,'verification_quality',p_payload->>'verification_quality','source',p_payload->>'fuente_primaria'),auth.uid());
  return jsonb_build_object('status','created','match_type','NO_MATCH','environment',v_environment,'negocio_id',v_business_id,'lead_id',v_lead_id);
end;
$$;

create or replace function public.crm_preview_import(p_rows jsonb, p_environment text default 'production')
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare row jsonb; idx integer := 0; v_result jsonb; v_rows jsonb := '[]'::jsonb; v_counts jsonb := jsonb_build_object('new',0,'exact_duplicate',0,'likely_duplicate',0,'dnc',0,'invalid',0);
begin
  if not public.platform_can_write() then raise exception 'Sólo ventas o administración puede previsualizar imports.' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'El lote debe tener entre 1 y 500 filas.' using errcode = '22023'; end if;
  for row in select value from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    if nullif(btrim(coalesce(row->>'negocio','')),'') is null then
      v_result := jsonb_build_object('row',idx,'status','invalid','reason','Nombre de negocio obligatorio');
      v_counts := jsonb_set(v_counts,'{invalid}'::text[],to_jsonb((v_counts->>'invalid')::integer + 1));
    elsif (row->>'email') is not null and btrim(row->>'email') <> '' and (row->>'email') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_result := jsonb_build_object('row',idx,'status','invalid','reason','Email inválido');
      v_counts := jsonb_set(v_counts,'{invalid}'::text[],to_jsonb((v_counts->>'invalid')::integer + 1));
    elsif (row->>'telefono') is not null and length(public.crm_normalize_phone(row->>'telefono')) between 1 and 6 then
      v_result := jsonb_build_object('row',idx,'status','invalid','reason','Teléfono inválido');
      v_counts := jsonb_set(v_counts,'{invalid}'::text[],to_jsonb((v_counts->>'invalid')::integer + 1));
    else
      v_result := public.crm_find_duplicate_candidates(row, p_environment) || jsonb_build_object('row',idx,'status',case when (public.crm_find_duplicate_candidates(row,p_environment)->>'do_not_contact')::boolean then 'dnc' when public.crm_find_duplicate_candidates(row,p_environment)->>'match_type' = 'EXACT_MATCH' then 'exact_duplicate' when public.crm_find_duplicate_candidates(row,p_environment)->>'match_type' = 'LIKELY_MATCH' then 'likely_duplicate' else 'new' end);
      v_counts := jsonb_set(v_counts, (case v_result->>'status' when 'dnc' then '{dnc}' when 'exact_duplicate' then '{exact_duplicate}' when 'likely_duplicate' then '{likely_duplicate}' else '{new}' end)::text[], to_jsonb((v_counts->>(case v_result->>'status' when 'dnc' then 'dnc' when 'exact_duplicate' then 'exact_duplicate' when 'likely_duplicate' then 'likely_duplicate' else 'new' end))::integer + 1));
    end if;
    v_rows := v_rows || jsonb_build_array(v_result);
  end loop;
  return jsonb_build_object('environment',p_environment,'counts',v_counts,'rows',v_rows,'writes_performed',false);
end;
$$;

create or replace function public.crm_import_leads_batch(p_rows jsonb, p_filename text default null, p_environment text default 'production', p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_import_id bigint; row jsonb; idx integer := 0; v_result jsonb; v_status text; v_key text := coalesce(nullif(btrim(p_idempotency_key),''), md5(p_environment || '|' || p_rows::text)); v_ok integer := 0; v_errors integer := 0; v_duplicates integer := 0; v_likely integer := 0; v_dnc integer := 0;
begin
  if not public.platform_can_write() then raise exception 'Sólo ventas o administración puede importar leads.' using errcode = '42501'; end if;
  if p_environment not in ('sandbox','demo','production','internal') then raise exception 'Entorno inválido.' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then raise exception 'El lote debe tener entre 1 y 500 filas.' using errcode = '22023'; end if;
  select id into v_import_id from public.crm_importaciones where environment=p_environment and idempotency_key=v_key limit 1;
  if v_import_id is not null then
    select jsonb_build_object('import_id',id,'ok',filas_ok,'errors',filas_error,'duplicates',0,'likely_duplicates',0,'dnc',0,'environment',environment,'idempotent',true) into v_result from public.crm_importaciones where id=v_import_id;
    return v_result;
  end if;
  insert into public.crm_importaciones(archivo_nombre,filas_total,created_by,environment,idempotency_key) values(left(p_filename,180),jsonb_array_length(p_rows),auth.uid(),p_environment,v_key) returning id into v_import_id;
  for row in select value from jsonb_array_elements(p_rows) loop
    idx := idx + 1;
    begin
      v_result := public.crm_upsert_researched_lead(row, p_environment);
      v_status := case v_result->>'status' when 'created' then 'ok' when 'exact_match' then 'duplicate' when 'needs_review' then 'likely_duplicate' when 'blocked_dnc' then 'dnc' else 'error' end;
      if v_status='ok' then v_ok:=v_ok+1; elsif v_status='duplicate' then v_duplicates:=v_duplicates+1; elsif v_status='likely_duplicate' then v_likely:=v_likely+1; elsif v_status='dnc' then v_dnc:=v_dnc+1; else v_errors:=v_errors+1; end if;
      insert into public.crm_importacion_filas(importacion_id,numero_fila,estado,datos,error,lead_id) values(v_import_id,idx,v_status,row,case when v_status='likely_duplicate' then 'Requiere revisión manual antes de combinar.' when v_status='dnc' then 'Excluido por DO_NOT_CONTACT.' end,nullif(v_result->>'lead_id','')::bigint);
    exception when others then
      v_errors := v_errors + 1;
      insert into public.crm_importacion_filas(importacion_id,numero_fila,estado,datos,error) values(v_import_id,idx,'error',row,'Fila rechazada por validación server-side.');
    end;
  end loop;
  update public.crm_importaciones set filas_ok=v_ok, filas_error=v_errors, estado='completed', completed_at=now() where id=v_import_id;
  return jsonb_build_object('import_id',v_import_id,'ok',v_ok,'errors',v_errors,'duplicates',v_duplicates,'likely_duplicates',v_likely,'dnc',v_dnc,'environment',p_environment,'idempotent',false);
end;
$$;

create or replace function public.get_crm_outreach_queue(p_environment text default 'production', p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not public.is_platform_member() then raise exception 'No autorizado.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'lead_id',q.id,'negocio_id',q.negocio_id,'negocio',q.nombre,'ciudad',q.ciudad,'pais',q.pais,
    'score',q.score,'switching_friction',q.switching_friction,'canal',q.canal,
    'contacto',q.contacto,'verified_at',q.verified_at,'verification_quality',q.verification_quality,
    'do_not_contact',q.do_not_contact,'message_prepared',q.message_prepared,
    'substage',q.substage,'next_action',q.fecha_seguimiento_at
  )), '[]'::jsonb)
  into result
  from (
    select l.id,l.negocio_id,n.nombre,n.ciudad,n.pais,l.score,l.switching_friction,
      coalesce(l.recommended_channel,l.canal_preferido) as canal,coalesce(l.email,l.telefono) as contacto,
      l.verified_at,l.verification_quality,(l.do_not_contact or n.do_not_contact) as do_not_contact,
      l.message_prepared,l.substage,l.fecha_seguimiento_at
    from public.crm_leads l join public.crm_negocios n on n.id=l.negocio_id
    where l.environment=coalesce(nullif(lower(btrim(p_environment)),''),'production')
      and l.pipeline_stage='qualified' and l.substage='ready_to_contact'
      and not l.do_not_contact and not n.do_not_contact
      and l.message_prepared is not null
    order by l.score desc, case l.verification_quality when 'high' then 1 when 'medium' then 2 else 3 end, l.verified_at desc nulls last
    limit greatest(1, least(coalesce(p_limit,100),500))
  ) q;
  return result;
end;
$$;

create or replace function public.record_crm_outreach_activity(p_lead_id bigint, p_type text, p_channel text, p_result text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare l public.crm_leads%rowtype; v_type text := lower(btrim(p_type)); v_stage text;
begin
  if not public.platform_can_write() then raise exception 'Sólo ventas o administración puede registrar outreach.' using errcode = '42501'; end if;
  if v_type not in ('initial_contact','follow_up_1','follow_up_2','replied','interested','demo_sent','trial_requested') then raise exception 'Tipo de outreach inválido.' using errcode = '22023'; end if;
  select * into l from public.crm_leads where id=p_lead_id for update;
  if l.id is null then raise exception 'Lead inexistente.' using errcode = 'P0002'; end if;
  if l.do_not_contact then return jsonb_build_object('status','blocked_dnc','lead_id',l.id); end if;
  if v_type in ('follow_up_1','follow_up_2') and exists(select 1 from public.crm_interacciones where lead_id=l.id and direccion='entrante') then
    return jsonb_build_object('status','follow_up_stopped_by_reply','lead_id',l.id);
  end if;
  v_stage := case v_type when 'initial_contact' then 'contacted' when 'replied' then 'replied' when 'interested' then 'interested' when 'demo_sent' then 'demo' when 'trial_requested' then 'trial' else l.pipeline_stage end;
  insert into public.crm_interacciones(lead_id,canal,direccion,resumen,metadata,created_by) values(l.id,coalesce(nullif(btrim(p_channel),''),'manual'),case when v_type='replied' then 'entrante' else 'saliente' end,coalesce(p_result,v_type),jsonb_build_object('outreach_type',v_type,'notes',p_notes),auth.uid());
  update public.crm_leads set pipeline_stage=v_stage, estado_conversacion=public.crm_legacy_conversation_state(v_stage), updated_at=now() where id=l.id;
  insert into public.crm_actividades(lead_id,tipo,etapa_anterior,etapa_nueva,resumen,metadata,actor_id) values(l.id,v_type,l.pipeline_stage,v_stage,'Actividad de outreach registrada',jsonb_build_object('channel',p_channel,'result',p_result,'notes',p_notes),auth.uid());
  return jsonb_build_object('status','recorded','lead_id',l.id,'stage',v_stage,'external_send_performed',false);
end;
$$;

revoke all on function public.crm_normalize_email(text), public.crm_normalize_phone(text), public.crm_fold_text(text), public.crm_normalize_business_name(text), public.crm_normalize_city(text), public.crm_normalize_domain(text), public.crm_normalize_instagram(text), public.crm_find_duplicate_candidates(jsonb,text), public.crm_upsert_researched_lead(jsonb,text), public.crm_preview_import(jsonb,text), public.crm_import_leads_batch(jsonb,text,text,text), public.get_crm_outreach_queue(text,integer), public.record_crm_outreach_activity(bigint,text,text,text,text) from public, anon;
grant execute on function public.crm_find_duplicate_candidates(jsonb,text), public.crm_upsert_researched_lead(jsonb,text), public.crm_preview_import(jsonb,text), public.crm_import_leads_batch(jsonb,text,text,text), public.get_crm_outreach_queue(text,integer), public.record_crm_outreach_activity(bigint,text,text,text,text) to authenticated;

commit;
