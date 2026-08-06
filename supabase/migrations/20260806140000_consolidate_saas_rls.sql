-- Consolida politicas RLS SaaS para evitar evaluaciones permisivas duplicadas.
begin;

drop policy if exists "saas_suscripciones_select_platform" on public.saas_suscripciones;
drop policy if exists "saas_suscripciones_select_owner" on public.saas_suscripciones;
create policy "saas_suscripciones_select_access" on public.saas_suscripciones
for select to authenticated
using (
  public.is_platform_member()
  or public.is_barberia_role(barberia_id, array['owner'])
);

drop policy if exists "saas_integraciones_select_member" on public.saas_integraciones;
drop policy if exists "saas_integraciones_write_owner" on public.saas_integraciones;

create policy "saas_integraciones_select_member" on public.saas_integraciones
for select to authenticated
using (public.is_barberia_member(barberia_id));

create policy "saas_integraciones_insert_owner" on public.saas_integraciones
for insert to authenticated
with check (public.is_barberia_role(barberia_id, array['owner']));

create policy "saas_integraciones_update_owner" on public.saas_integraciones
for update to authenticated
using (public.is_barberia_role(barberia_id, array['owner']))
with check (public.is_barberia_role(barberia_id, array['owner']));

create policy "saas_integraciones_delete_owner" on public.saas_integraciones
for delete to authenticated
using (public.is_barberia_role(barberia_id, array['owner']));

commit;
