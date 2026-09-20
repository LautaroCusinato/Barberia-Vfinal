# First customer readiness

This matrix is the source of truth for the first production WhatsApp customer.
It records verified repository state and the confirmed production checkpoint; it
does not authorize credentials, deployment, provisioning, QR pairing, activation
or a real message.

Allowed states are `READY`, `READY BUT DISABLED`, `HUMAN GATE` and `NOT READY`.

| COMPONENT | STATE | BLOCKER | VERIFICATION |
| --- | --- | --- | --- |
| Production database contract, RLS and service-role RPC boundary | READY | None in the confirmed checkpoint | Migrations `20260913110000` and `20260913120000` present; RLS on; anon/authenticated denied; runtime RPCs service-role only |
| `whatsapp-production-provision` v2 | READY BUT DISABLED | Dedicated secrets and explicit provisioning gate remain absent/off | JWT required; deployed source `3fbfaed3`; owner/admin authorization; deterministic instance; flags forced false |
| Controlled n8n workflow | READY BUT DISABLED | Dedicated credentials and later activation approval | Remote workflow inactive with 31 nodes and no embedded credentials; local candidate additionally requires explicit fail-closed HTTP behavior and passes adversarial validation |
| Workflow static verifier | READY | None | `npm run verify:whatsapp-production:workflow`; 11 unsafe mutations must be rejected |
| New-tenant preflight | READY | A read-only snapshot for the selected tenant | `npm run whatsapp:tenant:preflight -- --input=<snapshot.json>` returns PASS/WARN/FAIL without PII |
| Support diagnostics | READY BUT DISABLED | Server-only credentials and a managed instance are required to inspect live state | Offline classifier tests pass; live command remains explicitly gated and read-only |
| Agent read-only fallbacks | READY | None for services, prices and availability | Deterministic tests cover provider failure, malformed output, unknown service, missing price, ambiguous time and no-understanding fallback |
| Connection UI semantics | READY | None | Connection, automation, outbound and booking are shown as four independent states |
| Dedicated Supabase, n8n, Evolution and DeepSeek credentials | HUMAN GATE | Private operator configuration | Configure by documented variable/credential names; never paste values into chat or reuse QA bindings |
| First customer tenant and catalogue | HUMAN GATE | Select tenant and complete owner, services, staff links, schedules, slug, timezone and currency | Read-only SQL snapshot plus local tenant preflight must return PASS |
| Evolution instance and QR pairing | HUMAN GATE | Customer-controlled number and physical scan | Managed instance only; stable CONNECTED readback; all flags remain false |
| Production inbound E2E | HUMAN GATE | Credentials, paired number and supervised activation window | Fresh/duplicate/stale/fromMe/wrong-instance cases; one tenant; no outbound or mutations |
| Production outbound E2E | HUMAN GATE | Separate approval after inbound passes | One fresh event, one outbound claim, one provider request, one ACK, no retry on ambiguity, flags restored off |
| Conversational booking in production | NOT READY | Separate release and production E2E | Keep `booking_enabled=false`; do not sell this capability yet |
| Human handoff/pause/resume | NOT READY | Authoritative persisted state and operator UX are not implemented | Design and acceptance contract in `WHATSAPP-HUMAN-HANDOFF.md`; no runtime or schema change deployed |
| Legacy `upsert_conversacion` | NOT READY | Live definition and protected legacy consumers require read-only discovery | Isolated assessment in `LEGACY-UPSERT-CONVERSACION.md`; controlled production workflow does not call it |
| Billing automation | NOT READY | Explicitly outside this release | Billing remains separate and fail-closed |

## Current sellable boundary

The web product and public booking can be sold within their already verified
scope. Automatic WhatsApp replies are sellable only after the two production E2E
gates pass for the selected tenant. Conversational booking and human handoff must
not be advertised as active capabilities.

## Next human gate

Configure dedicated production credentials privately while keeping the workflow
inactive, `WHATSAPP_PROVISIONING_ENABLED` absent or `0`, and every tenant flag
false. Then select the first tenant and run the read-only snapshot plus local
preflight. QR pairing and any real message require later, separate approvals.
