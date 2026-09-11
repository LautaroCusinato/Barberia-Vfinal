# WhatsApp QA closure manifest

## Scope

- QA workflow: `Austral WhatsApp QA - Shadow No Outbound`
- n8n workflow id: `4q45z4wI3fozB2VC`
- Source template: `WhatsApp Multi Tenant - Pilot Barberia Central` (`5UQMp5vAMfBfJtSy`)
- Production workflow: `Barberia Central - Bot WhatsApp (Evolution + Deepseek)` (`gRTZDLTXvGgNq4BZ`)
- QA webhook path: `/webhook/austral-qa-shadow-inbound`

## Safety state

- QA workflow remains draft/unpublished.
- Booking node is now a local hard-deny Code node, with no booking RPC.
- Former Evolution responder is now a QA shadow-audit RPC, with no send endpoint.
- `mutationAllowed` and `outboundAllowed` remain false in the QA contract.
- No workflow execution, WhatsApp send, production write, or billing operation was performed. Only the new unpaired disposable Evolution instance was created/configured.

## Static guards

The offline harness `scripts/verify-whatsapp-qa-harness.mjs` covers:

- services, price, availability, and booking-intent shadow fixtures;
- `fromMe=true` loop rejection;
- invalid/incomplete identity rejection;
- unknown-tenant and cross-tenant rejection;
- duplicate event idempotency;
- zero outbound and zero booking/customer writes;
- inactive multi-tenant template and absence of legacy hardcodes.

The seed command `npm run e2e:qa:whatsapp-fixture` is plan-only by default. Its
`--execute` mode requires the existing QA sandbox guards and
`E2E_ALLOW_FIXTURE_SEED=1`; it never targets the production project.

## 2026-09-11 hardening evidence

The QA draft was exported through Actions/Download, corrected and reimported.
Import appends nodes in this n8n version: the accidental duplicate import was
removed from the QA canvas and replaced with the corrected 25-node graph.
Readback export confirms inactive, 25 unique node names, matching connections,
zero credential bindings and no saved success/error/manual execution data.
n8n omits default Code mode and false sendHeaders properties on export.
No protected workflow was edited or executed.

Versioned artifact: `integrations/templates/Austral WhatsApp QA - Shadow No Outbound.json`.
Builder: `scripts/prepare-whatsapp-qa-draft.mjs` (offline only).
The artifact requests a 120-second timeout; this timeout is NOT yet verified
in the live settings and must be set before controlled execution.

Fixed boundaries:

- Reject overlong authentication secrets instead of comparing only a prefix.
- Reject nested AI identity/tool/permission arguments and malformed model JSON.
- Model output cannot override the deterministic shadow requested_action.
- Observability uses a typed metadata allowlist, not a secret-key denylist.
- Native webhook Header Auth, literal fromMe=false, personal JID, event ID,
  message and instance identity validation before tenant lookup.
- No environment-secret expressions in the QA workflow: runtime has
  N8N_BLOCK_ENV_ACCESS_IN_NODE=true and that protection remains unchanged.
- Correct message field reaches prompt; unexecuted availability nodes are not
  read by greeting responses; availability responses use only RPC slots.
- HTTP retries disabled; failures stop the workflow; missing credentials fail closed.

## Tools and authority

| Tool | Input / output | Authority and effects |
| --- | --- | --- |
| resolve_whatsapp_tenant_context | authenticated Evolution identity / tenant + integration | QA server mapping; user/LLM cannot choose tenant |
| claim_whatsapp_event | resolved integration + event ID / acquired | atomic event bookkeeping, not booking/customer mutation |
| services, staff, schedules, blocks reads | resolved tenant / scoped rows | read-only; no model-selected tenant |
| horarios_disponibles_reserva_publica | resolved slug, validated service/date / slots | authoritative read RPC; foreign service denied |
| DeepSeek | scoped operational context + text / validated JSON | interpretation only; no tools, credentials or permissions from model |
| record_whatsapp_shadow_run, finish_whatsapp_event | resolved integration + event / audit result | QA bookkeeping only; no send, reservation or client creation |
| booking node | any input / mutation_blocked | implementation has no HTTP or write path |

The n8n audit RPC records a result reference and response length, NOT the exact
reply text. Exact-message persistence/review is therefore not certified by this
workflow. Do not enable future outbound on the assumption that this exists.

## Validation and limits

- `npm test`, `npm run lint`, `npm run build`: PASS on the local worktree.
- Adversarial suite: 128 assertions; actual shared modules with mock model calls.
- Workflow suite: 129 cases using actual Code-node source in a VM, not n8n execution.
- Harness includes these suites and ten offline fixtures.
- `node scripts/verify-whatsapp-qa-data.mjs`: plan-only by default.
- Live read-only mode requires existing QA env plus `--live`; verified tenant819
  services=1, barbers=1, relations=1, schedules=5, blocks=1, real slots=30.
  Corte clásico price=ARS 30.000; nonexistent and foreign-tenant services return
  no slots. No fixtures were inserted by this verifier.
- No real DeepSeek call, published n8n execution, WhatsApp delivery or DB
  concurrency test has been performed in this stage.
- Offline duplicate suppression is not proof of live concurrency. The existing
  claim RPC can reacquire expired/failed events; it is not permanent exactly-once.
- Booking overlap protection exists in migration SQL; its live constraint and
  concurrent transaction behavior are not certified by static tests. Booking stays off.
- Free-form model replies remain unproven against all hallucinations; catalog
  argument validation alone does not prove every generated price/name is correct.
- Batch and LID messages are rejected by this draft rather than misrouted.

## Runtime and real remaining gates

Docker services were healthy. Runtime stays shadow. New instance
`austral-qa-n8n-disposable` exists, close/unpaired, with no QR requested and webhook
disabled. Evolution create unexpectedly enabled its webhook; it was immediately
disabled on ONLY that disposable resource and verified. Protected instance
webhook configurations compared unchanged.

Before any execution/publication:

1. Bind native n8n credentials privately: QA webhook Header Auth, Supabase QA
   Custom Auth (apikey + Authorization headers, QA domain only), and DeepSeek
   Header Auth. Human credential-entry handoff is required; never paste values
   into chat or weaken global environment isolation.
2. Establish an authorized disposable integration mapping without repointing
   either existing shadow integration; verify resolver/claim/audit contracts live.
3. Verify timeout and error handling with an explicitly authorized no-send n8n
   execution. Current errors stop processing but do not certify finalized failed claims.
4. Obtain an independent controlled WhatsApp number and human QR scan. Do not
   reuse miwsp or either existing QA instance.
5. Only after those gates, authorize publication/routing and one inbound shadow
   test. No outbound or booking is part of that test.

Status: BLOCKED for live E2E, not production-ready. Missing credentials/mapping
and runtime verification are real gates in addition to the independent number.

## Rollback checklist

1. Keep the QA workflow unpublished while runtime configuration is unverified.
2. If a QA test is unsafe, leave both outbound and booking nodes deactivated.
3. Remove only the disposable QA webhook mapping; do not alter the production
   webhook or existing shadow instances.
4. Revert the QA workflow to its previous version from n8n Version History if
   an approved change is later found to be incorrect.
5. Remove only rows marked with the `E2E_QA_` fixture prefix during an
   explicitly authorized QA cleanup.
