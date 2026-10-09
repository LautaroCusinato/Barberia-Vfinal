-- El panel sólo recibe cambios de tablas publicadas. No altera RLS, grants,
-- identidad de réplica ni RPC. Las tablas internas del bot quedan fuera.
-- Reversión: quitar sólo las tablas añadidas, según el inventario previo.
begin;
do $$
declare
  target text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Missing Supabase Realtime publication';
  end if;
  foreach target in array array['turnos','clientes','mensajes','notas','servicios','barberos','config','saas_integraciones','bloqueos_agenda','pagos'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=target and c.relrowsecurity
    ) then
      raise exception 'RLS required for public.%', target;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public' and tablename=target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;
commit;
