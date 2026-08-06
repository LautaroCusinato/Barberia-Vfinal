-- Índice para aislar y mantener eventos por tenant con volumen creciente.
create index if not exists idx_saas_automation_events_tenant_id
  on public.saas_automation_events (tenant_id);
