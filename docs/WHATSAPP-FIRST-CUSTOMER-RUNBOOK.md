# WhatsApp first-customer runbook

This runbook is the controlled path from the verified QA implementation to one
production customer. It does not authorize a deployment, migration, message, or
booking. All runtime flags introduced by the production contract default to
`false`.

## Artifacts

- Database contract: `20260913120000_whatsapp_production_runtime_contract.sql`.
- Authoritative metadata query: `scripts/sql/whatsapp-production-preflight.sql`.
- Declared-policy verifier: `scripts/verify-production-rls-declarations.mjs`.
- Post-migration metadata query: `scripts/sql/whatsapp-production-postflight.sql`.
- Tenant readiness query: `scripts/sql/whatsapp-first-customer-readiness.sql`.
- Sanitized runtime diagnostics: `scripts/whatsapp-production-diagnostics.mjs`.
- Offline backup artifact verifier: `scripts/verify-production-backup-artifacts.mjs`.
- Pre-consumer emergency rollback: `scripts/sql/whatsapp-production-runtime-rollback.sql`.
- Owner/admin provisioning function: `whatsapp-production-provision`.
- Inactive n8n template: `Austral WhatsApp Production - Controlled.json`.
- Template generator: `scripts/prepare-whatsapp-production-workflow.mjs`.
- Static release verifier: `scripts/verify-whatsapp-production-contract.mjs`.

The existing QA workflow, QA instances and `miwsp` are not promotion inputs.
The customer receives a new tenant-scoped Evolution instance and dedicated n8n
credential bindings.

## Gate 1: production metadata and backup

1. Authenticate locally through the official Supabase CLI. Do not paste a
   database password or access token into chat.
2. Run the read-only preflight against project `ssagttjdgtypxjcgdnrw`. The
   current CLI may require an official temporary database login role or a local
   database URL supplied interactively.
3. Require RLS on every listed tenant table. Browser policies must resolve
   membership through `auth.uid()`; automation tables and RPCs must remain
   service-role only. Stop on missing tables, permissive cross-tenant policies,
   or integration/tenant mismatches.
4. Confirm `20260806163000` and `20260807070000` remain unapplied.
5. Create a fresh Supabase production backup using the official dashboard or
   `supabase db dump` with a privately supplied database URL. Verify the artifact
   is non-empty and record its timestamp/checksum outside Git. The local
   artifact check is `npm run verify:production-backup -- --directory=<absolute
   path outside this repository>`; a restore drill remains a separate gate.

Do not invent an RLS repair from repository history. If the live catalog differs,
create a narrowly scoped migration from the observed policies and rerun this gate.

## Gate 2: migrations and inactive runtime

First require both `20260806150000_multitenant_whatsapp_contract.sql` and
`20260821090000_whatsapp_tenant_provisioning.sql` to be present in the
authoritative history. If either is absent, stop and review it as an explicit
dependency before continuing.

Apply only:

1. `20260913120000_whatsapp_production_runtime_contract.sql`

Do **not** apply `20260824150000_whatsapp_integration_state_sync.sql` to
production. It is retained for QA history and contains QA-only reconciliation
and claim conditions. The new production contract includes the generic state
projection without those fixture values.

Do not use `--include-all`, migration repair, or an indiscriminate `db push`.
Immediately rerun the metadata preflight. Expected production counts are:

- `production_automation_enabled = 0`
- `production_outbound_enabled = 0`
- `production_booking_enabled = 0`

Import the production n8n template as a new workflow. Keep it unpublished. Bind
new production-only credentials for Supabase, DeepSeek, Evolution and webhook
Header Auth; never reuse QA or legacy credentials. Validate expressions and the
production webhook path without executing the workflow. The inbound guard
requires a provider timestamp no older than five minutes (with at most two
minutes of future clock skew), in addition to `MESSAGES_UPSERT`,
`fromMe=false`, the managed instance identity, event id, direct-chat JID and
non-empty text.

Deploy `whatsapp-production-provision` only after this gate is approved. Its
server-only configuration is `WHATSAPP_RUNTIME_PROJECT_REF`,
`WHATSAPP_RUNTIME_ENV=production`, `WHATSAPP_PROVISIONING_ENABLED`,
`EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `WHATSAPP_N8N_WEBHOOK_URL`,
`WHATSAPP_N8N_WEBHOOK_SECRET`, `WHATSAPP_N8N_ALLOWED_HOST`,
`WHATSAPP_PROTECTED_INSTANCES`, `APP_BASE_URL`, `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. The Cloudflare build selects it with
`VITE_WHATSAPP_PROVISION_FUNCTION=whatsapp-production-provision`; this public
selector contains no credential and the server still enforces project,
environment, origin, user membership and default-off runtime flags.

