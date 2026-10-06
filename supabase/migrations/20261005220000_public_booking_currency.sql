-- Tarea 20: ampliación del JSON público, sin conversión de importes.
-- Revisar la definición remota antes de aplicar: no sobrescribir drift.
begin;

do $guard$
declare v_source text; v_sql boolean; v_stable boolean; v_definer boolean; v_config text[];
begin
  select p.prosrc, l.lanname='sql', p.provolatile='s', p.prosecdef, p.proconfig
  into v_source,v_sql,v_stable,v_definer,v_config
  from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid=to_regprocedure('public.catalogo_reserva_publica(text)');
  if v_source is null or md5(regexp_replace(v_source,'[[:space:]]+','','g')) not in
    ('efff92b3b1f3da930dc096b0957cc98f','0d8996924892f748baf862e2f269e2aa')
    or v_sql is distinct from true or v_stable is distinct from true or v_definer is distinct from true
    or v_config is distinct from array['search_path=public, pg_temp'] then
    raise exception 'Catálogo distinto de la base revisada o prerequisito ausente. Comparar drift antes de aplicar tarea 20.';
  end if;
end;
$guard$;

create or replace function public.catalogo_reserva_publica(p_slug text)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('barberia', jsonb_build_object('nombre', b.nombre, 'moneda', b.moneda, 'slug', b.slug, 'logo_url', b.logo_url, 'color_principal', b.color_principal, 'color_secundario', b.color_secundario, 'whatsapp', b.whatsapp, 'direccion', b.direccion, 'zona_horaria', b.zona_horaria, 'reservas_publicas', b.reservas_publicas, 'max_dias_reserva', b.max_dias_reserva), 'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'descripcion', s.descripcion, 'precio', s.precio, 'duracion_min', s.duracion_min) order by s.nombre) from public.servicios s where s.barberia_id = b.id and s.activo and exists (select 1 from public.barbero_servicios bs join public.barberos br on br.id = bs.barbero_id where bs.servicio_id = s.id and br.activo)), '[]'::jsonb))
  from public.barberias b where b.slug = p_slug and b.reservas_publicas = true;
$$;

-- CREATE OR REPLACE preserva propietario y ACL de la función existente.
-- No se agregan grants ni campos privados; firma, filtros y precio se conservan.
commit;
