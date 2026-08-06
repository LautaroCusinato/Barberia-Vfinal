-- CRM comercial completo: datos estructurados, scoring explicable, importación
-- idempotente y pipeline. No contacta terceros ni activa automatizaciones.
begin;

alter table public.crm_negocios add column if not exists pipeline_stage text;
alter table public.crm_negocios add column if not exists prioridad text not null default 'normal';
alter table public.crm_negocios add column if not exists score integer not null default 0;
alter table public.crm_negocios add column if not exists score_level text not null default 'low';
alter table public.crm_negocios add column if not exists score_reasons jsonb not null default '[]'::jsonb;
alter table public.crm_negocios add column if not exists score_updated_at timestamptz;
alter table public.crm_negocios add column if not exists responsable_id uuid references auth.users(id) on delete set null;
alter table public.crm_negocios add column if not exists tags text[] not null default '{}';
alter table public.crm_negocios add column if not exists fecha_seguimiento_at timestamptz;
alter table public.crm_negocios add column if not exists motivo_perdida text;
alter table public.crm_negocios add column if not exists environment text not null default 'production';

alter table public.crm_leads add column if not exists pipeline_stage text;
alter table public.crm_leads add column if not exists prioridad text not null default 'normal';
alter table public.crm_leads add column if not exists score integer not null default 0;
alter table public.crm_leads add column if not exists score_level text not null default 'low';
alter table public.crm_leads add column if not exists score_reasons jsonb not null default '[]'::jsonb;
alter table public.crm_leads add column if not exists score_updated_at timestamptz;
alter table public.crm_leads add column if not exists tags text[] not null default '{}';
alter table public.crm_leads add column if not exists fecha_seguimiento_at timestamptz;
alter table public.crm_leads add column if not exists motivo_perdida text;
alter table public.crm_leads add column if not exists dedupe_key text;
alter table public.crm_leads add column if not exists environment text not null default 'production';

update public.crm_negocios set pipeline_stage = case lower(coalesce(etapa, 'prospecto'))
  when 'contactado' then 'contacted' when 'calificado' then 'qualified' when 'interesado' then 'interested'
  when 'prueba' then 'trial' when 'negociando' then 'negotiating' when 'cliente' then 'won'
  when 'perdido' then 'lost' when 'pausado' then 'lost' when 'do_not_contact' then 'do_not_contact'
  when 'demo' then 'demo' else 'discovered' end
where pipeline_stage is null;
update public.crm_leads set pipeline_stage = case lower(coalesce(estado_conversacion, 'nuevo'))
  when 'contacted' then 'contacted' when 'en_conversacion' then 'contacted' when 'esperando' then 'contacted'
  when 'replied' then 'replied' when 'interesado' then 'interested' when 'interested' then 'interested'
  when 'demo' then 'demo' when 'trial' then 'trial' when 'convertido' then 'won' when 'won' then 'won'
  when 'no_interesado' then 'lost' when 'lost' then 'lost' when 'do_not_contact' then 'do_not_contact'
  else 'discovered' end
where pipeline_stage is null;

alter table public.crm_negocios drop constraint if exists crm_negocios_pipeline_stage_check;
alter table public.crm_negocios add constraint crm_negocios_pipeline_stage_check check (pipeline_stage in ('discovered','qualified','contacted','replied','interested','demo','trial','negotiating','won','lost','do_not_contact'));
alter table public.crm_leads drop constraint if exists crm_leads_pipeline_stage_check;
alter table public.crm_leads add constraint crm_leads_pipeline_stage_check check (pipeline_stage in ('discovered','qualified','contacted','replied','interested','demo','trial','negotiating','won','lost','do_not_contact'));
alter table public.crm_negocios drop constraint if exists crm_negocios_prioridad_check;
alter table public.crm_negocios add constraint crm_negocios_prioridad_check check (prioridad in ('low','normal','high','urgent'));
alter table public.crm_leads drop constraint if exists crm_leads_prioridad_check;
alter table public.crm_leads add constraint crm_leads_prioridad_check check (prioridad in ('low','normal','high','urgent'));
alter table public.crm_negocios drop constraint if exists crm_negocios_environment_check;
alter table public.crm_negocios add constraint crm_negocios_environment_check check (environment in ('sandbox','demo','production','internal'));
alter table public.crm_leads drop constraint if exists crm_leads_environment_check;
alter table public.crm_leads add constraint crm_leads_environment_check check (environment in ('sandbox','demo','production','internal'));

