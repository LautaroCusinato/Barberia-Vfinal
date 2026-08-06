-- Registra el inicio desde el alta de Auth y permite marcar abandono de forma
-- explícita. No toca reservas ni workflows externos.
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.saas_onboarding_sessions (user_id, status, source, metadata)
  values (
    new.id,
    'started',
    left(coalesce(nullif(new.raw_user_meta_data ->> 'source', ''), 'direct'), 80),
    jsonb_build_object('registered_at', new.created_at, 'email_confirmed_at', new.email_confirmed_at)
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create or replace function public.track_self_service_onboarding(
  p_event_name text,
  p_step smallint default null,
  p_source text default 'direct',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_session public.saas_onboarding_sessions%rowtype;
  v_event text := left(btrim(coalesce(p_event_name, '')), 80);
begin
  if v_user_id is null then
    raise exception 'Autenticacion requerida.' using errcode = '28000';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_user_id and u.email_confirmed_at is not null) then
    raise exception 'El email debe estar verificado antes de iniciar el onboarding.' using errcode = '42501';
  end if;
  if length(v_event) not between 2 and 80 then
    raise exception 'Evento de onboarding invalido.' using errcode = '22023';
  end if;
  if p_step is not null and (p_step < 0 or p_step > 8) then
    raise exception 'Paso de onboarding invalido.' using errcode = '22023';
  end if;

  insert into public.saas_onboarding_sessions (user_id, status, current_step, source, metadata)
  values (v_user_id, case when v_event = 'onboarding_abandoned' then 'abandoned' else 'in_progress' end,
    coalesce(p_step, 0), left(coalesce(nullif(btrim(p_source), ''), 'direct'), 80), coalesce(p_metadata, '{}'::jsonb))
  on conflict (user_id) do update set
    status = case
      when public.saas_onboarding_sessions.status = 'completed' then 'completed'
      when v_event = 'onboarding_abandoned' then 'abandoned'
      else 'in_progress'
    end,
    current_step = greatest(public.saas_onboarding_sessions.current_step, coalesce(excluded.current_step, 0)),
    source = coalesce(nullif(excluded.source, ''), public.saas_onboarding_sessions.source),
    last_seen_at = now(),
    abandoned_at = case when v_event = 'onboarding_abandoned' and public.saas_onboarding_sessions.status <> 'completed' then now() else public.saas_onboarding_sessions.abandoned_at end,
    metadata = public.saas_onboarding_sessions.metadata || excluded.metadata;

  select * into v_session from public.saas_onboarding_sessions where user_id = v_user_id;
  insert into public.saas_onboarding_events (session_id, user_id, barberia_id, event_name, step, metadata)
  values (v_session.id, v_user_id, v_session.barberia_id, v_event, p_step, coalesce(p_metadata, '{}'::jsonb));

  return jsonb_build_object('session_id', v_session.id, 'status', v_session.status, 'current_step', v_session.current_step);
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.track_self_service_onboarding(text, smallint, text, jsonb) from public, anon;
grant execute on function public.track_self_service_onboarding(text, smallint, text, jsonb) to authenticated;

commit;
