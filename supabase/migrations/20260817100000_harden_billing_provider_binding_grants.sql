-- QA hardening: keep binding reads available to authenticated clients while
-- removing inherited DML/DDL privileges that are not used by the application.
-- The server-side billing resolver uses service_role for authoritative reads.
begin;

revoke truncate, trigger, references, insert, update, delete
  on table public.saas_billing_provider_bindings
  from authenticated;

revoke all on table public.saas_billing_provider_bindings from anon;

grant select on table public.saas_billing_provider_bindings to authenticated;
grant all on table public.saas_billing_provider_bindings to service_role;

commit;
