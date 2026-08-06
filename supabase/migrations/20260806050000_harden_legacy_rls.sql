-- El módulo legado de mensajería/pagos no debe exponer datos a anon.
-- Las credenciales de servicio de n8n omiten RLS y no se ven afectadas.
begin;

drop policy if exists "mensajes_select_member" on public.mensajes;
create policy "mensajes_select_member"
on public.mensajes for select to authenticated
using (public.is_barberia_member(barberia_id));

drop policy if exists "mensajes_write_staff" on public.mensajes;
create policy "mensajes_write_staff"
on public.mensajes for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']));

drop policy if exists "pagos_select_member" on public.pagos;
create policy "pagos_select_member"
on public.pagos for select to authenticated
using (public.is_barberia_member(barberia_id));

drop policy if exists "pagos_write_staff" on public.pagos;
create policy "pagos_write_staff"
on public.pagos for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']));

drop policy if exists "conversaciones_select_member" on public.conversaciones;
create policy "conversaciones_select_member"
on public.conversaciones for select to authenticated
using (barberia_id is not null and public.is_barberia_member(barberia_id));

drop policy if exists "conversaciones_write_staff" on public.conversaciones;
create policy "conversaciones_write_staff"
on public.conversaciones for all to authenticated
using (barberia_id is not null and public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']))
with check (barberia_id is not null and public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']));

commit;
