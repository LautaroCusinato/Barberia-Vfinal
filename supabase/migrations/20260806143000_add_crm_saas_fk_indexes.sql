-- Indexa las claves foráneas que se usan para filtrar CRM y suscripciones.
-- Los índices son idempotentes y reducen el coste de joins/borrados en crecimiento.
create index if not exists idx_crm_interacciones_created_by
  on public.crm_interacciones (created_by);

create index if not exists idx_crm_leads_negocio_id
  on public.crm_leads (negocio_id);

create index if not exists idx_crm_leads_responsable_id
  on public.crm_leads (responsable_id);

create index if not exists idx_saas_suscripciones_plan_codigo
  on public.saas_suscripciones (plan_codigo);
