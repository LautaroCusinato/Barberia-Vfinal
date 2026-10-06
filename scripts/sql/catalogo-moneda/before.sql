revoke all on function public.catalogo_reserva_publica(text) from public;
grant execute on function public.catalogo_reserva_publica(text) to anon, authenticated;
create table public.t_catalog_baseline as select slug, public.catalogo_reserva_publica(slug) as value from public.barberias;
create table public.t_catalog_permissions as select proacl, proowner from pg_proc where oid='public.catalogo_reserva_publica(text)'::regprocedure;
select public.t_assert(not (public.catalogo_reserva_publica('local-usd')->'barberia' ? 'moneda'), 'baseline no expone moneda');
