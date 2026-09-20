# WhatsApp production incident runbook

This procedure is for the dedicated multi-tenant runtime only. It never authorizes changes to `miwsp`, the legacy workflow, billing, another tenant, or customer data.

## Detect

Open an incident when the connection is not stable, the webhook contract differs, failures rise, a duplicate or loop is suspected, a tenant identity cannot be resolved uniquely, or any message appears associated with the wrong tenant. Record UTC time, tenant id, connection state, sanitized error code and operator. Do not copy phones, JIDs, message bodies, prompts, QR images, authorization headers or credentials into tickets.

## Contain

For the affected tenant only, disable `booking_enabled`, then `outbound_enabled`, then `automation_enabled`. If database control is unavailable, deactivate only `Austral WhatsApp Production - Controlled`. Do not delete the instance, events, connection row or integration. Do not edit or restart `miwsp` or the legacy workflow. A suspected cross-tenant event or credential exposure is severity 1 and remains contained until reviewed.

## Diagnose

Run `scripts/sql/whatsapp-support-diagnostics.sql` in a read-only session and the gated production diagnostics command from the runbook. Check, in order: deterministic instance-to-tenant resolution; connection and integration binding; Evolution connection state; webhook URL, header presence and `MESSAGES_UPSERT` event; n8n workflow identity and active state; inbound/outbound claims; recent failure counts. Rotate a credential only after identifying its owner, consumers and rollback path. Never retry an ambiguous send because the provider may have accepted it without returning an ACK.

The diagnostic command returns a sanitized `PASS/WARN/FAIL` matrix. Treat
`CONNECTION_STATE_DRIFT`, `RUNTIME_BINDING_DRIFT`, `WEBHOOK_INVALID`,
`REPEATED_EVENT_FAILURES`, `STALE_PROCESSING_EVENTS` and
`N8N_INACTIVE_WITH_AUTOMATION_ENABLED` as containment triggers. A `WARN` needs
operator review before enabling another capability; a `FAIL` blocks recovery.

## Recover

Correct the narrow cause while all flags remain false. Recheck the static production contract, then connection and webhook readbacks. Restore capabilities one at a time under a separately authorized supervised window: automation first, outbound only after inbound remains clean, and booking only in its own release. A provider or n8n restart does not itself authorize outbound replay.

## Verify

Require one tenant resolution, no cross-tenant rows, no duplicate processing, no loop from `fromMe=true`, no booking/customer write, and no unexpected outbound claim. Confirm other tenants and protected instances are unchanged. Keep flags false after verification unless the active approval explicitly says otherwise. Close the incident with sanitized timestamps, counts, cause, containment and follow-up owner.
