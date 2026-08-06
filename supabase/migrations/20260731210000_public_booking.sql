-- Reserva pública segura: la disponibilidad y la confirmación se resuelven
-- siempre en la base de datos, no en el navegador.
begin;

create table if not exists public.barbero_servicios (
  barbero_id bigint not null references public.barberos(id) on delete cascade,
  servicio_id bigint not null references public.servicios(id) on delete cascade,
  duracion_min integer check (duracion_min is null or (duracion_min > 0 and duracion_min <= 480)),
  created_at timestamptz not null default now(),
  primary key (barbero_id, servicio_id)
);

alter table public.barbero_servicios enable row level security;

drop policy if exists "barbero_servicios_select_member" on public.barbero_servicios;
create policy "barbero_servicios_select_member"
on public.barbero_servicios for select to authenticated
using (public.is_barberia_member((select barberia_id from public.barberos where id = barbero_id)));

drop policy if exists "barbero_servicios_write_owner" on public.barbero_servicios;
create policy "barbero_servicios_write_owner"
on public.barbero_servicios for all to authenticated
using (public.is_barberia_role((select barberia_id from public.barberos where id = barbero_id), array['owner']))
with check (public.is_barberia_role((select barberia_id from public.barberos where id = barbero_id), array['owner']));

-- Un profesional puede tener más de una franja por día (por ejemplo, antes y
-- después de su pausa). El esquema original solo permitía una.
alter table public.horarios_barbero
  drop constraint if exists horarios_barbero_barbero_id_day_of_week_key;
alter table public.horarios_barbero
  add constraint horarios_barbero_franja_unica unique (barbero_id, day_of_week, start_time, end_time);

-- El origen de turnos se conserva para auditoría y para distinguir reservas web.
alter table public.turnos drop constraint if exists turnos_origen_check;
alter table public.turnos
  add constraint turnos_origen_check check (origen in ('panel', 'whatsapp', 'reserva_web'));

-- Carga inicial verificable a partir del horario que ya estaba configurado en
-- Barbería Central: lunes a viernes de 09:00 a 18:00. En adelante esta tabla
-- es la fuente de verdad para la agenda.
insert into public.horarios_barbero (barberia_id, barbero_id, day_of_week, start_time, end_time)
select b.id, br.id, d.day_of_week, time '09:00', time '18:00'
from public.barberias b
join public.barberos br on br.barberia_id = b.id and br.activo
cross join generate_series(1, 5) as d(day_of_week)
where b.slug = 'barberia-central'
on conflict (barbero_id, day_of_week, start_time, end_time) do nothing;

-- En la configuración existente, habilidades vacías significaban "todos los
-- servicios". Conservamos exactamente esa regla para Barbería Central, pero
-- en un modelo relacional estable frente a renombres de servicios.
insert into public.barbero_servicios (barbero_id, servicio_id)
select br.id, s.id
from public.barberias b
join public.barberos br on br.barberia_id = b.id and br.activo
join public.servicios s on s.barberia_id = b.id and s.activo
where b.slug = 'barberia-central'
on conflict do nothing;

create index if not exists idx_barbero_servicios_servicio
  on public.barbero_servicios (servicio_id, barbero_id);
create index if not exists idx_horarios_barbero_busqueda
  on public.horarios_barbero (barbero_id, day_of_week, start_time, end_time)
  where activo;
create index if not exists idx_bloqueos_agenda_disponibilidad
  on public.bloqueos_agenda (barberia_id, fecha, barbero_id, start_time, end_time);

