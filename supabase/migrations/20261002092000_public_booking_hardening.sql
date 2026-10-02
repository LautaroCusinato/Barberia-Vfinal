-- Endurece la RPC pública crear_reserva_publica (rol anon).
--
-- Por qué: la RPC seguía en su versión original (20260731210000). La página
-- pública respeta la configuración del negocio porque consulta
-- horarios_disponibles_reserva_publica, pero cualquiera puede llamar a la RPC
-- de creación directamente con la anon key y así:
--   * reservar aunque el owner haya desactivado `reservas_publicas`;
--   * reservar fuera del horizonte `max_dias_reserva` (p. ej. dentro de años)
--     y sin la `anticipacion_minutos` configurada;
--   * reservar en horarios desalineados de la grilla (10:07), fragmentando la
--     agenda;
--   * sobrescribir el nombre y el email de un cliente existente del negocio
--     con sólo conocer su teléfono;
--   * enviar nombres/emails sin límite de tamaño y crear reservas ilimitadas
--     desde un mismo teléfono.
-- La regla autoritativa pasa a ser "el horario pedido debe ser uno de los que
-- ofrece horarios_disponibles_reserva_publica", la misma RPC que usa la página
-- y que ya usa simular_reserva_whatsapp. Se agrega un tope de reservas web
-- activas por teléfono y negocio. La firma, los grants y el formato de
-- respuesta no cambian.
begin;

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
  -- Tope de reservas web futuras y activas por teléfono y negocio. Frena el
  -- abuso trivial (llenar la agenda desde un mismo número) sin afectar a un
  -- cliente que reserva para sí y su familia.
  c_max_reservas_activas constant integer := 5;
  v_barberia public.barberias%rowtype;
  v_servicio public.servicios%rowtype;
  v_duracion integer;
  v_cliente_id bigint;
  v_inicio timestamp;
  v_fin timestamp;
  v_hoy date;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_telefono text := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  v_activas integer;
begin
  if v_nombre = '' or v_telefono = '' then
    raise exception 'Ingresá tu nombre y teléfono.' using errcode = '22023';
  end if;
  if char_length(v_nombre) > 120 then
    raise exception 'El nombre es demasiado largo.' using errcode = '22023';
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'El email no es válido.' using errcode = '22023';
  end if;
  if v_telefono !~ '^549[1-9][0-9]{9}$' then
    raise exception 'El teléfono debe ser un celular argentino: 549 + código de área + número (13 dígitos).' using errcode = '22023';
  end if;
  if p_servicio_id is null or p_barbero_id is null or p_fecha is null or p_hora is null then
    raise exception 'Elegí servicio, profesional, fecha y horario.' using errcode = '22023';
  end if;

  select * into v_barberia from public.barberias where slug = p_slug;
  if not found then
    raise exception 'La barbería no existe.' using errcode = '22023';
  end if;
  if not coalesce(v_barberia.reservas_publicas, false) then
    raise exception 'Este negocio no acepta reservas online en este momento.' using errcode = '22023';
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
  v_hoy := (now() at time zone v_barberia.zona_horaria)::date;
  if v_inicio < (now() at time zone v_barberia.zona_horaria) then
    raise exception 'Ese horario ya pasó. Elegí uno disponible.' using errcode = '22023';
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

  -- Regla autoritativa: sólo se confirma un horario que la RPC de
  -- disponibilidad ofrece (reservas_publicas, horizonte, anticipación,
  -- grilla, jornada, bloqueos y turnos existentes).
  if not exists (
    select 1
    from public.horarios_disponibles_reserva_publica(v_barberia.slug, v_servicio.id, p_fecha) h
    where h.barbero_id = p_barbero_id
      and h.hora = p_hora
  ) then
    raise exception 'Ese horario no está disponible. Elegí uno de los horarios ofrecidos.' using errcode = '23P01';
  end if;

  -- Serializa reservas concurrentes del mismo teléfono en el mismo negocio
  -- para que el tope no se pueda saltear en paralelo.
  perform pg_advisory_xact_lock(hashtextextended('crear_reserva_publica:' || v_barberia.id::text || ':' || v_telefono, 0));
  select count(*) into v_activas
  from public.turnos t
  where t.barberia_id = v_barberia.id
    and t.telefono = v_telefono
    and t.origen = 'reserva_web'
    and t.estado not in ('cancelado', 'no_asistio', 'atendido')
    and t.inicio_at >= (now() at time zone v_barberia.zona_horaria);
  if v_activas >= c_max_reservas_activas then
    raise exception 'Ya tenés varias reservas activas con este teléfono. Para otra, comunicate con el negocio.' using errcode = '22023';
  end if;

  -- Un cliente existente no se modifica desde la web pública: sólo se
  -- completan datos faltantes. El nombre informado queda en el turno.
  insert into public.clientes (barberia_id, nombre, telefono, email, proximo_turno)
  values (v_barberia.id, v_nombre, v_telefono, v_email, p_fecha)
  on conflict (barberia_id, telefono) do update
    set nombre = case when nullif(btrim(public.clientes.nombre), '') is null then excluded.nombre else public.clientes.nombre end,
        email = coalesce(public.clientes.email, excluded.email),
        proximo_turno = case
          when public.clientes.proximo_turno is null
            or public.clientes.proximo_turno < v_hoy
            or excluded.proximo_turno < public.clientes.proximo_turno
          then excluded.proximo_turno
          else public.clientes.proximo_turno
        end
  returning id into v_cliente_id;

  insert into public.turnos (
    barberia_id, cliente_id, barbero_id, servicio_id, paciente, telefono,
    fecha, hora, motivo, estado, precio, duracion_min, origen
  ) values (
    v_barberia.id, v_cliente_id, p_barbero_id, v_servicio.id, v_nombre, v_telefono,
    p_fecha, to_char(p_hora, 'HH24:MI'), v_servicio.nombre, 'confirmado', v_servicio.precio, v_duracion, 'reserva_web'
  ) returning public.turnos.id, public.turnos.fecha, public.turnos.hora::time, public.turnos.duracion_min
    into turno_id, fecha, hora, duracion_min;

  return next;
exception when exclusion_violation then
  raise exception 'Ese horario acaba de ocuparse. Elegí otro.' using errcode = '23P01';
end;
$$;

revoke all on function public.crear_reserva_publica(text, bigint, bigint, date, time, text, text, text) from public;
grant execute on function public.crear_reserva_publica(text, bigint, bigint, date, time, text, text, text) to anon, authenticated;

commit;
