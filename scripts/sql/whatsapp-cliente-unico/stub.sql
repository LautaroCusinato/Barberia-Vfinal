-- Stub mínimo para crear_reserva_publica y crear_reserva_whatsapp (tarea 35).
-- Copia sólo las columnas y reglas que usan esas RPC; no es el esquema real.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create table public.barberias (
  id bigint primary key,
  nombre text not null,
  slug text unique,
  zona_horaria text not null default 'America/Argentina/Buenos_Aires',
  reservas_publicas boolean not null default true
);
create function public.barberia_access_state(p bigint) returns text language sql stable as $$ select 'active'::text $$;

create table public.saas_integraciones (
  id bigint primary key,
  barberia_id bigint not null references public.barberias(id),
  proveedor text not null,
  integration_type text not null,
  estado text not null
);
create table public.saas_automation_events (
  id bigint generated always as identity primary key,
  tenant_id bigint not null,
  integration_id bigint not null,
  event_id text not null,
  status text not null,
  expires_at timestamptz,
  processed_at timestamptz,
  result_reference text,
  unique (integration_id, event_id)
);
create table public.servicios (
  id bigint primary key,
  barberia_id bigint not null references public.barberias(id),
  nombre text not null,
  precio numeric,
  duracion_min integer not null,
  activo boolean not null default true
);
create table public.barberos (id bigint primary key, barberia_id bigint not null references public.barberias(id), nombre text, activo boolean not null default true);
create table public.barbero_servicios (barbero_id bigint not null, servicio_id bigint not null, duracion_min integer);
create table public.horarios_barbero (barberia_id bigint, barbero_id bigint, day_of_week smallint, start_time time, end_time time, activo boolean default true);
create table public.bloqueos_agenda (barberia_id bigint, fecha date, barbero_id bigint, start_time time, end_time time);
create table public.clientes (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id),
  nombre text not null,
  telefono text,
  email text,
  proximo_turno date,
  unique (barberia_id, telefono)
);
create table public.turnos (
  id bigint generated always as identity primary key,
  barberia_id bigint not null references public.barberias(id),
  cliente_id bigint references public.clientes(id),
  barbero_id bigint,
  servicio_id bigint,
  paciente text,
  telefono text,
  fecha date,
  hora text,
  motivo text,
  estado text,
  precio numeric,
  duracion_min integer,
  origen text,
  inicio_at timestamp,
  fin_at timestamp
);
create function public.t_turno_rango() returns trigger language plpgsql as $$
begin
  new.inicio_at := new.fecha + new.hora::time;
  new.fin_at := new.inicio_at + make_interval(mins => new.duracion_min);
  return new;
end; $$;
create trigger trg_turno_rango before insert or update on public.turnos for each row execute function public.t_turno_rango();

-- Grilla pública simplificada: cada 30 min de 09:00 a 19:00 para los
-- profesionales del negocio que hacen el servicio, sin turnos superpuestos.
create function public.horarios_disponibles_reserva_publica(p_slug text, p_servicio_id bigint, p_fecha date)
returns table (barbero_id bigint, barbero_nombre text, hora time, duracion_min integer)
language sql stable as $$
  select br.id, br.nombre, g.h::time, s.duracion_min
  from public.barberias b
  join public.servicios s on s.barberia_id = b.id and s.id = p_servicio_id
  join public.barberos br on br.barberia_id = b.id and br.activo
  join public.barbero_servicios bs on bs.barbero_id = br.id and bs.servicio_id = s.id
  cross join generate_series(timestamp '2000-01-01 09:00', timestamp '2000-01-01 19:00', interval '30 minutes') g(h)
  where b.slug = p_slug and b.reservas_publicas
    and not exists (
      select 1 from public.turnos t
      where t.barbero_id = br.id and t.estado not in ('cancelado', 'no_asistio')
        and tsrange(t.inicio_at, t.fin_at, '[)') && tsrange(p_fecha + g.h::time, p_fecha + g.h::time + make_interval(mins => s.duracion_min), '[)')
    )
$$;

-- Negocio 1 y 2 con el mismo catálogo; la integración 10 es del negocio 1 y
-- la 20 del negocio 2.
insert into public.barberias (id, nombre, slug) values (1, 'Negocio Uno', 'negocio-uno'), (2, 'Negocio Dos', 'negocio-dos');
insert into public.saas_integraciones values (10, 1, 'evolution', 'whatsapp', 'conectado'), (20, 2, 'evolution', 'whatsapp', 'conectado');
insert into public.servicios values (1, 1, 'Corte', 1000, 30, true), (2, 2, 'Corte', 1000, 30, true);
insert into public.barberos values (1, 1, 'Profe Uno', true), (2, 2, 'Profe Dos', true);
insert into public.barbero_servicios values (1, 1, null), (2, 2, null);
insert into public.horarios_barbero
select b, b, d, '08:00', '21:00', true from generate_series(0, 6) d cross join (values (1), (2)) v(b);
