-- Compatibilidad entre el pipeline canónico y el estado legado.
begin;
create or replace function public.set_crm_lead_stage(p_lead_id bigint, p_stage text, p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp
as $$
declare l public.crm_leads%rowtype; old_stage text; new_stage text := lower(btrim(p_stage)); legacy_stage text;
begin
  if not public.platform_can_write() then raise exception 'No autorizado.' using errcode='42501'; end if;
  if new_stage not in ('discovered','qualified','contacted','replied','interested','demo','trial','negotiating','won','lost','do_not_contact') then raise exception 'Etapa inválida.' using errcode='22023'; end if;
  select * into l from public.crm_leads where id=p_lead_id for update; if l.id is null then raise exception 'Lead inexistente.' using errcode='P0002'; end if;
  old_stage:=l.pipeline_stage;
  legacy_stage:=case new_stage when 'qualified' then 'en_conversacion' when 'discovered' then 'discovered' when 'contacted' then 'contacted' when 'replied' then 'replied' when 'interested' then 'interested' when 'demo' then 'demo' when 'trial' then 'trial' when 'negotiating' then 'negotiating' when 'won' then 'won' when 'lost' then 'lost' else 'do_not_contact' end;
  update public.crm_leads set pipeline_stage=new_stage, estado_conversacion=legacy_stage, do_not_contact=(new_stage='do_not_contact' or do_not_contact), updated_at=now() where id=l.id;
  insert into public.crm_actividades(lead_id,tipo,etapa_anterior,etapa_nueva,resumen,metadata,actor_id) values(l.id,'stage_changed',old_stage,new_stage,coalesce(nullif(btrim(p_note),''),'Cambio de etapa'),jsonb_build_object('legacy_stage',legacy_stage),auth.uid());
  return jsonb_build_object('id',l.id,'stage',new_stage,'legacy_stage',legacy_stage);
end $$;
revoke all on function public.set_crm_lead_stage(bigint,text,text) from public,anon;
grant execute on function public.set_crm_lead_stage(bigint,text,text) to authenticated;
commit;
