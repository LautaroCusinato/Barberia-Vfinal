-- Operacion administrativa; no ejecutar desde el frontend.
-- Ejecutar en el SQL Editor de Supabase o con una conexion de administracion.
-- Es idempotente y valida el UID contra auth.users.
begin;

do $$
declare
  v_uid uuid := 'b051ddbb-6bce-4183-bb23-fe74edf5f776'::uuid;
  v_email text;
begin
  select email into v_email from auth.users where id = v_uid;

  if v_email is null then
    raise exception 'El UID del owner no existe en auth.users';
  end if;
  if lower(v_email) <> lower('australautomatizaciones@gmail.com') then
    raise exception 'El UID indicado no pertenece al correo esperado';
  end if;
  if exists (
    select 1
    from public.platform_members pm
    join auth.users u on u.id = pm.user_id
    where lower(u.email) = lower('barberia@gmail.com')
  ) then
    raise exception 'barberia@gmail.com no debe ser miembro de la plataforma';
  end if;

  insert into public.platform_members (user_id, role)
  values (v_uid, 'owner')
  on conflict (user_id) do update set role = excluded.role;
end
$$;

commit;

select user_id, role
from public.platform_members
where user_id = 'b051ddbb-6bce-4183-bb23-fe74edf5f776'::uuid;
