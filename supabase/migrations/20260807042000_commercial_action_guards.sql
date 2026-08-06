-- Guarda acciones sensibles del CRM y evita que una invitación pueda demover
-- al único owner existente.
begin;

create or replace function public.accept_barberia_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_inv public.barberia_invitaciones%rowtype; v_email text;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida.' using errcode = '28000'; end if;
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into v_inv from public.barberia_invitaciones where token_hash = md5(btrim(p_token)) for update;
  if v_inv.id is null or v_inv.status <> 'pending' or v_inv.expires_at <= now() then raise exception 'La invitación no es válida o expiró.' using errcode = '22023'; end if;
  if lower(v_inv.email) <> coalesce(v_email, '') then raise exception 'La invitación pertenece a otro email.' using errcode = '42501'; end if;
  insert into public.barberia_members (barberia_id, user_id, role) values (v_inv.barberia_id, auth.uid(), v_inv.role)
    on conflict (barberia_id, user_id) do update set role = case when public.barberia_members.role = 'owner' then 'owner' else excluded.role end;
  update public.barberia_invitaciones set status = 'accepted', accepted_by = auth.uid(), accepted_at = now() where id = v_inv.id;
  insert into public.saas_audit_log (event_key, event_name, user_id, barberia_id, metadata) values ('invitation_accepted:' || v_inv.id, 'invitation_accepted', auth.uid(), v_inv.barberia_id, jsonb_build_object('role', v_inv.role));
  return jsonb_build_object('barberia_id', v_inv.barberia_id, 'role', v_inv.role);
end; $$;

create or replace function public.set_crm_agent_draft_status(p_draft_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_draft public.crm_agent_drafts%rowtype; v_status text := lower(btrim(p_status));
begin
  if not public.is_platform_member() then raise exception 'Sólo plataforma puede revisar borradores.' using errcode = '42501'; end if;
  if v_status not in ('approved', 'rejected', 'canceled') then raise exception 'Estado de revisión inválido.' using errcode = '22023'; end if;
  select d.* into v_draft from public.crm_agent_drafts d join public.crm_negocios n on n.id = d.negocio_id where d.id = p_draft_id for update;
  if v_draft.id is null then raise exception 'Borrador inexistente.' using errcode = 'P0002'; end if;
  if v_status = 'approved' and exists (select 1 from public.crm_negocios where id = v_draft.negocio_id and do_not_contact) then raise exception 'No se puede aprobar un negocio marcado do_not_contact.' using errcode = '42501'; end if;
  update public.crm_agent_drafts set estado = v_status, approved_by = case when v_status = 'approved' then auth.uid() else approved_by end, approved_at = case when v_status = 'approved' then now() else approved_at end where id = p_draft_id;
  insert into public.saas_audit_log (event_key, event_name, user_id, metadata) values ('crm_draft:' || p_draft_id || ':' || v_status || ':' || extract(epoch from clock_timestamp())::bigint, 'crm_agent_draft_reviewed', auth.uid(), jsonb_build_object('draft_id', p_draft_id, 'status', v_status));
  return jsonb_build_object('id', p_draft_id, 'estado', v_status);
end; $$;

revoke all on function public.set_crm_agent_draft_status(bigint,text) from public, anon;
grant execute on function public.set_crm_agent_draft_status(bigint,text) to authenticated;

commit;
