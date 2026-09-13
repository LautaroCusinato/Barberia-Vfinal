# WhatsApp QA closure manifest

## Current checkpoint — 2026-09-13

Status: **READY FOR MANUAL E2E — bounded QA harness prepared, not a full E2E PASS**.
Services completed a real round trip; the subsequent price case stopped before
reply dispatch. Availability was deliberately not attempted. No production readiness
or autonomous outbound enablement is implied by this checkpoint.

- Catalog currency now comes from tenant-scoped `servicios -> barberias(id,moneda)`.
  The resolver's subscription-plan currency is not used for service prices.
  Missing/foreign business currency fails closed; no billing/RPC/schema changes.
- Workflow regressions: 149 PASS, including ARS catalog with USD subscription,
  real USD catalog, absent/foreign currency, provider LID with verified-format
  `remoteJidAlt`, and rejection without that alternate identity. Evolution's
  `destination` is a webhook URL, not a receiver number; it is no longer parsed
  as a telephone hint. Tenant resolution remains server-side by instance.
- Published QA workflow matches the repository's 25 nodes, webhookId and
  connections. Eleven credential bindings use the existing three native QA
  credentials; credential values are not versioned. Mutation/outbound flags remain false.
- Authenticated price HTTP retest: 200, tenant 819, ARS 30.000. Latest isolated
  retest took 3255 ms and answered `El Corte clásico sale ARS 30.000 y dura
  30 minutos. ¿Querés que prepare una reserva?`. This is not WhatsApp delivery.
  The older HTTP failure has no retained diagnostic sufficient to attribute a cause.
- Controlled real test used only tenant-1 and tenant-819 identities. An internal,
  secret-authenticated temporary bridge routed the selected event to n8n and
  forwarded other events to the original QA shadow webhook. It never enabled
  general outbound. Each run allowed at most one question and one exact validated reply.
- First services attempt: one question, no response; provider LID identity was
  observed and the identity normalization was corrected. Fresh services attempt
  `…E2AAB956` completed n8n/Supabase/DeepSeek, rejected its duplicate, and sent
  reply `…F020C09A`. Provider storage confirms sender-side fromMe=true and
  recipient-side fromMe=false for the same reply ID. The exact reply was:
  `Tenemos Corte clásico: E2E_QA_819 servicio natural para pruebas, 30 min, ARS 30000. ¿Querés reservar?`
- The initial postcheck falsely required an outgoing webhook callback. Read-only
  message lookup proved delivery; replaying the actual outgoing record into the
  no-outbound n8n route returned HTTP 200 / invalid_inbound. The harness now checks
  stored provider identity plus this guard replay, separately reporting callback
  observation. This is not a claim of end-to-end autonomous loop certification.
- The real price question completed n8n with tenant/event/disabled flags correct,
  then failed a response assertion before any reply send. The initial generic
  diagnostic did not retain which assertion or the text: its exact cause remains
  UNKNOWN. Subsequent synthetic price PASS does not erase this failed real case.
  Named safe guard diagnostics are now included for the next supervised test.
  No automatic retry or availability send followed this failure.
- Total authorized test sends in this stage: **4** (three questions, one answer),
  all between the two existing QA identities. Final authoritative tenant-819
  counts: turnos=0, clientes=0. No booking/billing/production operation or miwsp change.
- Both QA instances are open. Original shadow webhooks restored and enabled;
  restoration readback matched saved configuration after every run. Internal
  bridge listener is closed. No phone, QR, new instance or permanent routing change.
- Existing protected workflow fingerprints were verified unchanged. Local
  tests/lint/build/diff-check/secret scan PASS; harness includes 128 adversarial
  assertions and 10 fixtures. Preexisting provision/state-verifier edits are excluded.

Tool: `scripts/run-whatsapp-qa-two-instance-e2e.cjs` is plan-only unless explicitly
passed `--execute --case=services|price|availability` inside n8n. Do not run as a
general outbound service. It snapshots secret configuration privately in RAM,
restores on normal/error exit, never retries sends, and retains the private backup
if restoration fails. Process/container termination still requires operator recovery;
there is no independently supervised recovery daemon. Availability's current case
tests missing-date clarification, not live delivery of dated authoritative slots.

