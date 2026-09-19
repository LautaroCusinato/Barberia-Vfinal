# WhatsApp first-customer runbook

This runbook is the controlled path from the verified QA implementation to one
production customer. It does not authorize a deployment, migration, message, or
booking. All runtime flags introduced by the production contract default to
`false`.

## Artifacts

- Drift-safe connection prerequisite: `20260913110000_whatsapp_production_connection_prerequisite.sql`.
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
- Sanitized support query: `scripts/sql/whatsapp-support-diagnostics.sql`.
- Incident procedure: `docs/WHATSAPP-PRODUCTION-INCIDENTS.md`.

The existing QA workflow, QA instances and `miwsp` are not promotion inputs.
The customer receives a new tenant-scoped Evolution instance and dedicated n8n
credential bindings.

## Operator acceptance matrix

| Action | Expected | PASS | FAIL / stop condition | Rollback |
| --- | --- | --- | --- | --- |
| Run static production verification | Contract, runtime helpers, workflow and operations tests complete offline | Every verifier reports `PASS`; template remains inactive | Any missing guard, embedded credential, unsafe node or changed default | Revert only the local candidate change; do not alter PROD |
| Run tenant readiness SQL read-only | One configured tenant with owner/admin, catalogue, staff links and schedule | Required counts are non-zero and access is allowed | Missing/duplicate tenant data or unexpected access state | Correct onboarding data through approved product paths |
| Configure server credentials | Dedicated production credentials are bound without exposing values | Project, provider host, webhook host and workflow credential scopes match | Reused QA/legacy credential, wrong project/host, or value exposed in client/log | Remove the new binding and rotate if exposure is suspected |
| Prepare tenant connection | Deterministic instance and integration are created with all flags false | Tenant binding valid; state reaches `QR_READY`; no other tenant changes | Identity conflict, protected instance, unsanitized error, or flags enabled | Keep flags false; contain only the affected tenant; do not delete data |
| Scan authorized QR | Provider state stabilizes as connected | UI shows connection `Conectada` while automation/outbound/booking remain `Inactivas` | Unstable state, wrong instance, unexpected webhook or any message activity | Disconnect only the new tenant instance if authorized; preserve evidence |
| Controlled inbound E2E | One fresh inbound event resolves and claims once, with no send/write | Correct tenant, one claim, zero outbound, zero booking/customer writes | Duplicate processing, loop, unresolved tenant, cross-tenant data or write | Disable flags in order and follow the incident runbook |
| Separately authorized outbound E2E | Exactly one response has one claim, one provider request and one ACK | One reply, no loop, flags restored false immediately | Ambiguous ACK, duplicate request, unexpected recipient or replay | Never retry ambiguous send; set outbound then automation false |

The operator records UTC start/end, tenant id, workflow id, sanitized request ids,
counts and PASS/FAIL for each attempted row. Phone numbers, JIDs, QR images,
message content, prompts and credentials are never copied into the record.

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

First inspect both migration history and live objects. Production can contain
the `20260806150000_multitenant_whatsapp_contract.sql` objects without that
historical version because its original schema predates the repository
reconstruction. Do not repair history or replay that migration blindly. Require
its integration columns, event table, unique event constraint, tenant resolver,
claim/finalization RPCs, secure grants and helper functions to exist live.

If `20260821090000_whatsapp_tenant_provisioning.sql` is absent from history and
`saas_whatsapp_connections` is also absent, use the reviewed drift-safe
`20260913110000_whatsapp_production_connection_prerequisite.sql`. It creates only
the missing service-role connection boundary and fails if an incompatible table
already exists. Do not apply both connection-table migrations.

Apply only:

1. `20260913110000_whatsapp_production_connection_prerequisite.sql`, only when
   the original connection migration and table are both absent.
2. `20260913120000_whatsapp_production_runtime_contract.sql`.

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
   A provider failure is persisted as `ERROR` with a sanitized code and no QR;
   it never leaves a false `CREATING_INSTANCE` success. Repeating prepare on an
   already `CONNECTED` row is a no-op, so it cannot reset an active connection
   or its capability flags. Retry an `ERROR` only through the explicit panel
   action after the provider cause is understood.
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
3. Send short follow-up questions and verify that each event is independently
   tenant-scoped and read-only. This controlled workflow does not persist
   conversational booking state. A stateful booking conversation belongs to
   the separate booking release and must not be accepted in this reply-only
   gate.
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

1. Configure the dedicated production credentials for Supabase, Evolution,
   DeepSeek and n8n/webhook authentication without sharing their values.
2. Select the first approved tenant and run its read-only readiness query.
3. Separately authorize connection of its number and the physical QR scan.
4. Later, separately authorize the single-tenant inbound window and any one
   real outbound reply. Booking remains a different release.
