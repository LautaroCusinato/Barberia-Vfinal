-- Fixture histórico de la definición local en 6e559fd/5298537.
-- Sólo para el cluster efímero: NO es un bootstrap ni script de producción.
create or replace function public.catalogo_reserva_publica(p_slug text)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object('barberia', jsonb_build_object('nombre', b.nombre, 'slug', b.slug, 'logo_url', b.logo_url, 'color_principal', b.color_principal, 'color_secundario', b.color_secundario, 'whatsapp', b.whatsapp, 'direccion', b.direccion, 'zona_horaria', b.zona_horaria, 'reservas_publicas', b.reservas_publicas, 'max_dias_reserva', b.max_dias_reserva), 'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'descripcion', s.descripcion, 'precio', s.precio, 'duracion_min', s.duracion_min) order by s.nombre) from public.servicios s where s.barberia_id = b.id and s.activo and exists (select 1 from public.barbero_servicios bs join public.barberos br on br.id = bs.barbero_id where bs.servicio_id = s.id and br.activo)), '[]'::jsonb))
  from public.barberias b where b.slug = p_slug and b.reservas_publicas = true;
$$;
