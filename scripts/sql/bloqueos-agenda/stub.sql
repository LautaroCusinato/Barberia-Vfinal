-- Stub mínimo de Supabase y del esquema que tocan los bloqueos (tarea 41).
-- Las tablas reproducen las columnas usadas por bloqueos_agenda y por el
-- trigger validate_turno_business_rules. El DDL de bloqueos_agenda es copia
-- de 20260810171324_qa_base_schema.sql. Las funciones y políticas reales
-- (trigger de turnos, guarda de tenant y políticas vigentes) las aplica
-- run.sh extrayéndolas de las migraciones del repo.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.barberias (id bigint primary key, nombre text, zona_horaria text not null default 'America/Argentina/Buenos_Aires', access text not null default 'active');
create table public.barberia_members (barberia_id bigint references public.barberias(id), user_id uuid, role text);
create table public.barberos (id bigint primary key, barberia_id bigint not null references public.barberias(id), nombre text, activo boolean not null default true);
create table public.servicios (id bigint primary key, barberia_id bigint not null references public.barberias(id), nombre text, duracion_min integer not null, activo boolean not null default true);
create table public.barbero_servicios (barbero_id bigint references public.barberos(id), servicio_id bigint references public.servicios(id), duracion_min integer, primary key (barbero_id, servicio_id));
create table public.horarios_barbero (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id),
  barbero_id bigint not null references public.barberos(id),
  day_of_week smallint not null, start_time time not null, end_time time not null, activo boolean not null default true
);
create table public.bloqueos_agenda (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  barbero_id bigint references public.barberos(id) on delete cascade,
  fecha date not null,
  start_time time not null,
  end_time time not null,
  motivo text not null,
  tipo text not null default 'cierre' check (tipo in ('cierre', 'feriado', 'vacaciones', 'bloqueo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);
create table public.turnos (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id),
  barbero_id bigint not null references public.barberos(id),
  servicio_id bigint not null references public.servicios(id),
  paciente text not null default 'Cliente',
  fecha date not null,
  hora time not null,
  duracion_min integer not null default 30,
  estado text not null default 'confirmado'
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

alter table public.bloqueos_agenda enable row level security;
alter table public.turnos enable row level security;
-- Política de turnos simplificada: la prueba se centra en el trigger.
create policy turnos_staff on public.turnos for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']));

-- Datos: negocio 1 con dueño, admin, recepcionista y barbero; negocio 2 aparte.
insert into public.barberias (id, nombre) values (1, 'Uno'), (2, 'Dos');
insert into public.barberia_members values
  (1, '00000000-0000-0000-0000-00000000000a', 'owner'),
  (1, '00000000-0000-0000-0000-00000000000d', 'admin'),
  (1, '00000000-0000-0000-0000-00000000000c', 'recepcionista'),
  (1, '00000000-0000-0000-0000-00000000000b', 'barbero'),
  (2, '00000000-0000-0000-0000-00000000000e', 'owner');
insert into public.barberos (id, barberia_id, nombre) values (11, 1, 'Lucas'), (12, 1, 'Mora'), (21, 2, 'Otro');
insert into public.servicios (id, barberia_id, nombre, duracion_min) values (1, 1, 'Corte', 30), (2, 2, 'Corte', 30);
insert into public.barbero_servicios (barbero_id, servicio_id) values (11, 1), (12, 1), (21, 2);
insert into public.horarios_barbero (barberia_id, barbero_id, day_of_week, start_time, end_time)
select b.barberia_id, b.id, d, '09:00', '18:00' from public.barberos b cross join generate_series(0, 6) d;
