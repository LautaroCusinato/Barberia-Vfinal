-- Schema production para barberias multi-negocio con Supabase Auth + RLS.
-- Pensado para un proyecto nuevo o una base vacia.

begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.set_turno_times()
returns trigger
language plpgsql
as $$
begin
  new.hora_time := new.hora::time;
  new.inicio_at := new.fecha::timestamp + new.hora_time;
  new.fin_at := new.inicio_at + make_interval(mins => new.duracion_min);
  return new;
end;
$$;

create table if not exists public.barberias (
  id bigint generated always as identity primary key,
  nombre text not null,
  slug text not null unique,
  logo_url text,
  color_principal text,
  color_secundario text,
  whatsapp text,
  direccion text,
  zona_horaria text not null default 'America/Argentina/Buenos_Aires',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.barberia_members (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'barbero', 'recepcionista')),
  created_at timestamptz not null default now(),
  unique (barberia_id, user_id)
);

create table if not exists public.servicios (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  nombre text not null,
  descripcion text,
  precio numeric(12,2) not null default 0 check (precio >= 0),
  duracion_min integer not null default 30 check (duracion_min > 0 and duracion_min <= 480),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, nombre)
);

create table if not exists public.barberos (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  user_id uuid unique references auth.users(id) on delete set null,
  nombre text not null,
  especialidad text,
  color text not null default '#9B6A2F',
  horario_texto text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, nombre)
);

create table if not exists public.clientes (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  nombre text not null,
  apellido text,
  telefono text,
  email text,
  ultima_visita date,
  proximo_turno date,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barberia_id, telefono)
);

create table if not exists public.turnos (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  cliente_id bigint references public.clientes(id) on delete set null,
  barbero_id bigint not null references public.barberos(id) on delete restrict,
  servicio_id bigint not null references public.servicios(id) on delete restrict,
  paciente text not null,
  fecha date not null,
  hora text not null check (hora ~ '^[0-2][0-9]:[0-5][0-9]$'),
  motivo text not null,
  -- La barberia solo maneja 3 estados reales (a diferencia del panel
  -- dental original, que tenia pendiente/llego/en_atencion como pasos
  -- intermedios). Un turno nace confirmado y despues se resuelve como
  -- atendido o no_asistio.
  estado text not null default 'confirmado' check (estado in ('confirmado', 'atendido', 'no_asistio')),
  precio numeric(12,2) not null default 0 check (precio >= 0),
  duracion_min integer not null default 30 check (duracion_min > 0 and duracion_min <= 480),
  recordatorio_enviado boolean not null default false,
  notas_internas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  hora_time time,
  inicio_at timestamp,
  fin_at timestamp
);