create or replace function public.catalogo_reserva_publica(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'barberia', jsonb_build_object(
      'nombre', b.nombre,
      'slug', b.slug,
      'logo_url', b.logo_url,
      'color_principal', b.color_principal,
      'color_secundario', b.color_secundario,
      'whatsapp', b.whatsapp,
      'direccion', b.direccion,
      'zona_horaria', b.zona_horaria
    ),
    'servicios', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'nombre', s.nombre, 'descripcion', s.descripcion,
        'precio', s.precio, 'duracion_min', s.duracion_min
      ) order by s.nombre)
      from public.servicios s
      where s.barberia_id = b.id and s.activo
        and exists (
          select 1 from public.barbero_servicios bs
          join public.barberos br on br.id = bs.barbero_id
          where bs.servicio_id = s.id and br.activo
        )
    ), '[]'::jsonb)
  )
  from public.barberias b
  where b.slug = p_slug;
$$;

create or replace function public.horarios_disponibles_reserva_publica(
  p_slug text,
  p_servicio_id bigint,
  p_fecha date
)
returns table (
  barbero_id bigint,
  barbero_nombre text,
  barbero_color text,
  duracion_min integer,
  hora time
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with negocio as (
    select id, zona_horaria from public.barberias where slug = p_slug
  ), candidatos as (
    select br.id, br.nombre, br.color, coalesce(bs.duracion_min, s.duracion_min) as duracion_min, n.id as barberia_id, n.zona_horaria
    from negocio n
    join public.servicios s on s.id = p_servicio_id and s.barberia_id = n.id and s.activo
    join public.barbero_servicios bs on bs.servicio_id = s.id
    join public.barberos br on br.id = bs.barbero_id and br.barberia_id = n.id and br.activo
  ), franjas as (
    select c.*, h.start_time, h.end_time
    from candidatos c
    join public.horarios_barbero h on h.barbero_id = c.id
      and h.barberia_id = c.barberia_id
      and h.activo
      and h.day_of_week = extract(dow from p_fecha)::smallint
  ), opciones as (
    select f.*, slot::time as hora, slot as inicio_at,
      slot + make_interval(mins => f.duracion_min) as fin_at
    from franjas f
    cross join lateral generate_series(
      p_fecha::timestamp + f.start_time,
      p_fecha::timestamp + f.end_time - make_interval(mins => f.duracion_min),
      interval '15 minutes'
    ) as slot
  )
  select o.id, o.nombre, o.color, o.duracion_min, o.hora
  from opciones o
  where o.inicio_at >= (now() at time zone o.zona_horaria)
    and not exists (
      select 1 from public.turnos t
      where t.barbero_id = o.id
        and t.estado not in ('cancelado', 'no_asistio')
        and tsrange(t.inicio_at, t.fin_at, '[)') && tsrange(o.inicio_at, o.fin_at, '[)')
    )
    and not exists (
      select 1 from public.bloqueos_agenda ba
      where ba.barberia_id = o.barberia_id
        and ba.fecha = p_fecha
        and (ba.barbero_id is null or ba.barbero_id = o.id)
        and tsrange(p_fecha::timestamp + ba.start_time, p_fecha::timestamp + ba.end_time, '[)')
            && tsrange(o.inicio_at, o.fin_at, '[)')
    )
  order by o.nombre, o.hora;
$$;

create or replace function public.crear_reserva_publica(
  p_slug text,
  p_servicio_id bigint,
  p_barbero_id bigint,
  p_fecha date,
  p_hora time,
  p_nombre text,
  p_telefono text,
  p_email text default null
)
returns table (turno_id bigint, fecha date, hora time, duracion_min integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_barberia public.barberias%rowtype;
  v_servicio public.servicios%rowtype;
  v_duracion integer;
  v_cliente_id bigint;
  v_inicio timestamp;
  v_fin timestamp;
begin
  if nullif(btrim(p_nombre), '') is null or nullif(btrim(p_telefono), '') is null then
    raise exception 'Ingresá tu nombre y teléfono.' using errcode = '22023';
  end if;

  select * into v_barberia from public.barberias where slug = p_slug;
  if not found then
    raise exception 'La barbería no existe.' using errcode = '22023';
  end if;

  select s.* into v_servicio
  from public.servicios s
  where s.id = p_servicio_id and s.barberia_id = v_barberia.id and s.activo;
  if not found then
    raise exception 'El servicio ya no está disponible.' using errcode = '22023';
  end if;

  select coalesce(bs.duracion_min, v_servicio.duracion_min) into v_duracion
  from public.barbero_servicios bs
  join public.barberos br on br.id = bs.barbero_id
  where bs.barbero_id = p_barbero_id
    and bs.servicio_id = v_servicio.id
    and br.barberia_id = v_barberia.id
    and br.activo;
  if not found then
    raise exception 'El profesional ya no realiza este servicio.' using errcode = '22023';
  end if;

  v_inicio := p_fecha::timestamp + p_hora;
  v_fin := v_inicio + make_interval(mins => v_duracion);
  if v_inicio < (now() at time zone v_barberia.zona_horaria) then
    raise exception 'Ese horario ya pasó. Elegí uno disponible.' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.horarios_barbero h
    where h.barberia_id = v_barberia.id and h.barbero_id = p_barbero_id and h.activo
      and h.day_of_week = extract(dow from p_fecha)::smallint
      and v_inicio::time >= h.start_time and v_fin::time <= h.end_time
  ) then
    raise exception 'El profesional no trabaja en ese horario.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.bloqueos_agenda ba
    where ba.barberia_id = v_barberia.id and ba.fecha = p_fecha
      and (ba.barbero_id is null or ba.barbero_id = p_barbero_id)
      and tsrange(p_fecha::timestamp + ba.start_time, p_fecha::timestamp + ba.end_time, '[)')
          && tsrange(v_inicio, v_fin, '[)')
  ) then
    raise exception 'Ese horario fue bloqueado. Elegí otro.' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.turnos t
    where t.barbero_id = p_barbero_id and t.estado not in ('cancelado', 'no_asistio')
      and tsrange(t.inicio_at, t.fin_at, '[)') && tsrange(v_inicio, v_fin, '[)')
  ) then
    raise exception 'Ese horario acaba de ocuparse. Elegí otro.' using errcode = '23P01';
  end if;

  insert into public.clientes (barberia_id, nombre, telefono, email, proximo_turno)
  values (v_barberia.id, btrim(p_nombre), btrim(p_telefono), nullif(btrim(p_email), ''), p_fecha)
  on conflict (barberia_id, telefono) do update
    set nombre = excluded.nombre,
        email = coalesce(excluded.email, public.clientes.email),
        proximo_turno = excluded.proximo_turno
  returning id into v_cliente_id;

  insert into public.turnos (
    barberia_id, cliente_id, barbero_id, servicio_id, paciente, telefono,
    fecha, hora, motivo, estado, precio, duracion_min, origen
  ) values (
    v_barberia.id, v_cliente_id, p_barbero_id, v_servicio.id, btrim(p_nombre), btrim(p_telefono),
    p_fecha, to_char(p_hora, 'HH24:MI'), v_servicio.nombre, 'confirmado', v_servicio.precio, v_duracion, 'reserva_web'
  ) returning public.turnos.id, public.turnos.fecha, public.turnos.hora::time, public.turnos.duracion_min
    into turno_id, fecha, hora, duracion_min;

  return next;
exception when exclusion_violation then
  raise exception 'Ese horario acaba de ocuparse. Elegí otro.' using errcode = '23P01';
end;
$$;

revoke all on function public.catalogo_reserva_publica(text) from public;
revoke all on function public.horarios_disponibles_reserva_publica(text, bigint, date) from public;
revoke all on function public.crear_reserva_publica(text, bigint, bigint, date, time, text, text, text) from public;
grant execute on function public.catalogo_reserva_publica(text) to anon, authenticated;
grant execute on function public.horarios_disponibles_reserva_publica(text, bigint, date) to anon, authenticated;
grant execute on function public.crear_reserva_publica(text, bigint, bigint, date, time, text, text, text) to anon, authenticated;

commit;
