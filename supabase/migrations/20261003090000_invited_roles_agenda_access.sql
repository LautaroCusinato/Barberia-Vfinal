-- Permisos de escritura para los roles invitables "admin" y "empleado".
--
-- Por qué: invite_barberia_member (20260807040000) sólo ofrece los roles
-- admin, recepcionista, empleado, readonly y barbero, y el panel invita por
-- defecto como "empleado". Pero las políticas de escritura de agenda y
-- clientes (última versión en 20260831090000) sólo nombran owner,
-- recepcionista y barbero. Resultado: un Administrador o un Empleado invitado
-- entraba al panel pero no podía crear turnos, clientes, notas ni pagos
-- (error de RLS).
--
-- Regla:
--   * admin    = mismos permisos operativos que owner sobre agenda, clientes,
--                notas, pagos, mensajes/conversaciones, profesionales,
--                servicios, horarios y bloqueos.
--                NO se tocan: billing (saas_*), config (bot/ajustes, sigue
--                sólo owner), barberias (datos del negocio, sigue sólo owner),
--                barberia_members (transferencia de propiedad y gestión de
--                miembros quedan como estaban: sólo owner) ni
--                saas_integraciones (sólo service_role).
--   * empleado = mismos permisos que barbero (políticas *_write_staff).
--
-- Se conserva exactamente la estructura de cada política (nombre, comando,
-- roles de Postgres y chequeo barberia_operational_access); sólo se amplía la
-- lista de roles del negocio. Idempotente: drop policy if exists + create.
begin;

-- 1. Políticas de staff: owner, admin, recepcionista, barbero, empleado.
drop policy if exists "clientes_write_staff" on public.clientes;
create policy "clientes_write_staff" on public.clientes for all
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));

drop policy if exists "turnos_write_staff" on public.turnos;
create policy "turnos_write_staff" on public.turnos for all
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));

drop policy if exists "mensajes_write_staff" on public.mensajes;
create policy "mensajes_write_staff" on public.mensajes for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));

drop policy if exists "conversaciones_write_staff" on public.conversaciones;
create policy "conversaciones_write_staff" on public.conversaciones for all to authenticated
using (barberia_id is not null and public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (barberia_id is not null and public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));

drop policy if exists "pagos_write_staff" on public.pagos;
create policy "pagos_write_staff" on public.pagos for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));

drop policy if exists "notas_write_staff" on public.notas;
create policy "notas_write_staff" on public.notas for all
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));

-- 2. Políticas operativas de owner que también corresponden a admin:
--    profesionales, servicios, horarios, bloqueos y servicios por profesional.
drop policy if exists "servicios_write_owner" on public.servicios;
create policy "servicios_write_owner" on public.servicios for all
using (public.is_barberia_role(barberia_id, array['owner', 'admin']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin']) and public.barberia_operational_access(barberia_id));

drop policy if exists "barberos_write_owner" on public.barberos;
create policy "barberos_write_owner" on public.barberos for all
using (public.is_barberia_role(barberia_id, array['owner', 'admin']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin']) and public.barberia_operational_access(barberia_id));

drop policy if exists "horarios_write_owner" on public.horarios_barbero;
create policy "horarios_write_owner" on public.horarios_barbero for all
using (public.is_barberia_role(barberia_id, array['owner', 'admin']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin']) and public.barberia_operational_access(barberia_id));

drop policy if exists "bloqueos_write_owner" on public.bloqueos_agenda;
create policy "bloqueos_write_owner" on public.bloqueos_agenda for all
using (public.is_barberia_role(barberia_id, array['owner', 'admin']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin']) and public.barberia_operational_access(barberia_id));

drop policy if exists "barbero_servicios_write_owner" on public.barbero_servicios;
create policy "barbero_servicios_write_owner" on public.barbero_servicios for all
using (
  public.is_barberia_role((select barberia_id from public.barberos where id = barbero_id), array['owner', 'admin'])
  and public.barberia_operational_access((select barberia_id from public.barberos where id = barbero_id))
)
with check (
  public.is_barberia_role((select barberia_id from public.barberos where id = barbero_id), array['owner', 'admin'])
  and public.barberia_operational_access((select barberia_id from public.barberos where id = barbero_id))
);

commit;
