-- Contrato mínimo de catálogo; no reproduce todas las migraciones ni RLS real.
create role anon nologin;
create role authenticated nologin;
create table public.barberias (
  id bigint primary key, nombre text, slug text unique, moneda text,
  logo_url text, color_principal text, color_secundario text, whatsapp text,
  direccion text, zona_horaria text default 'America/Argentina/Buenos_Aires',
  reservas_publicas boolean default true, max_dias_reserva integer default 30,
  billing_email text default 'privado@example.invalid', metadata jsonb default '{"private":"fixture-private-value"}'
);
create table public.servicios (
  id bigint primary key, barberia_id bigint references public.barberias,
  nombre text, descripcion text, precio numeric, duracion_min integer, activo boolean default true
);
create table public.barberos (id bigint primary key, activo boolean default true);
create table public.barbero_servicios (barbero_id bigint references public.barberos, servicio_id bigint references public.servicios);
alter table public.barberias enable row level security;
alter table public.servicios enable row level security;
alter table public.barberos enable row level security;
alter table public.barbero_servicios enable row level security;
revoke all on all tables in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;

insert into public.barberias(id,nombre,slug,moneda,reservas_publicas) values
  (1,'Negocio ARS','local-ars','ARS',true), (2,'Negocio USD','local-usd','USD',true),
  (3,'Negocio pausado','local-pausado','USD',false), (4,'Legado','local-legado',null,true);
insert into public.barberos values (1,true),(2,false);
insert into public.servicios(id,barberia_id,nombre,precio,duracion_min,activo) values
  (1,1,'Corte ARS',10000,30,true), (2,2,'Corte USD',25.50,45,true),
  (3,1,'Inactivo',200,20,false), (4,1,'Sin profesional',300,20,true),
  (5,1,'Profesional inactivo',400,20,true), (6,4,'Corte legado',500,30,true);
insert into public.barbero_servicios values (1,1),(1,2),(1,3),(2,5),(1,6);

create function public.t_assert(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %',label; end if;
  raise notice 'PASS: %', label;
end;
$$;
