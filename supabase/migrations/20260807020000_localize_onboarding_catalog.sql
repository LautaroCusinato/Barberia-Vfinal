-- Etiquetas visibles del asistente en el idioma por defecto del producto.
begin;

update public.saas_verticales set nombre = case codigo
  when 'barberia' then 'Barbería'
  when 'peluqueria' then 'Peluquería'
  when 'salon' then 'Salón de belleza'
  when 'spa' then 'Centro de estética'
  when 'veterinaria' then 'Veterinaria'
  when 'gimnasio' then 'Gimnasio'
  when 'clinica' then 'Clínica'
  when 'taller' then 'Taller'
  when 'custom' then 'Otro'
  else nombre end;

create or replace function public.get_self_service_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Autenticación requerida.' using errcode = '28000';
  end if;
  return jsonb_build_object(
    'verticales', coalesce((select jsonb_agg(to_jsonb(v) order by v.orden, v.nombre) from public.saas_verticales v where v.activo), '[]'::jsonb),
    'paises', jsonb_build_array(
      jsonb_build_object('codigo','AR','nombre','Argentina'),
      jsonb_build_object('codigo','UY','nombre','Uruguay'),
      jsonb_build_object('codigo','CL','nombre','Chile'),
      jsonb_build_object('codigo','MX','nombre','México'),
      jsonb_build_object('codigo','ES','nombre','España'),
      jsonb_build_object('codigo','OTRO','nombre','Otro')
    ),
    'idiomas', jsonb_build_array(
      jsonb_build_object('codigo','es-AR','nombre','Español'),
      jsonb_build_object('codigo','en','nombre','English'),
      jsonb_build_object('codigo','pt-BR','nombre','Português')
    ),
    'monedas', jsonb_build_array(
      jsonb_build_object('codigo','ARS','nombre','Peso argentino'),
      jsonb_build_object('codigo','USD','nombre','Dólar estadounidense'),
      jsonb_build_object('codigo','UYU','nombre','Peso uruguayo'),
      jsonb_build_object('codigo','CLP','nombre','Peso chileno'),
      jsonb_build_object('codigo','MXN','nombre','Peso mexicano'),
      jsonb_build_object('codigo','EUR','nombre','Euro')
    )
  );
end;
$$;

revoke all on function public.get_self_service_catalog() from public, anon;
grant execute on function public.get_self_service_catalog() to authenticated;

commit;