Next step: a supervised **new price case**, using the named guard diagnostics,
before considering availability or any broader enablement. No physical pairing is
needed with the two currently open QA instances. The exact failed reply cannot be
recovered from n8n audit, which stores only reference/length rather than reply text.

## Historical checkpoint — 2026-09-12 (superseded above)

Status: **BLOCKED for real WhatsApp E2E**. The dated historical sections below
describe earlier states, not the current publication/credential status.

- QA workflow `4q45z4wI3fozB2VC` is now published with native Header Auth,
  Supabase QA Custom Auth and DeepSeek Header Auth credentials. Secrets were
  imported privately inside n8n, never added to the repository. Global
  `N8N_BLOCK_ENV_ACCESS_IN_NODE=true` remains intact.
- Fixed missing `webhookId`, which prevented the advertised route from being
  registered, and adjacent closing braces that broke n8n expression parsing in
  the shadow audit request. Both have static regression coverage.
- An actual synthetic CLI execution reached `Logging seguro` successfully.
  The HTTP suite completed seven synthetic conversations through the published
  webhook, tenant resolver, Supabase QA, DeepSeek and shadow audit. It also
  rejected missing authentication, duplicate processing, fromMe, missing event
  identity and an unknown instance. This is NOT proof of WhatsApp delivery.
- Runtime output exposed a quality blocker: services/price replies said
  **USD 30.000**, whereas the approved tenant-819 fixture expects **ARS 30.000**.
  A fresh resolver call confirmed `currency=USD`. The SQL contract takes
  currency from `saas_planes.moneda`, falling back to USD, rather than a verified
  service-catalog currency. The original amount-only HTTP assertion missed this;
  it now requires ARS explicitly. Do not classify that earlier suite as a
  conversation-quality PASS. No billing data, RPC or migration was changed.
- Resolve the catalog-currency authority separately before sending any proposal.
  Do not hardcode ARS into model prose or modify subscription billing to make a
  test pass. This also affects the existing live-data verifier's hardcoded
  `{ moneda: 'ARS' }` proposal fixture: it is not evidence of live resolver parity.
- The QA response returns the proposal only to the authenticated HTTP caller;
  the audit RPC still persists a result reference and length, not exact text.
- Existing QA instances were observed open with distinct identities. Both still
  route to the Supabase QA shadow webhook, not this n8n webhook. No route was
  replaced. An automatic Evolution-to-n8n bridge and controlled outbound remain
  unvalidated. A direct synthetic POST must not be reported as that bridge.
- `mutationAllowed=false`, `outboundAllowed=false`; no send endpoint or booking
  RPC exists in this QA workflow. No real WhatsApp message was sent in this stage.
- The isolated CLI harness `australQaRuntimeHarness` remains inactive. Multi-turn
  persistence and permanent exactly-once semantics are not certified.

Reproducible tools (all plan-only unless explicitly opted in):

- `scripts/configure-whatsapp-qa-native-credentials.cjs`: inside n8n, `--apply`
  binds dedicated QA credentials; stops on existing-name/id collisions. Do not
  rerun against the already configured instance.
- `scripts/run-whatsapp-qa-runtime.cjs`: inside n8n, `--execute` imports/runs the
  isolated inactive synthetic harness. QA event/audit bookkeeping only.
- `scripts/verify-whatsapp-qa-http-runtime.cjs`: inside n8n, `--execute` tests the
  authenticated HTTP route with synthetic events. Currently expected to expose
  the currency mismatch. No phone pairing or message sends.

Next step: establish an authoritative service-catalog currency contract without
altering billing, then revalidate price output before considering any real send.

Checkpoint checks: npm test, lint, build, diff-check and the repository secret
scanner PASS. Offline QA harness: 140 node assertions, 128 adversarial assertions,
10 fixtures. Live data reads: 30 slots; tenant-819 turnos=0, clientes=0;
cross-tenant service rejection verified in both directions with tenant 1.
Protected production/template workflow fingerprints match the pre-change
snapshot. Both QA webhooks remain on Supabase shadow; both instances open;
miwsp remains close and was not modified. Real outbound remains zero.
The live conversation quality gate is NOT green because of the currency mismatch.
The final replay with the stricter price assertion also stopped at a non-200
price response (the old error message did not retain its exact status). Its
cause is not established; the harness now reports the status without response
payloads. Do not treat the earlier successful run as proof of runtime reliability.

## Historical record (superseded where noted above)

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
