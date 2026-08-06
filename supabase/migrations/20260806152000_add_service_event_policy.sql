-- Política explícita para el único rol que opera la tabla de idempotencia.
-- anon y authenticated siguen sin privilegios ni políticas de acceso.
drop policy if exists "saas_automation_events_service_role" on public.saas_automation_events;
create policy "saas_automation_events_service_role"
on public.saas_automation_events for all to service_role
using (true) with check (true);
