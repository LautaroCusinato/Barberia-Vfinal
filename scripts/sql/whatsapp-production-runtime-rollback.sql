-- Emergency rollback plan for 20260913120000.
-- Run manually only before a production consumer depends on the contract.
-- It refuses to proceed while any runtime capability is enabled.
begin;

do $$
begin
  if exists (
    select 1
    from public.saas_whatsapp_connections
    where automation_enabled or outbound_enabled or booking_enabled
  ) then
    raise exception 'Disable all WhatsApp runtime capabilities before rollback.';
  end if;
end
$$;

drop function if exists public.claim_whatsapp_runtime_event(text, bigint, text, text, timestamptz);
drop function if exists public.resolve_whatsapp_runtime_context(text, text);
drop trigger if exists trg_sync_whatsapp_integration_state on public.saas_whatsapp_connections;
drop function if exists public.sync_whatsapp_integration_state();

alter table public.saas_whatsapp_connections
  drop constraint if exists saas_whatsapp_connections_integration_tenant_fk,
  drop constraint if exists saas_whatsapp_connections_booking_requires_outbound,
  drop constraint if exists saas_whatsapp_connections_outbound_requires_automation;

drop index if exists public.idx_saas_whatsapp_connections_runtime;
drop index if exists public.uq_saas_integraciones_id_barberia;

alter table public.saas_whatsapp_connections
  drop column if exists booking_enabled,
  drop column if exists outbound_enabled,
  drop column if exists automation_enabled;

commit;
