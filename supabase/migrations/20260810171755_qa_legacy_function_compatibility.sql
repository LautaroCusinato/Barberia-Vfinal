-- QA-only compatibility for legacy functions referenced by the hardened grants.
-- This file is not part of the production migration stream.
begin;

create or replace function public.actualizar_proximo_turno_cliente()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cliente_id bigint := case when tg_op = 'DELETE' then old.cliente_id else new.cliente_id end;
begin
  if v_cliente_id is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  update public.clientes c
  set proximo_turno = (
    select min(t.fecha)
    from public.turnos t
    where t.cliente_id = v_cliente_id
      and t.fecha >= current_date
      and t.estado not in ('cancelado', 'no_asistio')
  )
  where c.id = v_cliente_id;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_qa_actualizar_proximo_turno on public.turnos;
create trigger trg_qa_actualizar_proximo_turno
after insert or update or delete on public.turnos
for each row execute function public.actualizar_proximo_turno_cliente();

create or replace function public.get_conversacion(p_telefono text, p_limit integer default 20)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_build_object(
      'conversation', to_jsonb(c),
      'messages', coalesce(c.mensajes, '[]'::jsonb)
    ),
    jsonb_build_object('conversation', null, 'messages', '[]'::jsonb)
  )
  from public.conversaciones c
  where regexp_replace(coalesce(c.telefono, ''), '\\D', '', 'g') = regexp_replace(coalesce(p_telefono, ''), '\\D', '', 'g')
  order by c.updated_at desc nulls last, c.id desc
  limit 1;
$$;

create or replace function public.upsert_conversacion(p_telefono text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_barberia_id bigint := nullif(p_payload ->> 'barberia_id', '')::bigint;
  v_mensajes jsonb := coalesce(p_payload -> 'mensajes', '[]'::jsonb);
begin
  select c.id into v_id
  from public.conversaciones c
  where regexp_replace(coalesce(c.telefono, ''), '\\D', '', 'g') = regexp_replace(coalesce(p_telefono, ''), '\\D', '', 'g')
    and (v_barberia_id is null or c.barberia_id = v_barberia_id)
  order by c.updated_at desc nulls last, c.id desc
  limit 1;

  if v_id is null then
    insert into public.conversaciones (telefono, mensajes, updated_at, barberia_id)
    values (regexp_replace(coalesce(p_telefono, ''), '\\D', '', 'g'), v_mensajes, now(), v_barberia_id)
    returning id into v_id;
  else
    update public.conversaciones
    set mensajes = v_mensajes, updated_at = now(), barberia_id = coalesce(barberia_id, v_barberia_id)
    where id = v_id;
  end if;

  return (select to_jsonb(c) from public.conversaciones c where c.id = v_id);
end;
$$;

commit;
