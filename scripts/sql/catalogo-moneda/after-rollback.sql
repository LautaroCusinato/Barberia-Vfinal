select public.t_assert(bool_and(public.catalogo_reserva_publica(slug) is not distinct from value), 'rollback devuelve contrato anterior') from public.t_catalog_baseline;
select public.t_assert(p.proacl=b.proacl and p.proowner=b.proowner, 'rollback conserva ACL y propietario')
from pg_proc p cross join public.t_catalog_permissions b where p.oid='public.catalogo_reserva_publica(text)'::regprocedure;
