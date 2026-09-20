# WhatsApp human handoff contract

This is a design and acceptance contract only. Human handoff is **not implemented
or enabled** in production. It requires an additive schema change, server-side
authorization and operator UI before it can leave `NOT READY`.

## State machine

`AUTO_ACTIVE → HANDOFF_REQUESTED → HUMAN_ACTIVE → RESUME_PENDING → AUTO_ACTIVE`

- `AUTO_ACTIVE`: automation may evaluate an inbound event, subject to the
  existing tenant, connection, event and capability guards.
- `HANDOFF_REQUESTED`: an explicit customer request or authorized operator action
  has atomically paused automated replies for this conversation.
- `HUMAN_ACTIVE`: a human owns the conversation; automated outbound and booking
  are denied even if tenant-level flags are on.
- `RESUME_PENDING`: an owner/admin requested resumption, but automation remains
  paused until the transition is committed and a fresh inbound event arrives.

There is no implicit timeout back to automation. Provider errors, LLM confidence,
process restarts and repeated webhooks must never resume a paused conversation.

## Trusted scope

The authoritative key must be derived server-side from `tenant_id`,
`integration_id`, managed `instance_name` and a one-way sender hash. The browser,
n8n payload and model output cannot choose a tenant, integration, recipient or
handoff state. Raw phone numbers, JIDs and message bodies must not be stored in
the handoff audit row or logs.

Each transition needs an atomic compare-and-swap version, actor type, sanitized
reason code, source event id, request id and timestamps. Duplicate event ids must
return the existing result. A stale version or mismatched scope fails closed.

## Runtime rules

1. Resolve tenant and connection from the managed instance.
2. Claim the inbound event once.
3. Read the conversation handoff state inside the same trusted scope.
4. If state is not `AUTO_ACTIVE`, produce no automated reply, booking or customer
   mutation; record only a sanitized suppressed outcome.
5. An explicit request for a person may propose `HANDOFF_REQUESTED`, but only a
   server-side transition can persist it.
6. Only an authorized owner/admin or support role may enter `HUMAN_ACTIVE` or
   request resume. Resume must not replay suppressed messages.
7. Tenant-level disable always wins over conversation-level state.

## Failure and concurrency acceptance

- Two simultaneous handoff requests create one transition and one audit result.
- A handoff request racing an agent response must make the send guard recheck the
  authoritative version before outbound; the human pause wins.
- A duplicate webhook, slow model result or out-of-order response cannot send
  after `HANDOFF_REQUESTED`.
- Conversation keys from another tenant, integration or instance are rejected.
- Restarting n8n/Evolution does not change state.
- Missing state, storage error or authorization ambiguity blocks outbound.
- Resume requires a fresh event and never retries an ambiguous previous send.

## Required implementation gate

Prepare an additive, reversible and idempotent migration locally; add RLS/grants
with no browser write access; expose narrowly scoped service-role RPCs; implement
operator UX and audit history; add database-backed concurrency tests; pass QA;
then request separate authorization for any production migration or deployment.