create unique index if not exists idx_crm_leads_dedupe_key on public.crm_leads(dedupe_key) where dedupe_key is not null;
create index if not exists idx_crm_leads_pipeline on public.crm_leads(pipeline_stage, prioridad, updated_at desc);
create index if not exists idx_crm_leads_followup on public.crm_leads(fecha_seguimiento_at, pipeline_stage);
create index if not exists idx_crm_leads_score on public.crm_leads(score desc);
create index if not exists idx_crm_negocios_pipeline on public.crm_negocios(environment, pipeline_stage, prioridad, updated_at desc);
create index if not exists idx_crm_leads_environment on public.crm_leads(environment, pipeline_stage, updated_at desc);

create table if not exists public.crm_investigaciones (
  id bigint generated always as identity primary key,
  negocio_id bigint not null unique references public.crm_negocios(id) on delete cascade,
  sitio_web text, instagram text, facebook text, linkedin text, google_maps text,
  directorios jsonb not null default '[]'::jsonb,
  servicios jsonb not null default '[]'::jsonb,
  horarios jsonb not null default '{}'::jsonb,
  empleados_estimados integer check (empleados_estimados is null or empleados_estimados >= 0),
  sistema_reservas text, whatsapp text, problemas_observables jsonb not null default '[]'::jsonb,
  oportunidades jsonb not null default '[]'::jsonb, fuente text, verificado_at timestamptz,
  confianza text not null default 'unknown' check (confianza in ('unknown','low','medium','high')),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.crm_actividades (
  id bigint generated always as identity primary key,
  negocio_id bigint references public.crm_negocios(id) on delete cascade,
  lead_id bigint references public.crm_leads(id) on delete cascade,
  tipo text not null check (tipo in ('stage_changed','assigned','score_changed','note','imported','exported','merged','draft_reviewed','do_not_contact','research_updated','action_created','action_completed')),
  etapa_anterior text, etapa_nueva text, resumen text, metadata jsonb not null default '{}'::jsonb,
  actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  check (negocio_id is not null or lead_id is not null)
);
create index if not exists idx_crm_actividades_lead on public.crm_actividades(lead_id, created_at desc);
create index if not exists idx_crm_actividades_business on public.crm_actividades(negocio_id, created_at desc);

create table if not exists public.crm_notas (
  id bigint generated always as identity primary key,
  negocio_id bigint references public.crm_negocios(id) on delete cascade,
  lead_id bigint references public.crm_leads(id) on delete cascade,
  contenido text not null check (length(btrim(contenido)) between 1 and 5000),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  check (negocio_id is not null or lead_id is not null)
);
create table if not exists public.crm_adjuntos (
  id bigint generated always as identity primary key,
  negocio_id bigint references public.crm_negocios(id) on delete cascade,
  lead_id bigint references public.crm_leads(id) on delete cascade,
  nombre text not null, storage_path text, mime_type text, size_bytes bigint,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  check (negocio_id is not null or lead_id is not null)
);

create table if not exists public.crm_acciones (
  id bigint generated always as identity primary key,
  negocio_id bigint references public.crm_negocios(id) on delete cascade,
  lead_id bigint references public.crm_leads(id) on delete cascade,
  titulo text not null check (length(btrim(titulo)) between 1 and 160),
  notas text, responsable_id uuid references auth.users(id) on delete set null,
  prioridad text not null default 'normal' check (prioridad in ('low','normal','high','urgent')),
  estado text not null default 'pending' check (estado in ('pending','completed','canceled')),
  vence_at timestamptz, recordatorio_at timestamptz, created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (negocio_id is not null or lead_id is not null)
);
create index if not exists idx_crm_acciones_due on public.crm_acciones(estado, vence_at, prioridad);
create or replace function public.crm_action_audit()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$ begin insert into public.crm_actividades(negocio_id,lead_id,tipo,resumen,metadata,actor_id) values(new.negocio_id,new.lead_id,case when tg_op='INSERT' then 'action_created' else case when new.estado='completed' then 'action_completed' else 'action_created' end end,case when tg_op='INSERT' then 'Seguimiento creado' else 'Seguimiento actualizado' end,jsonb_build_object('action_id',new.id,'estado',new.estado,'vence_at',new.vence_at),auth.uid()); return new; end $$;
drop trigger if exists trg_crm_action_audit on public.crm_acciones;
create trigger trg_crm_action_audit after insert or update on public.crm_acciones for each row execute function public.crm_action_audit();

create table if not exists public.crm_importaciones (
  id bigint generated always as identity primary key, archivo_nombre text, filas_total integer not null default 0,
  filas_ok integer not null default 0, filas_error integer not null default 0, estado text not null default 'processing' check (estado in ('processing','completed','failed')),
  source text not null default 'csv', created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), completed_at timestamptz
);
create table if not exists public.crm_importacion_filas (
  id bigint generated always as identity primary key, importacion_id bigint not null references public.crm_importaciones(id) on delete cascade,
  numero_fila integer not null, estado text not null check (estado in ('ok','error','duplicate')),
  datos jsonb not null default '{}'::jsonb, error text, lead_id bigint references public.crm_leads(id) on delete set null, created_at timestamptz not null default now(),
  unique(importacion_id, numero_fila)
);
create table if not exists public.crm_merge_log (
  id bigint generated always as identity primary key, entidad text not null default 'lead' check (entidad in ('lead','business')),
  keep_id bigint not null, merged_ids bigint[] not null, reason text, actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);

