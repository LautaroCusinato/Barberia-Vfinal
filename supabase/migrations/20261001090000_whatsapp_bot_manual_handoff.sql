-- Traspaso a atención humana: cuando alguien del equipo responde a mano desde
-- el panel, el bot debe pausarse para no contestar en paralelo.
--
-- La política "config_write_owner" sólo deja escribir `config` al owner, así
-- que un recepcionista o barbero que respondía un chat recibía un error de
-- RLS y el bot seguía activo en la base mientras el panel lo mostraba
-- apagado. Esta RPC permite a cualquier miembro *sólo apagar* el bot; volver
-- a activarlo sigue reservado al owner y a la superficie server-side.
begin;

create or replace function public.pause_whatsapp_bot_for_manual_reply(p_barberia_id bigint)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not public.is_barberia_member(p_barberia_id) then
    raise exception 'No tenés acceso a este negocio.' using errcode = '42501';
  end if;

  insert into public.config (barberia_id, clave, valor)
  values (p_barberia_id, 'bot_activo', 'false')
  on conflict (barberia_id, clave) do update set valor = 'false';
end;
$$;

revoke all on function public.pause_whatsapp_bot_for_manual_reply(bigint) from public, anon;
grant execute on function public.pause_whatsapp_bot_for_manual_reply(bigint) to authenticated;

commit;
