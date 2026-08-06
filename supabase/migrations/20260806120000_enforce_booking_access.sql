-- Evita nuevas reservas web cuando la suscripcion deja de estar habilitada.
-- `past_due` se conserva como ventana de gracia; billing podra pasar la cuenta
-- a `suspended` cuando la gracia expire.
begin;

create or replace function public.barberia_booking_access(p_barberia_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.barberia_access_state(p_barberia_id) in ('active', 'trialing', 'past_due');
$$;

create or replace function public.guard_public_reservation_access()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.origen = 'reserva_web'
     and not public.barberia_booking_access(new.barberia_id) then
    raise exception 'La cuenta no puede aceptar reservas en este momento.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_turnos_guard_public_access on public.turnos;
create trigger trg_turnos_guard_public_access
before insert or update of origen, barberia_id on public.turnos
for each row execute function public.guard_public_reservation_access();

revoke all on function public.barberia_booking_access(bigint) from public, anon;
grant execute on function public.barberia_booking_access(bigint) to authenticated;
revoke all on function public.guard_public_reservation_access() from public, anon, authenticated;

commit;
