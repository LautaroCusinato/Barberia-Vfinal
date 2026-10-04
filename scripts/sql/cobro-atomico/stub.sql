-- Stub mínimo de Supabase + tablas/políticas relevantes (copiadas del repo).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.barberias (id bigint primary key, nombre text, access text not null default 'active');
create table public.barberia_members (barberia_id bigint references public.barberias(id), user_id uuid, role text);
create table public.clientes (id bigint generated always as identity primary key, barberia_id bigint not null references public.barberias(id), nombre text);
create table public.servicios (id bigint generated always as identity primary key, barberia_id bigint not null references public.barberias(id), nombre text);
create table public.turnos (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id),
  cliente_id bigint references public.clientes(id),
  servicio_id bigint not null references public.servicios(id),
  paciente text not null,
  motivo text not null,
  estado text not null default 'confirmado' check (estado in ('pendiente', 'confirmado', 'llego', 'en_atencion', 'atendido', 'cancelado', 'no_asistio'))
);
create table public.pagos (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  turno_id bigint references public.turnos(id) on delete set null,
  cliente_id bigint references public.clientes(id) on delete set null,
  paciente text,
  servicio text,
  monto numeric(12,2) not null check (monto >= 0),
  metodo text not null check (metodo in ('efectivo', 'mercadopago', 'transferencia')),
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on all tables in schema public to authenticated;

create function public.my_barberia_role(p bigint) returns text language sql stable security definer set search_path = public as $$
  select m.role from public.barberia_members m where m.barberia_id = p and m.user_id = auth.uid() limit 1 $$;
create function public.is_barberia_member(p bigint) returns boolean language sql stable security definer set search_path = public as $$
  select public.my_barberia_role(p) is not null $$;
create function public.is_barberia_role(p bigint, allowed_roles text[]) returns boolean language sql stable security definer set search_path = public as $$
  select public.my_barberia_role(p) = any (allowed_roles) $$;
create function public.barberia_operational_access(p bigint) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(exists (select 1 from public.barberia_members m where m.barberia_id = p and m.user_id = auth.uid())
    and (select access from public.barberias where id = p) in ('active', 'trialing', 'past_due'), false) $$;
revoke all on function public.my_barberia_role(bigint) from public, anon, authenticated;

alter table public.turnos enable row level security;
alter table public.pagos enable row level security;
alter table public.servicios enable row level security;
create policy turnos_select_member on public.turnos for select to authenticated using (public.is_barberia_member(barberia_id));
create policy servicios_select_member on public.servicios for select to authenticated using (public.is_barberia_member(barberia_id));
create policy pagos_select_member on public.pagos for select to authenticated using (public.is_barberia_member(barberia_id));
create policy "turnos_write_staff" on public.turnos for all
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));
create policy "pagos_write_staff" on public.pagos for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));

create function public.enforce_pago_turno_same_tenant() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.turno_id is not null and not exists (select 1 from public.turnos t where t.id = new.turno_id and t.barberia_id = new.barberia_id) then
    raise exception 'El turno no pertenece a este negocio.' using errcode = '23503';
  end if;
  return new;
end; $$;
create trigger trg_pagos_turno_same_tenant before insert or update of turno_id, barberia_id on public.pagos
for each row execute function public.enforce_pago_turno_same_tenant();

-- Datos: negocio 1 (activo), negocio 2 (otro tenant), negocio 3 (vencido).
insert into public.barberias values (1, 'A', 'active'), (2, 'B', 'active'), (3, 'C', 'expired');
insert into public.barberia_members values
  (1, '00000000-0000-0000-0000-00000000000a', 'owner'),
  (1, '00000000-0000-0000-0000-00000000000b', 'empleado'),
  (1, '00000000-0000-0000-0000-00000000000c', 'readonly'),
  (2, '00000000-0000-0000-0000-00000000000d', 'owner'),
  (3, '00000000-0000-0000-0000-00000000000e', 'owner');
insert into public.servicios (barberia_id, nombre) values (1, 'Corte'), (2, 'Corte B'), (3, 'Corte C');
insert into public.turnos (barberia_id, servicio_id, paciente, motivo) values
  (1, 1, 'Ana', 'Corte'), (1, 1, 'Luis', 'Corte'), (1, 1, 'Concurrente', 'Corte'), (1, 1, 'Dos operadores', 'Corte'),
  (2, 2, 'Ajeno', 'Corte'), (3, 3, 'Vencido', 'Corte'), (1, 1, 'Historico', 'Corte');
-- Pago histórico previo a la migración (sin clave).
insert into public.pagos (barberia_id, turno_id, paciente, monto, metodo) values (1, 7, 'Historico', 100, 'efectivo');
