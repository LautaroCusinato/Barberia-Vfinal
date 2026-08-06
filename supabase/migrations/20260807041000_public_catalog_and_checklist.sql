-- Catálogo público seguro y checklist ampliado. No expone datos de tenants.
begin;

create or replace function public.get_public_saas_catalog()
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nombre', p.nombre, 'descripcion', p.descripcion, 'precio_mensual', p.precio_mensual, 'moneda', p.moneda, 'trial_dias', p.trial_dias) order by p.precio_mensual, p.codigo), '[]'::jsonb)
  from public.saas_planes p where p.activo;
$$;
revoke all on function public.get_public_saas_catalog() from public;
grant execute on function public.get_public_saas_catalog() to anon, authenticated;

create or replace function public.get_onboarding_status(p_barberia_id bigint)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_barberia public.barberias%rowtype; v_items jsonb; v_done integer;
begin
  select * into v_barberia from public.barberias where id = p_barberia_id;
  if v_barberia.id is null or not (public.is_platform_member() or public.is_barberia_member(p_barberia_id)) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  v_items := jsonb_build_array(
    jsonb_build_object('key','datos_negocio','label','Completar datos del negocio','done', v_barberia.nombre is not null and v_barberia.slug is not null),
    jsonb_build_object('key','logo','label','Cargar logo','done', v_barberia.logo_url is not null),
    jsonb_build_object('key','servicios','label','Crear servicios','done', exists (select 1 from public.servicios where barberia_id = p_barberia_id and activo)),
    jsonb_build_object('key','empleados','label','Agregar empleados','done', exists (select 1 from public.barberos where barberia_id = p_barberia_id and activo)),
    jsonb_build_object('key','horarios','label','Configurar horarios','done', exists (select 1 from public.config where barberia_id = p_barberia_id and clave = 'horarios_default')),
    jsonb_build_object('key','pagina_publica','label','Publicar página de reservas','done', v_barberia.reservas_publicas and exists (select 1 from public.servicios where barberia_id = p_barberia_id and activo)),
    jsonb_build_object('key','reserva','label','Hacer primera reserva','done', exists (select 1 from public.turnos where barberia_id = p_barberia_id and estado <> 'cancelado')),
    jsonb_build_object('key','colaboradores','label','Invitar colaboradores','done', (select count(*) > 1 from public.barberia_members where barberia_id = p_barberia_id)),
    jsonb_build_object('key','whatsapp','label','Conectar WhatsApp','done', exists (select 1 from public.saas_integraciones where barberia_id = p_barberia_id and proveedor = 'evolution' and estado = 'conectado')),
    jsonb_build_object('key','plan','label','Revisar plan','done', exists (select 1 from public.saas_suscripciones where barberia_id = p_barberia_id and plan_codigo is not null))
  );
  select count(*) into v_done from jsonb_array_elements(v_items) item where (item ->> 'done')::boolean;
  return jsonb_build_object('barberia_id', p_barberia_id, 'completed', v_barberia.onboarding_completed, 'progress', round((v_done::numeric / jsonb_array_length(v_items)) * 100), 'items', v_items);
end; $$;
revoke all on function public.get_onboarding_status(bigint) from public, anon;
grant execute on function public.get_onboarding_status(bigint) to authenticated;

-- Configuración central también limita el horizonte de la página pública.
create or replace function public.horarios_disponibles_reserva_publica(p_slug text, p_servicio_id bigint, p_fecha date)
returns table (barbero_id bigint, barbero_nombre text, barbero_color text, duracion_min integer, hora time)
language sql stable security definer set search_path = public, pg_temp
as $$
  with negocio as (select id, zona_horaria, anticipacion_minutos, max_dias_reserva from public.barberias where slug = p_slug and reservas_publicas), candidatos as (
    select br.id, br.nombre, br.color, coalesce(bs.duracion_min, s.duracion_min) as duracion_min, n.id as barberia_id, n.zona_horaria, n.anticipacion_minutos, n.max_dias_reserva
    from negocio n join public.servicios s on s.id = p_servicio_id and s.barberia_id = n.id and s.activo join public.barbero_servicios bs on bs.servicio_id = s.id join public.barberos br on br.id = bs.barbero_id and br.barberia_id = n.id and br.activo
  ), franjas as (select c.*, h.start_time, h.end_time from candidatos c join public.horarios_barbero h on h.barbero_id = c.id and h.barberia_id = c.barberia_id and h.activo and h.day_of_week = extract(dow from p_fecha)::smallint), opciones as (
    select f.*, slot::time as hora, slot as inicio_at, slot + make_interval(mins => f.duracion_min) as fin_at from franjas f cross join lateral generate_series(p_fecha::timestamp + f.start_time, p_fecha::timestamp + f.end_time - make_interval(mins => f.duracion_min), interval '15 minutes') as slot
  )
  select o.id, o.nombre, o.color, o.duracion_min, o.hora from opciones o
  where p_fecha between (now() at time zone o.zona_horaria)::date and ((now() at time zone o.zona_horaria)::date + o.max_dias_reserva)
    and o.inicio_at >= (now() at time zone o.zona_horaria) + make_interval(mins => o.anticipacion_minutos)
    and not exists (select 1 from public.turnos t where t.barbero_id = o.id and t.estado not in ('cancelado', 'no_asistio') and tsrange(t.inicio_at, t.fin_at, '[)') && tsrange(o.inicio_at, o.fin_at, '[)'))
    and not exists (select 1 from public.bloqueos_agenda ba where ba.barberia_id = o.barberia_id and ba.fecha = p_fecha and (ba.barbero_id is null or ba.barbero_id = o.id) and tsrange(p_fecha::timestamp + ba.start_time, p_fecha::timestamp + ba.end_time, '[)') && tsrange(o.inicio_at, o.fin_at, '[)'))
  order by o.nombre, o.hora;
$$;
revoke all on function public.horarios_disponibles_reserva_publica(text,bigint,date) from public;
grant execute on function public.horarios_disponibles_reserva_publica(text,bigint,date) to anon, authenticated;

commit;
