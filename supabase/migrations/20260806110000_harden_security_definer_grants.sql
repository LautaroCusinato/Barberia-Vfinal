-- Reduce la superficie de ataque de funciones SECURITY DEFINER heredadas.
-- Las RPC de reserva publica se mantienen ejecutables por anon; las funciones
-- internas quedan limitadas a RLS, triggers o service_role de n8n.
begin;

alter function public.actualizar_proximo_turno_cliente()
  set search_path = public, pg_temp;
alter function public.get_conversacion(text, integer)
  set search_path = public, pg_temp;
alter function public.upsert_conversacion(text, jsonb)
  set search_path = public, pg_temp;

revoke all on function public.actualizar_proximo_turno_cliente() from public, anon, authenticated;
revoke all on function public.bootstrap_barberia_saas() from public, anon, authenticated;
revoke all on function public.handle_new_barberia() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.get_conversacion(text, integer) from public, anon, authenticated;
revoke all on function public.upsert_conversacion(text, jsonb) from public, anon, authenticated;

-- n8n puede usar estas funciones con su credencial privada service_role;
-- nunca se exponen al navegador.
grant execute on function public.get_conversacion(text, integer) to service_role;
grant execute on function public.upsert_conversacion(text, jsonb) to service_role;

-- Helpers usados por las politicas RLS: solo authenticated debe invocarlos.
revoke all on function public.is_barberia_member(bigint) from public, anon;
revoke all on function public.is_barberia_role(bigint, text[]) from public, anon;
revoke all on function public.my_barberia_role(bigint) from public, anon, authenticated;
grant execute on function public.is_barberia_member(bigint) to authenticated;
grant execute on function public.is_barberia_role(bigint, text[]) to authenticated;

commit;
