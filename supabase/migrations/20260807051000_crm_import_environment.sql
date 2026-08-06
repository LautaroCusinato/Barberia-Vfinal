-- Permite importar fixtures y demos sin contaminar production.
begin;
drop function if exists public.import_crm_leads(jsonb,text);
create or replace function public.import_crm_leads(p_rows jsonb, p_filename text default null, p_environment text default 'production')
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare v_import_id bigint; row jsonb; idx integer:=0; ok integer:=0; bad integer:=0; duplicate_count integer:=0; v_name text; v_business text; v_email text; v_phone text; v_key text; v_business_id bigint; v_lead_id bigint; msg text; value text; v_environment text:=coalesce(nullif(p_environment,''),'production');
begin
  if not public.platform_can_write() then raise exception 'Sólo ventas o administración puede importar leads.' using errcode='42501'; end if;
  if v_environment not in ('sandbox','demo','production','internal') then raise exception 'Entorno inválido.' using errcode='22023'; end if;
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
    select n.id into v_business_id from public.crm_negocios as n where lower(btrim(n.nombre))=lower(v_business) and n.environment=v_environment and (v_email is null or lower(coalesce(n.email,''))=v_email) order by n.id limit 1;
    if v_business_id is null then insert into public.crm_negocios(nombre,rubro,pais,idioma,email,telefono,canal_origen,sitio_web,notas,pipeline_stage,environment,metadata) values(v_business,coalesce(nullif(btrim(row->>'rubro'),''),'custom'),nullif(upper(btrim(row->>'pais')), ''),coalesce(nullif(lower(btrim(row->>'idioma')), ''),'es'),v_email,v_phone,nullif(btrim(row->>'fuente'),''),nullif(btrim(row->>'url'),''),nullif(btrim(row->>'notas'),''),'discovered',v_environment,jsonb_build_object('imported',true,'source','csv')) returning id into v_business_id; end if;
    v_key:=md5(v_business_id::text||'|'||coalesce(v_email,v_phone,lower(v_name)));
    select id into v_lead_id from public.crm_leads where dedupe_key=v_key and environment=v_environment limit 1;
    if v_lead_id is not null then duplicate_count:=duplicate_count+1; update public.crm_leads as l set nombre_contacto=coalesce(l.nombre_contacto,v_name),email=coalesce(v_email,l.email),telefono=coalesce(v_phone,l.telefono),updated_at=now() where l.id=v_lead_id; insert into public.crm_importacion_filas(importacion_id,numero_fila,estado,datos,lead_id) values(v_import_id,idx,'duplicate',row,v_lead_id); continue; end if;
    insert into public.crm_leads(negocio_id,nombre_contacto,email,telefono,canal_preferido,pipeline_stage,estado_conversacion,dedupe_key,environment,metadata) values(v_business_id,v_name,v_email,v_phone,coalesce(nullif(lower(btrim(row->>'fuente')), ''),'csv'),'discovered','discovered',v_key,v_environment,jsonb_build_object('imported',true,'source','csv')) returning id into v_lead_id;
    ok:=ok+1; insert into public.crm_importacion_filas(importacion_id,numero_fila,estado,datos,lead_id) values(v_import_id,idx,'ok',row,v_lead_id);
  end loop;
  update public.crm_importaciones set filas_ok=ok,filas_error=bad,estado='completed',completed_at=now() where id=v_import_id;
  return jsonb_build_object('import_id',v_import_id,'ok',ok,'errors',bad,'duplicates',duplicate_count,'environment',v_environment);
end $$;
revoke all on function public.import_crm_leads(jsonb,text,text) from public,anon;
grant execute on function public.import_crm_leads(jsonb,text,text) to authenticated;
commit;
