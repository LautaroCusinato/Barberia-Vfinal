-- Stub mínimo de Supabase con las tablas, el trigger y la política que tocan
-- las RPC del envío del panel (definiciones copiadas de las migraciones).
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.barberias (id bigint primary key, nombre text, access text not null default 'active');
create table public.barberia_members (barberia_id bigint references public.barberias(id), user_id uuid, role text);
create table public.clientes (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  nombre text not null,
  telefono text,
  unique (barberia_id, telefono)
);
-- public.mensajes como en 20260810171324_qa_base_schema.sql.
create table public.mensajes (
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
  updated_at timestamptz not null default now(),
  telefono text,
  whatsapp_id text,
  estado_envio text not null default 'enviado'
);
create table public.config (
  barberia_id bigint not null references public.barberias(id) on delete cascade,
  clave text not null,
  valor text not null,
  updated_at timestamptz not null default now(),
  primary key (barberia_id, clave)
);
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;

create function public.my_barberia_role(p bigint) returns text language sql stable security definer set search_path = public as $$
  select m.role from public.barberia_members m where m.barberia_id = p and m.user_id = auth.uid() limit 1 $$;
create function public.is_barberia_role(p bigint, allowed_roles text[]) returns boolean language sql stable security definer set search_path = public as $$
  select public.my_barberia_role(p) = any (allowed_roles) $$;
create function public.barberia_operational_access(p bigint) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(exists (select 1 from public.barberia_members m where m.barberia_id = p and m.user_id = auth.uid())
    and (select access from public.barberias where id = p) in ('active', 'trialing', 'past_due'), false) $$;

alter table public.mensajes enable row level security;
create policy "mensajes_write_staff" on public.mensajes for all to authenticated
using (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id))
with check (public.is_barberia_role(barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) and public.barberia_operational_access(barberia_id));

-- 20261002091000_tenant_write_boundaries.sql
create function public.enforce_cliente_same_tenant() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.cliente_id is not null and not exists (select 1 from public.clientes c where c.id = new.cliente_id and c.barberia_id = new.barberia_id) then
    raise exception 'El cliente no pertenece a este negocio.' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger trg_mensajes_cliente_same_tenant before insert or update of cliente_id, barberia_id on public.mensajes
for each row execute function public.enforce_cliente_same_tenant();

create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger trg_mensajes_updated_at before update on public.mensajes for each row execute function public.set_updated_at();

-- Datos: negocio 1 (Ana, Beto sin 9, Caro fijo), negocio 2 (Zoe).
insert into public.barberias (id, nombre) values (1, 'Uno'), (2, 'Dos');
insert into public.barberia_members values (1, '00000000-0000-0000-0000-00000000000a', 'owner'), (1, '00000000-0000-0000-0000-00000000000c', 'readonly');
insert into public.clientes (barberia_id, nombre, telefono) values
  (1, 'Ana Pérez', '+54 9 11 2233-4455'),
  (1, 'Beto Ruiz', '54 11 6666 7777'),
  (1, 'Caro Fijo', '011 4444-5555'),
  (2, 'Zoe Ajena', '5491199998888');
-- Fila histórica con un valor que la restricción nueva no permite: NOT VALID
-- no debe fallar por ella.
insert into public.mensajes (barberia_id, cliente_id, paciente, texto, de, estado_envio, created_at) values (1, 1, 'Ana Pérez', 'histórico', 'clinica', 'legado_raro', '2026-01-01');
