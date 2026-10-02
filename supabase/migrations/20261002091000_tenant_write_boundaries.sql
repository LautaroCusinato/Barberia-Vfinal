-- Fronteras de escritura multi-tenant.
--
-- 1) barberias: la política "barberias_insert_authenticated" permitía a
--    cualquier usuario autenticado (sin email verificado) crear tenants por
--    PostgREST eligiendo columnas que el resto del sistema trata como
--    autoritativas del servidor (estado_cuenta, plan_codigo, onboarding y,
--    sobre todo, metadata: environment, technical, e2e_prefix,
--    production_billing_pilot, billing_*). Desde 20260831090000 el UPDATE
--    directo ya está revocado; el INSERT era el bypass. El alta legítima pasa
--    por complete_self_service_onboarding (SECURITY DEFINER) y el backend.
--
-- 2) barberia_members: un owner podía insertar cualquier user_id en su
--    negocio (membresía forzada, sin invitación ni consentimiento) y, vía
--    UPDATE, reescribir user_id/barberia_id de una fila. El alta legítima es
--    accept_barberia_invitation; el panel sólo cambia `role` y borra.
--
-- 3) saas_integraciones: el owner podía insertar/editar filas Evolution
--    (estado 'conectado', external_instance_id, receiver_number, metadata).
--    Los nombres de instancia son predecibles, así que un tenant podía
--    "reservar" la instancia de otro y bloquear su aprovisionamiento por el
--    índice único, o falsear el estado que leen las RPC heredadas y el panel.
--    Todas las escrituras legítimas usan service_role (Edge Functions).
--
-- 4) Referencias cruzadas: las políticas sólo validan `barberia_id` de la fila
--    escrita. Un staff del tenant A podía colgar turnos/pagos/mensajes/notas
--    de un cliente o turno del tenant B, horarios/bloqueos de un barbero de B
--    o vincular su barbero con un servicio de B (que aparecía en el catálogo
--    público de B). Los triggers exigen que toda referencia sea del mismo
--    tenant. Sólo se evalúan al insertar o cambiar esas columnas, por lo que
--    no afectan filas históricas.
begin;

-- 1. Alta de tenants sólo por RPC/backend.
drop policy if exists "barberias_insert_authenticated" on public.barberias;
revoke insert on table public.barberias from anon, authenticated;

-- 2. Membresías: sin INSERT directo y UPDATE limitado a la columna role.
drop policy if exists "members_insert_owner" on public.barberia_members;
revoke insert on table public.barberia_members from anon, authenticated;
revoke update on table public.barberia_members from anon, authenticated;
grant update (role) on table public.barberia_members to authenticated;

-- 3. Integraciones: lectura para miembros, escritura sólo service_role.
drop policy if exists "saas_integraciones_write_owner" on public.saas_integraciones;
drop policy if exists "saas_integraciones_insert_owner" on public.saas_integraciones;
drop policy if exists "saas_integraciones_update_owner" on public.saas_integraciones;
drop policy if exists "saas_integraciones_delete_owner" on public.saas_integraciones;
revoke insert, update, delete, truncate on table public.saas_integraciones from anon, authenticated;
grant select on table public.saas_integraciones to authenticated;
grant select, insert, update, delete on table public.saas_integraciones to service_role;

-- Función de trigger expuesta por error como RPC (lint de Supabase).
revoke all on function public.crm_normalize_record() from public, anon, authenticated;

-- 4. Coherencia de tenant en referencias.
create or replace function public.enforce_cliente_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.cliente_id is not null and not exists (
    select 1 from public.clientes c
    where c.id = new.cliente_id and c.barberia_id = new.barberia_id
  ) then
    raise exception 'El cliente no pertenece a este negocio.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_pago_turno_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.turno_id is not null and not exists (
    select 1 from public.turnos t
    where t.id = new.turno_id and t.barberia_id = new.barberia_id
  ) then
    raise exception 'El turno no pertenece a este negocio.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_barbero_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.barbero_id is not null and not exists (
    select 1 from public.barberos b
    where b.id = new.barbero_id and b.barberia_id = new.barberia_id
  ) then
    raise exception 'El profesional no pertenece a este negocio.' using errcode = '23503';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_barbero_servicio_same_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.barberos b
    join public.servicios s on s.barberia_id = b.barberia_id
    where b.id = new.barbero_id and s.id = new.servicio_id
  ) then
    raise exception 'El profesional y el servicio deben pertenecer al mismo negocio.' using errcode = '23503';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_turnos_cliente_same_tenant on public.turnos;
create trigger trg_turnos_cliente_same_tenant
before insert or update of cliente_id, barberia_id on public.turnos
for each row execute function public.enforce_cliente_same_tenant();

drop trigger if exists trg_mensajes_cliente_same_tenant on public.mensajes;
create trigger trg_mensajes_cliente_same_tenant
before insert or update of cliente_id, barberia_id on public.mensajes
for each row execute function public.enforce_cliente_same_tenant();

drop trigger if exists trg_notas_cliente_same_tenant on public.notas;
create trigger trg_notas_cliente_same_tenant
before insert or update of cliente_id, barberia_id on public.notas
for each row execute function public.enforce_cliente_same_tenant();

drop trigger if exists trg_pagos_cliente_same_tenant on public.pagos;
create trigger trg_pagos_cliente_same_tenant
before insert or update of cliente_id, barberia_id on public.pagos
for each row execute function public.enforce_cliente_same_tenant();

drop trigger if exists trg_pagos_turno_same_tenant on public.pagos;
create trigger trg_pagos_turno_same_tenant
before insert or update of turno_id, barberia_id on public.pagos
for each row execute function public.enforce_pago_turno_same_tenant();

drop trigger if exists trg_horarios_barbero_same_tenant on public.horarios_barbero;
create trigger trg_horarios_barbero_same_tenant
before insert or update of barbero_id, barberia_id on public.horarios_barbero
for each row execute function public.enforce_barbero_same_tenant();

drop trigger if exists trg_bloqueos_barbero_same_tenant on public.bloqueos_agenda;
create trigger trg_bloqueos_barbero_same_tenant
before insert or update of barbero_id, barberia_id on public.bloqueos_agenda
for each row execute function public.enforce_barbero_same_tenant();

drop trigger if exists trg_barbero_servicios_same_tenant on public.barbero_servicios;
create trigger trg_barbero_servicios_same_tenant
before insert or update of barbero_id, servicio_id on public.barbero_servicios
for each row execute function public.enforce_barbero_servicio_same_tenant();

-- Sólo deben ejecutarse como triggers.
revoke all on function public.enforce_cliente_same_tenant() from public, anon, authenticated;
revoke all on function public.enforce_pago_turno_same_tenant() from public, anon, authenticated;
revoke all on function public.enforce_barbero_same_tenant() from public, anon, authenticated;
revoke all on function public.enforce_barbero_servicio_same_tenant() from public, anon, authenticated;

commit;
