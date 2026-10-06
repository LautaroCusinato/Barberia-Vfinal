select public.t_assert((public.catalogo_reserva_publica('local-ars')->'barberia'->>'moneda')='ARS', 'ARS del negocio');
select public.t_assert((public.catalogo_reserva_publica('local-usd')->'barberia'->>'moneda')='USD', 'USD del negocio');
select public.t_assert((public.catalogo_reserva_publica('local-usd')->'servicios'->0->>'precio')::numeric=25.50, 'sin convertir importe USD');
select public.t_assert((public.catalogo_reserva_publica('local-legado')->'barberia'->>'moneda') is null, 'legado null explícito');
select public.t_assert(public.catalogo_reserva_publica('local-pausado') is null, 'negocio sin reservas sigue privado');
select public.t_assert(public.catalogo_reserva_publica('inexistente') is null, 'slug inexistente');
select public.t_assert(public.catalogo_reserva_publica(''' or true--') is null, 'slug no ejecuta SQL');
select public.t_assert(jsonb_array_length(public.catalogo_reserva_publica('local-ars')->'servicios')=1, 'sólo servicio activo con profesional activo');
select public.t_assert((public.catalogo_reserva_publica('local-ars')->'servicios'->0->>'id')::bigint=1, 'sin servicio de otro negocio');
select public.t_assert(position('fixture-private-value' in public.catalogo_reserva_publica('local-ars')::text)=0, 'metadata privada ausente');
select public.t_assert(not (public.catalogo_reserva_publica('local-ars')->'barberia' ? 'billing_email'), 'billing_email ausente');
select public.t_assert(bool_and(
  case when value is null then public.catalogo_reserva_publica(slug) is null
  else jsonb_set(public.catalogo_reserva_publica(slug), '{barberia}', (public.catalogo_reserva_publica(slug)->'barberia')-'moneda')=value end
), 'contrato anterior intacto salvo moneda') from public.t_catalog_baseline;
select public.t_assert(p.proacl=b.proacl and p.proowner=b.proowner, 'ACL y propietario conservados')
from pg_proc p cross join public.t_catalog_permissions b where p.oid='public.catalogo_reserva_publica(text)'::regprocedure;
select public.t_assert(prosecdef and provolatile='s' and proconfig=array['search_path=public, pg_temp'], 'definer estable y search_path conservado')
from pg_proc where oid='public.catalogo_reserva_publica(text)'::regprocedure;

set role anon;
select public.t_assert((public.catalogo_reserva_publica('local-usd')->'barberia'->>'moneda')='USD', 'anon usa sólo RPC pública');
select public.t_assert(not has_table_privilege(current_user,'public.barberias','SELECT'), 'anon sin SELECT a barberias');
select public.t_assert(not has_table_privilege(current_user,'public.servicios','SELECT'), 'anon sin SELECT a servicios');
reset role;
set role authenticated;
select public.t_assert((public.catalogo_reserva_publica('local-ars')->'barberia'->>'moneda')='ARS', 'authenticated conserva RPC');
reset role;