alter table public.crm_agent_drafts drop constraint if exists crm_agent_drafts_estado_check;
alter table public.crm_agent_drafts add constraint crm_agent_drafts_estado_check check (estado in ('pending_research','ready_for_draft','pending_approval','approved','rejected','sent','replied','closed','canceled'));
alter table public.crm_agent_drafts drop constraint if exists crm_agent_drafts_tipo_check;
alter table public.crm_agent_drafts add constraint crm_agent_drafts_tipo_check check (tipo in ('email_inicial','seguimiento','seguimiento_1','seguimiento_2','interesado','demo','trial','recordatorio_trial','precio','tiempo','sistema_actual','objecion','cierre','reactivacion'));

create or replace function public.platform_role()
returns text language sql stable security definer set search_path=public,pg_temp
as $$ select role from public.platform_members where user_id = auth.uid() limit 1 $$;
create or replace function public.platform_can_write()
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce(public.platform_role() in ('owner','admin','sales','automation'), false) $$;
create or replace function public.platform_can_export()
returns boolean language sql stable security definer set search_path=public,pg_temp
as $$ select coalesce(public.platform_role() in ('owner','admin','sales'), false) $$;

alter table public.crm_investigaciones enable row level security;
alter table public.crm_actividades enable row level security;
alter table public.crm_notas enable row level security;
alter table public.crm_adjuntos enable row level security;
alter table public.crm_acciones enable row level security;
alter table public.crm_importaciones enable row level security;
alter table public.crm_importacion_filas enable row level security;
alter table public.crm_merge_log enable row level security;

drop policy if exists crm_negocios_platform_all on public.crm_negocios;
create policy crm_negocios_platform_read on public.crm_negocios for select to authenticated using (public.is_platform_member());
create policy crm_negocios_platform_write on public.crm_negocios for all to authenticated using (public.platform_can_write()) with check (public.platform_can_write());
drop policy if exists crm_leads_platform_all on public.crm_leads;
create policy crm_leads_platform_read on public.crm_leads for select to authenticated using (public.is_platform_member());
create policy crm_leads_platform_write on public.crm_leads for all to authenticated using (public.platform_can_write()) with check (public.platform_can_write());
drop policy if exists crm_agent_drafts_platform on public.crm_agent_drafts;
create policy crm_agent_drafts_platform_read on public.crm_agent_drafts for select to authenticated using (public.is_platform_member());
create policy crm_agent_drafts_platform_write on public.crm_agent_drafts for all to authenticated using (public.platform_can_write()) with check (public.platform_can_write());
do $$
declare t text;
begin
  foreach t in array array['crm_investigaciones','crm_actividades','crm_notas','crm_adjuntos','crm_acciones','crm_importaciones','crm_importacion_filas','crm_merge_log'] loop
    execute format('drop policy if exists %I_platform_read on public.%I', t, t);
    execute format('create policy %I_platform_read on public.%I for select to authenticated using (public.is_platform_member())', t, t);
    execute format('drop policy if exists %I_platform_write on public.%I', t, t);
    execute format('create policy %I_platform_write on public.%I for all to authenticated using (public.platform_can_write()) with check (public.platform_can_write())', t, t);
  end loop;
