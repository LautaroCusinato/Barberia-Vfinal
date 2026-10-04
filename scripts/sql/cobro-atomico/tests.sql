\set ON_ERROR_STOP on
-- Helper (como superusuario): ejecuta la RPC y devuelve el hint del rechazo o 'ok:<repetido>'.
create function public.t_try(p_turno bigint, p_monto numeric, p_metodo text, p_key uuid) returns text language plpgsql as $$
declare r jsonb; h text;
begin
  r := public.registrar_cobro_turno(p_turno, p_monto, p_metodo, p_key);
  return 'ok:' || (r->>'repetido');
exception when others then
  get stacked diagnostics h = pg_exception_hint;
  return coalesce(h, sqlstate || ':' || sqlerrm);
end $$;
grant execute on function public.t_try(bigint, numeric, text, uuid) to authenticated, anon;

-- 1. Éxito: estado y pago juntos.
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  assert public.t_try(1, 1500.50, 'efectivo', '11111111-1111-4111-8111-111111111111') = 'ok:false', 'éxito';
  assert (select estado from public.turnos where id = 1) = 'atendido', 'turno atendido';
  assert (select count(*) from public.pagos where turno_id = 1) = 1, 'un pago';
  assert (select servicio from public.pagos where turno_id = 1) = 'Corte', 'servicio derivado en servidor';
end $$;

-- 2. Reintento con la misma clave (respuesta perdida): no duplica.
do $$ begin
  assert public.t_try(1, 1500.50, 'efectivo', '11111111-1111-4111-8111-111111111111') = 'ok:true', 'replay';
  assert (select count(*) from public.pagos where turno_id = 1) = 1, 'sigue un pago';
end $$;

-- 3. Misma clave para otro turno: rechazo.
do $$ begin
  assert public.t_try(2, 10, 'efectivo', '11111111-1111-4111-8111-111111111111') = 'clave_reutilizada', 'clave reutilizada';
  assert (select estado from public.turnos where id = 2) = 'confirmado', 'turno 2 sin cambios';
end $$;

-- 4. Dos operadores, claves distintas, mismo turno: el segundo se rechaza.
do $$ begin
  assert public.t_try(4, 10, 'efectivo', '44444444-4444-4444-8444-44444444444a') = 'ok:false', 'operador A';
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
do $$ begin
  assert public.t_try(4, 10, 'transferencia', '44444444-4444-4444-8444-44444444444b') = 'turno_ya_atendido', 'operador B (empleado)';
  assert (select count(*) from public.pagos where turno_id = 4) = 1, 'un solo pago para el turno 4';
end $$;

-- 5. Importe y método inválidos: sin escritura parcial.
do $$ begin
  assert public.t_try(2, -1, 'efectivo', gen_random_uuid()) = 'monto_invalido', 'negativo';
  assert public.t_try(2, 1.005, 'efectivo', gen_random_uuid()) = 'monto_invalido', '3 decimales';
  assert public.t_try(2, null, 'efectivo', gen_random_uuid()) = 'monto_invalido', 'null';
  assert public.t_try(2, 'NaN'::numeric, 'efectivo', gen_random_uuid()) = 'monto_invalido', 'NaN';
  assert public.t_try(2, 10000000000, 'efectivo', gen_random_uuid()) = 'monto_invalido', 'desborde';
  assert public.t_try(2, 10, 'bitcoin', gen_random_uuid()) = 'metodo_invalido', 'método';
  assert public.t_try(2, 10, 'efectivo', null) = 'clave_invalida', 'sin clave';
  assert (select estado from public.turnos where id = 2) = 'confirmado', 'turno 2 sin cambios';
  assert (select count(*) from public.pagos where turno_id = 2) = 0, 'sin pagos turno 2';
end $$;

-- 6. Rol sin permiso (readonly).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
do $$ begin
  assert public.t_try(2, 10, 'efectivo', gen_random_uuid()) = 'sin_permiso', 'readonly';
end $$;

-- 7. Tenant ajeno: el turno del negocio 2 no existe para un owner del 1.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
do $$ begin
  assert public.t_try(5, 10, 'efectivo', gen_random_uuid()) = 'turno_no_encontrado', 'tenant ajeno';
end $$;

-- 8. Negocio sin acceso operativo (vencido).
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', false);
do $$ begin
  assert public.t_try(6, 10, 'efectivo', gen_random_uuid()) = 'sin_acceso_operativo', 'vencido';
end $$;

-- 9. Sin sesión / anon.
reset role;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
do $$ declare h text; begin
  begin
    perform public.registrar_cobro_turno(2, 10, 'efectivo', gen_random_uuid());
    raise exception 'anon pudo ejecutar';
  exception when insufficient_privilege then h := 'denegado';
  end;
  assert h = 'denegado', 'anon sin EXECUTE';
end $$;
reset role;
set role authenticated;
do $$ begin
  assert public.t_try(2, 10, 'efectivo', gen_random_uuid()) = 'sin_sesion', 'authenticated sin sub';
end $$;

-- 10. Pago histórico intacto y columna nullable.
reset role;
do $$ begin
  assert (select count(*) from public.pagos where turno_id = 7 and idempotency_key is null and monto = 100) = 1, 'histórico intacto';
end $$;

select 'SECUENCIALES PASS' as resultado;
