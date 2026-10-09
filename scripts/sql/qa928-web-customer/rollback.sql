-- Retira sólo el comportamiento nuevo. Nombres, fichas y turnos se conservan.
begin;
drop trigger if exists trg_promover_nombre_web_qa928 on public.turnos;
drop function if exists public.promover_nombre_web_qa928();
commit;
