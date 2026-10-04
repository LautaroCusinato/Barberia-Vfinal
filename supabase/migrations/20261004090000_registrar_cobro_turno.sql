-- Cobro atómico de un turno atendido (tarea 05).
--
-- Por qué: el panel marcaba el turno como "atendido" con un UPDATE y después
-- insertaba el pago con otro request. Si el INSERT fallaba, el turno quedaba
-- atendido sin cobro; si la respuesta se perdía y la persona reintentaba, se
-- duplicaba el pago. Esta RPC hace las dos escrituras en una transacción.
--
-- Contrato:
--   * El paso a "atendido" registra exactamente un cobro. Si el turno ya está
--     atendido se rechaza (hint turno_ya_atendido): cubre a dos operadores con
--     la agenda desactualizada. Cobros parciales o adicionales sobre un turno
--     atendido no existen hoy en el panel; no se impone unicidad por turno en
--     la tabla para no cerrar esa decisión ni tocar históricos.
--   * Idempotencia: el cliente manda una clave por intento de cobro y la
--     reutiliza al reintentar. La misma clave devuelve el pago ya registrado
--     sin escribir de nuevo (también con doble clic concurrente: el bloqueo
--     del turno serializa y el índice único es el respaldo).
--   * Identidad, tenant y rol salen del servidor: SECURITY INVOKER, así las
--     políticas RLS (turnos/pagos_write_staff con barberia_operational_access)
--     y los triggers de mismo tenant siguen aplicando. Los chequeos explícitos
--     sólo dan errores claros.
--
-- Aditiva: columna nullable + índice parcial; los pagos históricos no cambian.
-- Rollback operativo (no borra cobros):
--   drop function if exists public.registrar_cobro_turno(bigint, numeric, text, uuid);
--   drop index if exists public.uq_pagos_idempotency_key;
--   alter table public.pagos drop column if exists idempotency_key;
-- El frontend anterior sigue funcionando sin la RPC; el nuevo la necesita.
begin;

alter table public.pagos add column if not exists idempotency_key uuid;

create unique index if not exists uq_pagos_idempotency_key
on public.pagos (barberia_id, idempotency_key)
where idempotency_key is not null;

create or replace function public.registrar_cobro_turno(
  p_turno_id bigint,
  p_monto numeric,
  p_metodo text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_turno public.turnos%rowtype;
  v_pago public.pagos%rowtype;
  v_servicio text;
begin
  if auth.uid() is null then
    raise exception 'Necesitás iniciar sesión para registrar cobros.' using errcode = '42501', hint = 'sin_sesion';
  end if;
  if p_idempotency_key is null then
    raise exception 'Falta la clave del intento de cobro.' using errcode = '22023', hint = 'clave_invalida';
  end if;
  if p_monto is null or p_monto < 0 or p_monto > 9999999999.99 or p_monto <> round(p_monto, 2) then
    raise exception 'El importe debe ser un número mayor o igual a 0, con hasta 2 decimales.' using errcode = '22023', hint = 'monto_invalido';
  end if;
  if p_metodo is null or p_metodo not in ('efectivo', 'mercadopago', 'transferencia') then
    raise exception 'Método de pago no válido.' using errcode = '22023', hint = 'metodo_invalido';
  end if;

  -- RLS: un turno de otro negocio es invisible y cae acá.
  select * into v_turno from public.turnos where id = p_turno_id;
  if not found then
    raise exception 'No encontramos ese turno.' using errcode = 'P0002', hint = 'turno_no_encontrado';
  end if;
  if not public.is_barberia_role(v_turno.barberia_id, array['owner', 'admin', 'recepcionista', 'barbero', 'empleado']) then
    raise exception 'Tu rol no permite registrar cobros.' using errcode = '42501', hint = 'sin_permiso';
  end if;
  if not public.barberia_operational_access(v_turno.barberia_id) then
    raise exception 'La cuenta del negocio no permite registrar cobros en este momento.' using errcode = '42501', hint = 'sin_acceso_operativo';
  end if;

  -- Serializa cobros concurrentes del mismo turno.
  select * into v_turno from public.turnos where id = p_turno_id for update;
  if not found then
    raise exception 'No encontramos ese turno.' using errcode = 'P0002', hint = 'turno_no_encontrado';
  end if;

  select * into v_pago from public.pagos
  where barberia_id = v_turno.barberia_id and idempotency_key = p_idempotency_key;
  if found then
    if v_pago.turno_id is distinct from v_turno.id then
      raise exception 'La clave del cobro ya se usó para otro turno.' using errcode = '22023', hint = 'clave_reutilizada';
    end if;
    return jsonb_build_object('pago', to_jsonb(v_pago), 'estado', v_turno.estado, 'repetido', true);
  end if;

  if v_turno.estado = 'atendido' then
    raise exception 'Este turno ya figura como atendido. Actualizá la agenda antes de cobrarlo de nuevo.' using errcode = 'P0001', hint = 'turno_ya_atendido';
  end if;

  select s.nombre into v_servicio
  from public.servicios s
  where s.id = v_turno.servicio_id and s.barberia_id = v_turno.barberia_id;

  update public.turnos set estado = 'atendido' where id = v_turno.id;

  insert into public.pagos (barberia_id, turno_id, cliente_id, paciente, servicio, monto, metodo, idempotency_key)
  values (
    v_turno.barberia_id,
    v_turno.id,
    v_turno.cliente_id,
    v_turno.paciente,
    coalesce(v_servicio, nullif(v_turno.motivo, '')),
    p_monto,
    p_metodo,
    p_idempotency_key
  )
  returning * into v_pago;

  return jsonb_build_object('pago', to_jsonb(v_pago), 'estado', 'atendido', 'repetido', false);
end;
$$;

revoke all on function public.registrar_cobro_turno(bigint, numeric, text, uuid) from public, anon;
grant execute on function public.registrar_cobro_turno(bigint, numeric, text, uuid) to authenticated;

commit;
