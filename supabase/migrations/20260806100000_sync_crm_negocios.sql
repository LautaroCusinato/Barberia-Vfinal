-- Vincula los tenants existentes con el CRM comercial.
-- Es idempotente: no duplica negocios ya vinculados y deja un trigger para
-- que los nuevos tenants aparezcan automaticamente.
begin;

create unique index if not exists idx_crm_negocios_barberia_id_unique
  on public.crm_negocios (barberia_id)
  where barberia_id is not null;

insert into public.crm_negocios (
  barberia_id, nombre, rubro, idioma, zona_horaria, telefono, email,
  canal_origen, etapa, metadata
)
select
  b.id,
  b.nombre,
  coalesce(nullif(b.vertical, ''), 'custom'),
  split_part(coalesce(nullif(b.locale, ''), 'es'), '-', 1),
  b.zona_horaria,
  b.whatsapp,
  b.billing_email,
  'importacion_saas',
  'cliente',
  coalesce(b.metadata, '{}'::jsonb) || jsonb_build_object(
    'source', 'barberias_sync',
    'synced_at', now()
  )
from public.barberias b
where not exists (
  select 1 from public.crm_negocios n where n.barberia_id = b.id
);

create or replace function public.sync_barberia_to_crm()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.crm_negocios (
    barberia_id, nombre, rubro, idioma, zona_horaria, telefono, email,
    canal_origen, etapa, metadata
  )
  values (
    new.id,
    new.nombre,
    coalesce(nullif(new.vertical, ''), 'custom'),
    split_part(coalesce(nullif(new.locale, ''), 'es'), '-', 1),
    new.zona_horaria,
    new.whatsapp,
    new.billing_email,
    'onboarding',
    'prueba',
    coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object('source', 'barberias_trigger')
  )
  on conflict (barberia_id) where barberia_id is not null do nothing;
  return new;
end;
$$;

drop trigger if exists trg_barberias_sync_crm on public.barberias;
create trigger trg_barberias_sync_crm
after insert on public.barberias
for each row execute function public.sync_barberia_to_crm();

revoke all on function public.sync_barberia_to_crm() from public, anon, authenticated;

commit;
