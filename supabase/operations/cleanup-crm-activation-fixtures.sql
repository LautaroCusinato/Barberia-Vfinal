-- Limpieza opcional e idempotente de fixtures internos de activación.
-- Nunca apunta a barberias_id reales ni a negocios de producción.
begin;
delete from public.crm_negocios
where environment in ('internal','sandbox')
  and metadata->>'fixture' = 'crm_activation_20260806';
delete from public.crm_negocios
where environment in ('internal','sandbox')
  and nombre = 'Import Business QA'
  and barberia_id is null;
delete from public.crm_importaciones
where archivo_nombre like 'crm-qa%';
commit;
