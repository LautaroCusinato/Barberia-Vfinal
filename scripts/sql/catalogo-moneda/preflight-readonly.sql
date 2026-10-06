-- Ejecutar sólo lectura sobre el entorno elegido; no devuelve datos de clientes.
select md5(regexp_replace(p.prosrc,'[[:space:]]+','','g')) as definition_hash,
  p.prosecdef as security_definer, p.provolatile, l.lanname, p.proconfig,
  has_function_privilege('anon',p.oid,'execute') as anon_execute
from pg_proc p join pg_language l on l.oid=p.prolang
where p.oid=to_regprocedure('public.catalogo_reserva_publica(text)');

select exists(select 1 from information_schema.columns
  where table_schema='public' and table_name='barberias' and column_name='moneda') as currency_column_exists;
