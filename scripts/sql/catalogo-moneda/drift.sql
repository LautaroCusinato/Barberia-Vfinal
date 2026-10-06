-- Cambio sintético ajeno: la migración debe negarse a sobrescribirlo.
create or replace function public.catalogo_reserva_publica(p_slug text)
returns jsonb language sql stable security definer set search_path = public, pg_temp
as $$ select '{"changed":true}'::jsonb $$;
