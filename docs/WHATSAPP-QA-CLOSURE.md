# WhatsApp QA closure manifest

## Scope

- QA workflow: `Austral WhatsApp QA - Shadow No Outbound`
- n8n workflow id: `4q45z4wI3fozB2VC`
- Source template: `WhatsApp Multi Tenant - Pilot Barberia Central` (`5UQMp5vAMfBfJtSy`)
- Production workflow: `Barberia Central - Bot WhatsApp (Evolution + Deepseek)` (`gRTZDLTXvGgNq4BZ`)
- QA webhook path: `/webhook/austral-qa-shadow-inbound`

## Safety state

- QA workflow remains draft/unpublished.
- Booking mutation node remains deactivated.
- Evolution responder node remains deactivated.
- `mutationAllowed` and `outboundAllowed` remain false in the QA contract.
- No workflow execution, WhatsApp send, Evolution change, production write, or billing operation is part of this manifest.

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

## Snapshot limitation

The authenticated n8n UI exposed version history and publish controls, but no
workflow JSON export/download action in the available menu. This document is
therefore a non-secret manifest, not a replacement for an n8n JSON export.
The authoritative n8n workflow remains available at its workflow id above.

## Rollback checklist

1. Keep the QA workflow unpublished while runtime configuration is unverified.
2. If a QA test is unsafe, leave both outbound and booking nodes deactivated.
3. Remove only the disposable QA webhook mapping; do not alter the production
   webhook or existing shadow instances.
4. Revert the QA workflow to its previous version from n8n Version History if
   an approved change is later found to be incorrect.
5. Remove only rows marked with the `E2E_QA_` fixture prefix during an
   explicitly authorized QA cleanup.
