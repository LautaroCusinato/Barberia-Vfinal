-- Última visita y próximo turno de la ficha del cliente, actualizados por los
-- turnos. Antes ultima_visita sólo cambiaba a mano y proximo_turno usaba la
-- fecha UTC (de 21 a 24 h en Argentina ya era "mañana").
--
-- * ultima_visita: el turno más reciente ya ocurrido (día anterior y no
--   "no asistió", o de hoy marcado "atendido"). Nunca retrocede una fecha
--   cargada a mano que sea más reciente.
-- * proximo_turno: el turno confirmado más cercano desde hoy en la zona
--   horaria del negocio.
-- Misma firma y trigger; rollback: volver a aplicar la definición anterior de
-- actualizar_proximo_turno_cliente (sin la columna ultima_visita).
create or replace function public.recalcular_visitas_cliente(p_cliente_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy date;
  v_ultima date;
begin
  if p_cliente_id is null then return; end if;
  select (now() at time zone coalesce(nullif(b.zona_horaria, ''), 'America/Argentina/Buenos_Aires'))::date
    into v_hoy
    from public.clientes c join public.barberias b on b.id = c.barberia_id
    where c.id = p_cliente_id;
  if v_hoy is null then return; end if;
  select max(t.fecha) into v_ultima
    from public.turnos t
    where t.cliente_id = p_cliente_id
      and ((t.fecha < v_hoy and coalesce(t.estado, '') not in ('no_asistio', 'cancelado'))
        or (t.fecha = v_hoy and t.estado = 'atendido'));
  update public.clientes c
    set proximo_turno = (
          select min(t.fecha) from public.turnos t
          where t.cliente_id = p_cliente_id and t.estado = 'confirmado' and t.fecha >= v_hoy
        ),
        ultima_visita = case
          when v_ultima is null then c.ultima_visita
          when c.ultima_visita is null or c.ultima_visita < v_ultima or c.ultima_visita > v_hoy then v_ultima
          else c.ultima_visita
        end
    where c.id = p_cliente_id;
end;
$$;
revoke all on function public.recalcular_visitas_cliente(bigint) from public, anon, authenticated;

create or replace function public.actualizar_proximo_turno_cliente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.recalcular_visitas_cliente(new.cliente_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.cliente_id is distinct from new.cliente_id) then
    perform public.recalcular_visitas_cliente(old.cliente_id);
  end if;
  return null;
end;
$$;

-- Recalcula una vez las fichas que ya tienen turnos.
select public.recalcular_visitas_cliente(c.id) from public.clientes c where exists (select 1 from public.turnos t where t.cliente_id = c.id);