create table if not exists public.mensajes (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  cliente_id bigint references public.clientes(id) on delete set null,
  paciente text not null,
  texto text not null,
  de text not null check (de in ('paciente', 'bot', 'clinica')),
  hora text,
  leido boolean not null default false,
  enviado_wsp boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notas (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  cliente_id bigint references public.clientes(id) on delete set null,
  paciente text not null default 'General',
  texto text not null,
  fecha date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.config (
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  clave text not null,
  valor text not null,
  updated_at timestamptz not null default now(),
  primary key (barberia_id, clave)
);

create table if not exists public.horarios_barbero (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  barbero_id bigint not null references public.barberos(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time),
  unique (barbero_id, day_of_week)
);

create table if not exists public.bloqueos_agenda (
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.handle_new_barberia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    insert into public.barberia_members (barberia_id, user_id, role)
    values (new.id, auth.uid(), 'owner')
    on conflict (barberia_id, user_id) do nothing;
  end if;

  return new;
end;
$$;

create or replace function public.my_barberia_role(p_barberia_id bigint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.barberia_members m
  where m.barberia_id = p_barberia_id
    and m.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_barberia_member(p_barberia_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_barberia_role(p_barberia_id) is not null;
$$;

create or replace function public.is_barberia_role(p_barberia_id bigint, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.my_barberia_role(p_barberia_id) = any (allowed_roles);
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_barberias_updated_at on public.barberias;
create trigger trg_barberias_updated_at
before update on public.barberias
for each row execute function public.set_updated_at();

drop trigger if exists trg_barberias_owner on public.barberias;
create trigger trg_barberias_owner
after insert on public.barberias
for each row execute function public.handle_new_barberia();

drop trigger if exists trg_servicios_updated_at on public.servicios;
create trigger trg_servicios_updated_at
before update on public.servicios
for each row execute function public.set_updated_at();

drop trigger if exists trg_barberos_updated_at on public.barberos;
create trigger trg_barberos_updated_at
before update on public.barberos
for each row execute function public.set_updated_at();

drop trigger if exists trg_clientes_updated_at on public.clientes;
create trigger trg_clientes_updated_at
before update on public.clientes
for each row execute function public.set_updated_at();

drop trigger if exists trg_turnos_updated_at on public.turnos;
create trigger trg_turnos_updated_at
before update on public.turnos
for each row execute function public.set_updated_at();

drop trigger if exists trg_turnos_schedule on public.turnos;
create trigger trg_turnos_schedule
before insert or update of fecha, hora, duracion_min on public.turnos
for each row execute function public.set_turno_times();

drop trigger if exists trg_mensajes_updated_at on public.mensajes;
create trigger trg_mensajes_updated_at
before update on public.mensajes
for each row execute function public.set_updated_at();

drop trigger if exists trg_notas_updated_at on public.notas;
create trigger trg_notas_updated_at
before update on public.notas
for each row execute function public.set_updated_at();

drop trigger if exists trg_config_updated_at on public.config;
create trigger trg_config_updated_at
before update on public.config
for each row execute function public.set_updated_at();

drop trigger if exists trg_horarios_barbero_updated_at on public.horarios_barbero;
create trigger trg_horarios_barbero_updated_at
before update on public.horarios_barbero
for each row execute function public.set_updated_at();

drop trigger if exists trg_bloqueos_agenda_updated_at on public.bloqueos_agenda;
create trigger trg_bloqueos_agenda_updated_at
before update on public.bloqueos_agenda
for each row execute function public.set_updated_at();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.turnos
  add constraint turnos_no_overlap_per_barbero
  exclude using gist (
    barberia_id with =,
    barbero_id with =,
    tsrange(inicio_at, fin_at, '[)') with &&
  )
  where (estado <> 'no_asistio');

create index if not exists idx_barberia_members_user on public.barberia_members (user_id);
create index if not exists idx_barberia_members_barberia on public.barberia_members (barberia_id);
create index if not exists idx_servicios_barberia on public.servicios (barberia_id);
create index if not exists idx_barberos_barberia on public.barberos (barberia_id);
create index if not exists idx_clientes_barberia on public.clientes (barberia_id);
create index if not exists idx_turnos_barberia_fecha on public.turnos (barberia_id, fecha);
create index if not exists idx_turnos_barbero_fecha on public.turnos (barbero_id, fecha);
create index if not exists idx_mensajes_barberia on public.mensajes (barberia_id, created_at desc);
create index if not exists idx_notas_barberia on public.notas (barberia_id, fecha desc);
create index if not exists idx_config_barberia on public.config (barberia_id);

alter table public.barberias enable row level security;
alter table public.profiles enable row level security;
alter table public.barberia_members enable row level security;
alter table public.servicios enable row level security;
alter table public.barberos enable row level security;
alter table public.clientes enable row level security;
alter table public.turnos enable row level security;
alter table public.mensajes enable row level security;
alter table public.notas enable row level security;
alter table public.config enable row level security;
alter table public.horarios_barbero enable row level security;
alter table public.bloqueos_agenda enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "barberias_select_member" on public.barberias;
create policy "barberias_select_member"
on public.barberias
for select
using (public.is_barberia_member(id));

drop policy if exists "barberias_insert_authenticated" on public.barberias;
create policy "barberias_insert_authenticated"
on public.barberias
for insert
with check (auth.uid() is not null);

drop policy if exists "barberias_update_owner" on public.barberias;
create policy "barberias_update_owner"
on public.barberias
for update
using (public.is_barberia_role(id, array['owner']))
with check (public.is_barberia_role(id, array['owner']));

drop policy if exists "members_select_member" on public.barberia_members;
create policy "members_select_member"
on public.barberia_members
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "members_insert_owner" on public.barberia_members;
create policy "members_insert_owner"
on public.barberia_members
for insert
with check (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "members_update_owner" on public.barberia_members;
create policy "members_update_owner"
on public.barberia_members
for update
using (public.is_barberia_role(barberia_id, array['owner']))
with check (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "members_delete_owner" on public.barberia_members;
create policy "members_delete_owner"
on public.barberia_members
for delete
using (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "servicios_select_member" on public.servicios;
create policy "servicios_select_member"
on public.servicios
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "servicios_write_owner" on public.servicios;
create policy "servicios_write_owner"
on public.servicios
for all
using (public.is_barberia_role(barberia_id, array['owner']))
with check (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "barberos_select_member" on public.barberos;
create policy "barberos_select_member"
on public.barberos
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "barberos_write_owner" on public.barberos;
create policy "barberos_write_owner"
on public.barberos
for all
using (public.is_barberia_role(barberia_id, array['owner']))
with check (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "clientes_select_member" on public.clientes;
create policy "clientes_select_member"
on public.clientes
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "clientes_write_staff" on public.clientes;
create policy "clientes_write_staff"
on public.clientes
for all
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']));

drop policy if exists "turnos_select_member" on public.turnos;
create policy "turnos_select_member"
on public.turnos
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "turnos_write_staff" on public.turnos;
create policy "turnos_write_staff"
on public.turnos
for all
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']));

drop policy if exists "mensajes_select_member" on public.mensajes;
create policy "mensajes_select_member"
on public.mensajes
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "mensajes_write_staff" on public.mensajes;
create policy "mensajes_write_staff"
on public.mensajes
for all
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']));

drop policy if exists "notas_select_member" on public.notas;
create policy "notas_select_member"
on public.notas
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "notas_write_staff" on public.notas;
create policy "notas_write_staff"
on public.notas
for all
using (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']))
with check (public.is_barberia_role(barberia_id, array['owner', 'recepcionista', 'barbero']));

drop policy if exists "config_select_member" on public.config;
create policy "config_select_member"
on public.config
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "config_write_owner" on public.config;
create policy "config_write_owner"
on public.config
for all
using (public.is_barberia_role(barberia_id, array['owner']))
with check (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "horarios_select_member" on public.horarios_barbero;
create policy "horarios_select_member"
on public.horarios_barbero
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "horarios_write_owner" on public.horarios_barbero;
create policy "horarios_write_owner"
on public.horarios_barbero
for all
using (public.is_barberia_role(barberia_id, array['owner']))
with check (public.is_barberia_role(barberia_id, array['owner']));

drop policy if exists "bloqueos_select_member" on public.bloqueos_agenda;
create policy "bloqueos_select_member"
on public.bloqueos_agenda
for select
using (public.is_barberia_member(barberia_id));

drop policy if exists "bloqueos_write_owner" on public.bloqueos_agenda;
create policy "bloqueos_write_owner"
on public.bloqueos_agenda
for all
using (public.is_barberia_role(barberia_id, array['owner']))
with check (public.is_barberia_role(barberia_id, array['owner']));

insert into public.config (barberia_id, clave, valor)
select b.id, 'bot_activo', 'true'
from public.barberias b
on conflict (barberia_id, clave) do nothing;

commit;
