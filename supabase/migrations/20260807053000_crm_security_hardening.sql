-- Hardening: internal CRM helpers must not be callable through the public API.
-- Platform helpers remain executable by authenticated users because RLS policies
-- call them; anonymous/public callers are explicitly denied.
begin;

revoke all on function public.crm_action_audit() from public, anon, authenticated;
revoke all on function public.crm_agent_draft_audit() from public, anon, authenticated;
revoke all on function public.crm_agent_draft_guard() from public, anon, authenticated;

revoke all on function public.platform_role() from public, anon;
revoke all on function public.platform_can_write() from public, anon;
revoke all on function public.platform_can_export() from public, anon;
grant execute on function public.platform_role() to authenticated;
grant execute on function public.platform_can_write() to authenticated;
grant execute on function public.platform_can_export() to authenticated;

commit;