end $$;

grant execute on function public.platform_role(), public.platform_can_write(), public.platform_can_export() to authenticated;
grant select, insert, update, delete on public.crm_investigaciones, public.crm_actividades, public.crm_notas, public.crm_adjuntos, public.crm_acciones, public.crm_importaciones, public.crm_importacion_filas, public.crm_merge_log to authenticated;

create or replace function public.calculate_crm_lead_score(p_lead_id bigint)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare l public.crm_leads%rowtype; n public.crm_negocios%rowtype; i public.crm_investigaciones%rowtype; total integer := 0; reasons jsonb := '[]'::jsonb; has_contact boolean;
begin
  if not public.platform_can_write() then raise exception 'No autorizado.' using errcode='42501'; end if;
  select * into l from public.crm_leads where id=p_lead_id for update;
  if l.id is null then raise exception 'Lead inexistente.' using errcode='P0002'; end if;
  select * into n from public.crm_negocios where id=l.negocio_id;
  select * into i from public.crm_investigaciones where negocio_id=n.id;
  has_contact := nullif(btrim(coalesce(l.email,'')),'') is not null or nullif(btrim(coalesce(l.telefono,'')),'') is not null;
  if lower(coalesce(n.rubro,'')) in ('barberia','peluqueria','salon','spa','estetica','tattoo') then total:=total+20; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','vertical_compatible','points',20,'reason','Rubro compatible con el producto')); end if;
  if upper(coalesce(n.pais,'')) in ('AR','UY','CL','MX','CO','PE') then total:=total+10; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','target_country','points',10,'reason','País dentro del mercado objetivo')); end if;
  if lower(coalesce(n.idioma,l.metadata->>'idioma','')) like 'es%' or lower(coalesce(n.idioma,l.metadata->>'idioma','')) like 'en%' then total:=total+5; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','language','points',5,'reason','Idioma soportado')); end if;
  if nullif(btrim(coalesce(n.sitio_web,i.sitio_web,'')),'') is not null then total:=total+10; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','web_presence','points',10,'reason','Tiene presencia web verificable')); end if;
  if nullif(btrim(coalesce(i.whatsapp,n.telefono,l.telefono,'')),'') is not null then total:=total+10; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','whatsapp','points',10,'reason','Tiene canal WhatsApp o teléfono')); end if;
  if coalesce((i.metadata->>'has_booking_system')::boolean,false) then total:=total+15; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','existing_booking','points',15,'reason','Ya utiliza un sistema de reservas')); end if;
  if coalesce(i.empleados_estimados,0) >= 3 then total:=total+8; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','team_size','points',8,'reason','Equipo con tres o más personas')); end if;
  if jsonb_array_length(coalesce(i.problemas_observables,'[]'::jsonb)) > 0 then total:=total+12; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','need_signal','points',12,'reason','Hay problemas observables registrados')); end if;
  if has_contact then total:=total+10; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','contact_quality','points',10,'reason','Contacto con email o teléfono')); end if;
  if l.pipeline_stage in ('replied','interested','demo','trial') then total:=total+10; reasons:=reasons||jsonb_build_array(jsonb_build_object('key','previous_activity','points',10,'reason','Existe actividad o respuesta previa')); end if;
  total := least(total,100);
  update public.crm_leads set score=total, score_level=case when total>=70 then 'high' when total>=40 then 'medium' else 'low' end, score_reasons=reasons, score_updated_at=now(), updated_at=now() where id=l.id;
  insert into public.crm_actividades(lead_id,tipo,resumen,metadata,actor_id) values(l.id,'score_changed','Score recalculado',jsonb_build_object('score',total,'reasons',reasons,'environment',l.environment),auth.uid());
  return jsonb_build_object('score',total,'level',case when total>=70 then 'high' when total>=40 then 'medium' else 'low' end,'reasons',reasons,'recommendation',case when total>=70 then 'Priorizar contacto personalizado' when total>=40 then 'Completar investigación y preparar borrador' else 'Completar datos antes de contactar' end);
