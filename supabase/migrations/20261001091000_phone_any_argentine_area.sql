-- Acepta celulares de cualquier área de Argentina, no sólo del AMBA.
--
-- La versión anterior exigía '^54911[0-9]{8}$', así que un cliente de
-- Córdoba (351), Rosario (341) o Mendoza (261) no podía guardarse ni desde el
-- panel, ni desde la reserva pública, ni desde el bot de WhatsApp. Además el
-- patrón de limpieza '\\D' (con standard_conforming_strings activo) buscaba
-- una barra invertida literal, por lo que "+54 9 11 5522-1234" no se
-- normalizaba y era rechazado.
--
-- Formato canónico: 549 + código de área sin 0 + número sin 15 = 13 dígitos.
-- Los números ya guardados (54911XXXXXXXX) siguen siendo válidos.
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

  v_telefono := regexp_replace(new.telefono, '[^0-9]', '', 'g');
  if v_telefono !~ '^549[1-9][0-9]{9}$' then
    raise exception 'El teléfono debe ser un celular argentino: 549 + código de área + número (13 dígitos).'
      using errcode = '22023';
  end if;

  new.telefono := v_telefono;
  return new;
end;
$$;

revoke execute on function public.normalize_phone_ar_fields() from public, anon, authenticated;

commit;