## Gate 3: provision one customer

1. Use the existing authenticated onboarding to create the tenant and owner.
2. Complete business timezone/currency, service catalogue, active staff,
   staff-service relations, schedules and blocks.
   Run `scripts/sql/whatsapp-first-customer-readiness.sql` in a read-only
   production SQL session with the numeric tenant id. Stop if the tenant,
   owner/admin, catalogue, staff-service link or schedule aggregate is missing.
3. From the authenticated owner/admin panel, invoke the production provisioning
   function. It creates or reuses the deterministic tenant-scoped integration
   and Evolution instance, configures only the dedicated production webhook,
   and keeps all three runtime flags off. It accepts no instance, webhook,
   tenant identity override or credential from the browser.
4. Confirm the integration and connection tenant ids match, environment is
   `production`, provisioning mode is `live`, and the instance is not protected.
   Do not reuse or modify `miwsp`, a QA instance, or another tenant's number.
5. The customer scans the QR. Verify stable `CONNECTED` and the matching
   integration state after refresh. No automation runs while flags are off.

## Controlled E2E

Scope: one tenant, one connected customer instance and one authorized sender.

1. Set only `automation_enabled=true`. Keep `outbound_enabled=false` and
   `booking_enabled=false`. Publish the dedicated production workflow for the
   supervised window.
2. Send one services question, one price question and one availability question.
   Verify tenant resolution, authoritative catalogue/currency, authoritative
   availability RPC, one inbound claim per event, no outbound, no bookings and
   no customer writes.
3. Send a short multi-turn booking conversation. It may collect and propose
   data, but must not call a booking RPC or claim that a booking exists.
4. Replay one captured event id through the controlled harness. Require the
   second claim to return `acquired=false`; no AI or outbound node may run.
5. Confirm outgoing/provider events have `fromMe=true` and stop at the first
   identity guard.
6. With separate human authorization, set `outbound_enabled=true` for this one
   connection. Send exactly one new services question. Require one outbound
   claim, one Evolution request, a provider ACK, one received reply and zero
   loop events. Do not retry an ambiguous provider response.
7. Immediately set `outbound_enabled=false`. Leave `booking_enabled=false`.

Booking is a separate release. It requires a fresh confirmed conversation,
availability recheck, a booking-specific claim and explicit authorization before
`booking_enabled` can be set true.

## Post-check

- Other tenant integrations and flags are unchanged.
- No QA or protected instance appears in production configuration.
- No phone/JID, prompt, Authorization header, API key or secret was logged.
- Duplicate, `fromMe`, group, broadcast and invalid identity events were ignored.
- Booking/customer writes remain zero during reply-only acceptance.
- Billing remains manual/fail-closed and independent from WhatsApp flags.

Run `scripts/sql/whatsapp-production-postflight.sql` after the approved
migration. All three production-enabled counts and both invalid-combination
counts must be zero; every listed constraint must be validated; anonymous and
authenticated users must not execute the runtime RPCs.

During a supervised runtime window, diagnostics may be run only from a trusted
operator environment with server-only credentials:

```text
WHATSAPP_DIAGNOSTICS_ALLOW_PRODUCTION_READONLY=1
npm run whatsapp:production:diagnostics -- --environment=production --instance=austral-prod-tenant-<id>
```

The command resolves the tenant server-side and reports only sanitized state,
partial event ids, aggregate claim counts and provider/workflow health. It
cannot send, claim, retry or mutate an event.

## Rollback

Disable flags in this order: `booking_enabled`, `outbound_enabled`, then
`automation_enabled`; unpublish only the new production workflow; restore only
the affected Evolution instance webhook if it changed. Do not delete customer
data or shared runtime storage.

The database migration is additive. Before any consumer depends on it, rollback
may drop the two new RPCs, the runtime index/constraints and the three flag
columns. After a consumer exists, retain the schema and keep flags false; do not
improvise a destructive down migration.

## Remaining human actions

1. Restore one authorized server/production SQL access path, verify effective
   RLS and create/verify the fresh backup.
2. Approve the reviewed production migration and inactive runtime deployment,
   then provide/scan the first customer's WhatsApp number.
3. Authorize the single-tenant production E2E window and its one real reply.
