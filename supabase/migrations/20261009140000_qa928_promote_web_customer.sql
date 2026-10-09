-- Promueve sólo una ficha provisional de la prueba QA928 después de una
-- reserva web confirmada. No cambia el contrato de crear_reserva_publica.
-- Rollback: scripts/sql/qa928-web-customer/rollback.sql; conserva los datos.
begin;
create or replace function public.promover_nombre_web_qa928()
returns trigger language plpgsql security invoker set search_path = public, pg_temp
as $$
declare
  v_cliente public.clientes;
  v_nombre text := nullif(btrim(new.paciente), '');
  v_placeholder text := 'Contacto WhatsApp · …' || right(new.telefono, 4);
begin
  if new.barberia_id is distinct from 928 or new.origen is distinct from 'reserva_web'
    or new.cliente_id is null or new.telefono !~ '^549[1-9][0-9]{9}$'
    or new.telefono is null or v_nombre is null or char_length(v_nombre) > 120
    or v_nombre = v_placeholder
  then return new; end if;
  if not exists (
    select 1 from public.barberias b where b.id = 928
      and b.slug = 'austral-prueba-lautaro'
      and b.metadata->>'environment' = 'qa'
      and b.metadata->>'whatsapp_manual_testing_authorized' = 'true'
  ) then return new; end if;

  select * into v_cliente from public.clientes
    where id = new.cliente_id and barberia_id = new.barberia_id
      and telefono = new.telefono for update;
  -- El nombre editado por el negocio prevalece aunque el marcador todavía
  -- esté pendiente. Sólo el rótulo exacto creado por la ruta QA se promueve.
  if found and v_cliente.whatsapp_nombre_pendiente
    and v_cliente.nombre = v_placeholder
  then
    update public.clientes set nombre = v_nombre, whatsapp_nombre_pendiente = false
      where id = v_cliente.id and barberia_id = 928;
  end if;
  return new;
end;
$$;
revoke all on function public.promover_nombre_web_qa928() from public, anon, authenticated;
drop trigger if exists trg_promover_nombre_web_qa928 on public.turnos;
create trigger trg_promover_nombre_web_qa928 after insert on public.turnos
  for each row execute function public.promover_nombre_web_qa928();
commit;