end $$;

create or replace function public.set_crm_lead_stage(p_lead_id bigint, p_stage text, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare l public.crm_leads%rowtype; old_stage text; new_stage text := lower(btrim(p_stage));
begin
  if not public.platform_can_write() then raise exception 'No autorizado.' using errcode='42501'; end if;
  if new_stage not in ('discovered','qualified','contacted','replied','interested','demo','trial','negotiating','won','lost','do_not_contact') then raise exception 'Etapa inválida.' using errcode='22023'; end if;
  select * into l from public.crm_leads where id=p_lead_id for update; if l.id is null then raise exception 'Lead inexistente.' using errcode='P0002'; end if;
  old_stage:=l.pipeline_stage;
  update public.crm_leads set pipeline_stage=new_stage, estado_conversacion=case new_stage when 'discovered' then 'discovered' when 'qualified' then 'qualified' when 'contacted' then 'contacted' when 'replied' then 'replied' when 'interested' then 'interested' when 'demo' then 'demo' when 'trial' then 'trial' when 'negotiating' then 'negotiating' when 'won' then 'won' when 'lost' then 'lost' else 'do_not_contact' end, do_not_contact=(new_stage='do_not_contact' or do_not_contact), updated_at=now() where id=l.id;
  insert into public.crm_actividades(lead_id,tipo,etapa_anterior,etapa_nueva,resumen,metadata,actor_id) values(l.id,'stage_changed',old_stage,new_stage,coalesce(nullif(btrim(p_note),''),'Cambio de etapa'),'{}'::jsonb,auth.uid());
  return jsonb_build_object('id',l.id,'stage',new_stage);
end $$;

create or replace function public.set_crm_lead_do_not_contact(p_lead_id bigint, p_value boolean, p_reason text default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$
declare l public.crm_leads%rowtype;
begin
  if not public.platform_can_write() then raise exception 'No autorizado.' using errcode='42501'; end if;
  select * into l from public.crm_leads where id=p_lead_id for update; if l.id is null then raise exception 'Lead inexistente.' using errcode='P0002'; end if;
  update public.crm_leads set do_not_contact=coalesce(p_value,false), pipeline_stage=case when p_value then 'do_not_contact' else pipeline_stage end, estado_conversacion=case when p_value then 'do_not_contact' else estado_conversacion end, updated_at=now() where id=l.id;
  insert into public.crm_actividades(lead_id,tipo,resumen,metadata,actor_id) values(l.id,'do_not_contact',case when p_value then 'Lead excluido de automatizaciones' else 'Exclusión removida' end,jsonb_build_object('reason',p_reason),auth.uid());
  return true;
end $$;

create or replace function public.merge_crm_leads(p_keep_id bigint, p_duplicate_ids bigint[], p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare duplicate_id bigint; merged_count integer:=0;
begin
  if not public.platform_can_write() then raise exception 'No autorizado.' using errcode='42501'; end if;
  if p_keep_id = any(coalesce(p_duplicate_ids,'{}'::bigint[])) then raise exception 'El lead principal no puede estar entre duplicados.' using errcode='22023'; end if;
  foreach duplicate_id in array coalesce(p_duplicate_ids,'{}'::bigint[]) loop
    if exists(select 1 from public.crm_leads where id=duplicate_id) then
      update public.crm_interacciones set lead_id=p_keep_id where lead_id=duplicate_id;
      update public.crm_notas set lead_id=p_keep_id where lead_id=duplicate_id;
      update public.crm_adjuntos set lead_id=p_keep_id where lead_id=duplicate_id;
      update public.crm_acciones set lead_id=p_keep_id where lead_id=duplicate_id;
      update public.crm_agent_drafts set lead_id=p_keep_id where lead_id=duplicate_id;
      delete from public.crm_leads where id=duplicate_id; merged_count:=merged_count+1;
    end if;
  end loop;
  insert into public.crm_merge_log(entidad,keep_id,merged_ids,reason,actor_id) values('lead',p_keep_id,coalesce(p_duplicate_ids,'{}'),p_reason,auth.uid());
  insert into public.crm_actividades(lead_id,tipo,resumen,metadata,actor_id) values(p_keep_id,'merged','Duplicados combinados',jsonb_build_object('merged_ids',p_duplicate_ids,'reason',p_reason),auth.uid());
  return jsonb_build_object('keep_id',p_keep_id,'merged',merged_count);
end $$;

create or replace function public.import_crm_leads(p_rows jsonb, p_filename text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_import_id bigint; row jsonb; idx integer:=0; ok integer:=0; bad integer:=0; duplicate_count integer:=0; v_name text; v_business text; v_email text; v_phone text; v_key text; v_business_id bigint; v_lead_id bigint; msg text; value text;
begin
  if not public.platform_can_write() then raise exception 'Sólo ventas o administración puede importar leads.' using errcode='42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows)>500 then raise exception 'El CSV debe tener entre 1 y 500 filas válidas.' using errcode='22023'; end if;
  insert into public.crm_importaciones(archivo_nombre,filas_total,created_by) values(left(p_filename,180),jsonb_array_length(p_rows),auth.uid()) returning id into v_import_id;
  for row in select elements.elem from jsonb_array_elements(p_rows) as elements(elem) loop
    idx:=idx+1; msg:=null; v_name:=nullif(btrim(row->>'nombre'),''); v_business:=nullif(btrim(row->>'negocio'),''); v_email:=lower(nullif(btrim(row->>'email'),'')); v_phone:=nullif(regexp_replace(coalesce(row->>'telefono',''),'[^0-9+]','','g'),'');
    foreach value in array array[v_name,v_business,v_email,(row->>'pais'),(row->>'idioma'),(row->>'rubro'),(row->>'fuente'),(row->>'url'),(row->>'notas')] loop if value ~ '^[=+@-]' then msg:='El archivo contiene una fórmula o valor no permitido.'; end if; end loop;
    if msg is null and coalesce(v_phone,'') ~ '^[=@]' then msg:='El teléfono contiene una fórmula o valor no permitido.'; end if;
    if msg is null and (v_name is null or v_business is null) then msg:='Nombre y negocio son obligatorios.'; end if;
    if msg is null and v_email is not null and v_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then msg:='Email inválido.'; end if;
    if msg is null and v_phone is not null and v_phone !~ '^\+?[0-9]{7,18}$' then msg:='Teléfono inválido.'; end if;
    if msg is not null then bad:=bad+1; insert into public.crm_importacion_filas(importacion_id,numero_fila,estado,datos,error) values(v_import_id,idx,'error',row,msg); continue; end if;
    select n.id into v_business_id from public.crm_negocios as n where lower(btrim(n.nombre))=lower(v_business) and (v_email is null or lower(coalesce(n.email,''))=v_email) order by n.id limit 1;
    if v_business_id is null then insert into public.crm_negocios(nombre,rubro,pais,idioma,email,telefono,canal_origen,sitio_web,notas,pipeline_stage,environment,metadata) values(v_business,coalesce(nullif(btrim(row->>'rubro'),''),'custom'),nullif(upper(btrim(row->>'pais')), ''),coalesce(nullif(lower(btrim(row->>'idioma')), ''),'es'),v_email,v_phone,nullif(btrim(row->>'fuente'),''),nullif(btrim(row->>'url'),''),nullif(btrim(row->>'notas'),''),'discovered','production',jsonb_build_object('imported',true)) returning id into v_business_id; end if;
    v_key:=md5(v_business_id::text||'|'||coalesce(v_email,v_phone,lower(v_name)));
    select id into v_lead_id from public.crm_leads where dedupe_key=v_key limit 1;
    if v_lead_id is not null then duplicate_count:=duplicate_count+1; update public.crm_leads as l set nombre_contacto=coalesce(l.nombre_contacto,v_name),email=coalesce(v_email,l.email),telefono=coalesce(v_phone,l.telefono),updated_at=now() where l.id=v_lead_id; insert into public.crm_importacion_filas(importacion_id,numero_fila,estado,datos,lead_id) values(v_import_id,idx,'duplicate',row,v_lead_id); continue; end if;
    insert into public.crm_leads(negocio_id,nombre_contacto,email,telefono,canal_preferido,pipeline_stage,estado_conversacion,dedupe_key,environment,metadata) values(v_business_id,v_name,v_email,v_phone,coalesce(nullif(lower(btrim(row->>'fuente')), ''),'csv'),'discovered','discovered',v_key,'production',jsonb_build_object('imported',true,'source','csv')) returning id into v_lead_id;
    ok:=ok+1; insert into public.crm_importacion_filas(importacion_id,numero_fila,estado,datos,lead_id) values(v_import_id,idx,'ok',row,v_lead_id);
  end loop;
  update public.crm_importaciones set filas_ok=ok,filas_error=bad,estado='completed',completed_at=now() where id=v_import_id;
  return jsonb_build_object('import_id',v_import_id,'ok',ok,'errors',bad,'duplicates',duplicate_count);
end $$;

create or replace function public.get_crm_pipeline_metrics(p_environment text default 'production')
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp
as $$
declare stages jsonb; overdue integer; high_priority integer; actions_today integer; next_week integer;
begin
  if not public.is_platform_member() then raise exception 'No autorizado.' using errcode='42501'; end if;
  select coalesce(jsonb_object_agg(stage,cnt),'{}'::jsonb) into stages from (select coalesce(pipeline_stage,'discovered') stage,count(*) cnt from public.crm_leads where environment=coalesce(nullif(p_environment,''),'production') group by pipeline_stage) q;
  select count(*) into overdue from public.crm_acciones a join public.crm_leads l on l.id=a.lead_id where a.estado='pending' and a.vence_at < now() and l.environment=coalesce(nullif(p_environment,''),'production');
  select count(*) into high_priority from public.crm_leads where environment=coalesce(nullif(p_environment,''),'production') and prioridad in ('high','urgent') and pipeline_stage<>'do_not_contact';
  select count(*) into actions_today from public.crm_acciones a join public.crm_leads l on l.id=a.lead_id where a.estado='pending' and a.vence_at >= date_trunc('day',now()) and a.vence_at < date_trunc('day',now()) + interval '1 day' and l.environment=coalesce(nullif(p_environment,''),'production');
  select count(*) into next_week from public.crm_acciones a join public.crm_leads l on l.id=a.lead_id where a.estado='pending' and a.vence_at >= now() and a.vence_at < now()+interval '7 days' and l.environment=coalesce(nullif(p_environment,''),'production');
  return jsonb_build_object('environment',coalesce(nullif(p_environment,''),'production'),'stages',stages,'leads_total',(select count(*) from public.crm_leads where environment=coalesce(nullif(p_environment,''),'production')),'demos',(select count(*) from public.crm_leads where environment=coalesce(nullif(p_environment,''),'production') and pipeline_stage='demo'),'trials',(select count(*) from public.crm_leads where environment=coalesce(nullif(p_environment,''),'production') and pipeline_stage='trial'),'won',(select count(*) from public.crm_leads where environment=coalesce(nullif(p_environment,''),'production') and pipeline_stage='won'),'lost',(select count(*) from public.crm_leads where environment=coalesce(nullif(p_environment,''),'production') and pipeline_stage='lost'),'overdue_actions',overdue,'high_priority',high_priority,'actions_today',actions_today,'next_7_days',next_week,'drafts_pending',(select count(*) from public.crm_agent_drafts d join public.crm_negocios n on n.id=d.negocio_id where d.estado='pending_approval' and n.environment=coalesce(nullif(p_environment,''),'production')),'drafts_approved',(select count(*) from public.crm_agent_drafts d join public.crm_negocios n on n.id=d.negocio_id where d.estado='approved' and n.environment=coalesce(nullif(p_environment,''),'production')));
end $$;

create or replace function public.export_crm_leads(p_environment text default 'production')
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare result jsonb;
begin
  if not public.platform_can_export() then raise exception 'Tu rol no puede exportar leads.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'nombre_contacto',l.nombre_contacto,'negocio',n.nombre,'rubro',n.rubro,'pais',n.pais,'idioma',n.idioma,'email',l.email,'telefono',l.telefono,'canal',l.canal_preferido,'etapa',l.pipeline_stage,'prioridad',l.prioridad,'score',l.score,'score_level',l.score_level,'seguimiento',l.fecha_seguimiento_at,'do_not_contact',l.do_not_contact) order by l.updated_at desc),'[]'::jsonb) into result from public.crm_leads l join public.crm_negocios n on n.id=l.negocio_id where l.environment=coalesce(nullif(p_environment,''),'production');
  insert into public.saas_audit_log(event_key,event_name,user_id,metadata) values('crm_export:'||auth.uid()::text||':'||extract(epoch from clock_timestamp())::bigint,'crm_exported',auth.uid(),jsonb_build_object('environment',coalesce(nullif(p_environment,''),'production'),'rows',jsonb_array_length(result)));
  return result;
end $$;

-- La aprobación sigue siendo humana, pero también queda bloqueada si el lead
-- está excluido, incluso si el negocio no lo está.
create or replace function public.crm_agent_draft_guard()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$ begin if new.lead_id is not null and exists(select 1 from public.crm_leads where id=new.lead_id and do_not_contact) then raise exception 'El lead está marcado do_not_contact.' using errcode='42501'; end if; return new; end $$;
drop trigger if exists trg_crm_agent_draft_guard on public.crm_agent_drafts;
create trigger trg_crm_agent_draft_guard before insert or update on public.crm_agent_drafts for each row execute function public.crm_agent_draft_guard();
create or replace function public.crm_agent_draft_audit()
returns trigger language plpgsql security definer set search_path=public,pg_temp
as $$ begin if tg_op='UPDATE' and (old.contenido is distinct from new.contenido or old.asunto is distinct from new.asunto) then insert into public.crm_actividades(negocio_id,lead_id,tipo,resumen,metadata,actor_id) values(new.negocio_id,new.lead_id,'draft_reviewed','Mensaje de borrador modificado',jsonb_build_object('draft_id',new.id),auth.uid()); end if; return new; end $$;
drop trigger if exists trg_crm_agent_draft_audit on public.crm_agent_drafts;
create trigger trg_crm_agent_draft_audit after update on public.crm_agent_drafts for each row execute function public.crm_agent_draft_audit();

create or replace function public.set_crm_agent_draft_status(p_draft_id bigint, p_status text)
returns boolean language plpgsql security definer set search_path=public,pg_temp
as $$ declare d public.crm_agent_drafts%rowtype; s text:=lower(btrim(p_status)); begin if not public.platform_can_write() then raise exception 'No autorizado.' using errcode='42501'; end if; if s not in ('pending_research','ready_for_draft','pending_approval','approved','rejected','sent','replied','closed','canceled') then raise exception 'Estado inválido.' using errcode='22023'; end if; select * into d from public.crm_agent_drafts where id=p_draft_id for update; if d.id is null then raise exception 'Borrador inexistente.' using errcode='P0002'; end if; if s in ('approved','sent') and (exists(select 1 from public.crm_negocios where id=d.negocio_id and do_not_contact) or exists(select 1 from public.crm_leads where id=d.lead_id and do_not_contact)) then raise exception 'No se puede aprobar un contacto excluido.' using errcode='42501'; end if; update public.crm_agent_drafts set estado=s,approved_by=case when s='approved' then auth.uid() else approved_by end,approved_at=case when s='approved' then now() else approved_at end,updated_at=now() where id=d.id; insert into public.crm_actividades(negocio_id,lead_id,tipo,resumen,metadata,actor_id) values(d.negocio_id,d.lead_id,'draft_reviewed','Estado de borrador actualizado',jsonb_build_object('draft_id',d.id,'status',s),auth.uid()); return true; end $$;

revoke all on function public.calculate_crm_lead_score(bigint), public.set_crm_lead_stage(bigint,text,text), public.set_crm_lead_do_not_contact(bigint,boolean,text), public.merge_crm_leads(bigint,bigint[],text), public.import_crm_leads(jsonb,text), public.get_crm_pipeline_metrics(text), public.export_crm_leads(text), public.set_crm_agent_draft_status(bigint,text) from public,anon;
grant execute on function public.calculate_crm_lead_score(bigint), public.set_crm_lead_stage(bigint,text,text), public.set_crm_lead_do_not_contact(bigint,boolean,text), public.merge_crm_leads(bigint,bigint[],text), public.import_crm_leads(jsonb,text), public.get_crm_pipeline_metrics(text), public.export_crm_leads(text), public.set_crm_agent_draft_status(bigint,text) to authenticated;

commit;
