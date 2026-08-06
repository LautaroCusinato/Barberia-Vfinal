-- Refuerzos aditivos: serializa intents concurrentes y emite eventos de
-- dominio además del evento técnico state_changed.
begin;

create or replace function public.lock_billing_checkout_attempt()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.barberia_id::text || ':' || new.idempotency_key, 0));
  return new;
end;
$$;

drop trigger if exists trg_billing_checkout_idempotency_lock on public.saas_billing_checkout_attempts;
create trigger trg_billing_checkout_idempotency_lock
before insert on public.saas_billing_checkout_attempts
for each row execute function public.lock_billing_checkout_attempt();

create or replace function public.emit_billing_domain_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_name text;
begin
  v_event_name := case
    when new.to_state = 'trialing' and (new.from_state is null or new.from_state <> 'trialing') then 'subscription.trial_started'
    when new.from_state = 'trialing' and new.to_state <> 'trialing' then 'subscription.trial_ending'
    when new.to_state = 'active' and new.from_state in ('past_due','grace_period','suspended','canceled','paused','expired') then 'subscription.reactivated'
    when new.to_state = 'active' then 'payment.succeeded'
    when new.to_state in ('past_due','payment_review') then 'payment.failed'
    when new.to_state = 'refunded' then 'payment.refunded'
    when new.to_state = 'suspended' then 'subscription.suspended'
    when new.to_state = 'canceled' then 'subscription.canceled'
    else null
  end;
  if v_event_name is not null then
    insert into public.saas_billing_events (event_name, barberia_id, suscripcion_id, dedupe_key, payload)
    values (v_event_name, new.barberia_id, new.suscripcion_id,
      'subscription:' || new.suscripcion_id || ':state:' || new.state_version || ':' || v_event_name,
      jsonb_build_object('from_state', new.from_state, 'to_state', new.to_state, 'source', new.source, 'state_version', new.state_version));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_billing_domain_event on public.saas_billing_state_history;
create trigger trg_billing_domain_event
after insert on public.saas_billing_state_history
for each row execute function public.emit_billing_domain_event();

revoke all on function public.lock_billing_checkout_attempt(), public.emit_billing_domain_event() from public, anon, authenticated;
grant execute on function public.lock_billing_checkout_attempt(), public.emit_billing_domain_event() to service_role;

commit;
