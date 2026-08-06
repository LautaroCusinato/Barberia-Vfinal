-- Mantiene el formato único de teléfonos aunque la inserción venga desde
-- n8n, un cliente externo o una llamada directa al RPC.
begin;

create or replace function public.normalize_phone_ar_fields()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_telefono text;
begin
  if new.telefono is null or btrim(new.telefono) = '' then
    new.telefono := null;
    return new;
  end if;

  v_telefono := regexp_replace(btrim(new.telefono), '\\D', '', 'g');
  if v_telefono !~ '^54911[0-9]{8}$' then
    raise exception 'El teléfono debe tener el formato argentino 54911XXXXXXXX.'
      using errcode = '22023';
  end if;

  new.telefono := v_telefono;
  return new;
end;
$$;

drop trigger if exists trg_clientes_normalize_phone on public.clientes;
create trigger trg_clientes_normalize_phone
before insert or update of telefono on public.clientes
for each row execute function public.normalize_phone_ar_fields();

drop trigger if exists trg_turnos_normalize_phone on public.turnos;
create trigger trg_turnos_normalize_phone
before insert or update of telefono on public.turnos
for each row execute function public.normalize_phone_ar_fields();

revoke execute on function public.normalize_phone_ar_fields() from public, anon, authenticated;

commit;
