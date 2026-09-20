# First customer operations

This is the operative boundary for selling Austral to the first barber shop.
It describes the repository and runtime as they exist; it does not authorize a
production change and contains no credential values.

## CURRENT SELLABLE SCOPE

The production web product is usable for an authorized tenant: account signup,
email verification, tenant onboarding, services, prices, barbers, schedules,
blocks, clients, agenda, public reservations and manual billing. Browser access
is membership-scoped and the database remains the authorization boundary.

WhatsApp is proven end to end only in QA. The production runtime and controlled
workflow are deployed but inactive, with no credentials, connection or enabled
tenant capability. Do not promise automatic WhatsApp replies until the inbound
and outbound production gates pass for the customer. Do not promise WhatsApp
booking or human handoff; both remain separate releases.

The repository contains the complete core-table RLS contract in the reproducible
QA base schema, plus later hardening migrations. Because the original production
schema predates that QA reconstruction, the repository alone cannot prove the
effective production policies for every core table. Before onboarding the first
unrelated tenant, read `pg_policies`/`pg_class.relrowsecurity` authoritatively and
compare `servicios`, `barberos`, `clientes`, `turnos`, `mensajes`, schedules and
blocks with the QA membership/role contract. Do not create a repair migration
until that read identifies an actual difference.

## WHATSAPP COMMERCIAL GATE

The current `whatsapp-provision`, `whatsapp-evolution-webhook`,
`whatsapp-agent-outbound-pilot` and `whatsapp-booking-mutation` implementations
are intentionally QA-only or pilot-gated. They must not be deployed as a general
production service by changing secrets alone. `miwsp` and the legacy Barbería
Central workflow are protected compatibility resources, not the multi-tenant
commercial architecture.

The production contract and inactive workflow are already deployed and remain
default-off. The remaining gate is operational: dedicated credentials, a tenant
that passes the read-only/local preflight, a customer-controlled QR scan, stable
connection readback, one inbound-only E2E and then one separately authorized
reply with ACK. Event claims, `fromMe`, freshness, tenant resolution, outbound
and booking guards remain mandatory. This is not a UI toggle.

## FIRST CUSTOMER SEQUENCE

1. Create the user's Auth account through the public signup flow and confirm the
   email. Never create or share a password through support chat.
2. Complete the server-side onboarding wizard. Record the tenant id and verify
   owner membership, trial dates and `onboarding_completed`.
3. Configure real catalog data: business currency/timezone, at least one active
   service with price/duration, one active barber, barber-service relation and
   weekly schedules. Add known blocks before testing availability.
4. Verify the panel and public booking URL with the tenant owner. Create no test
   booking in production without explicit approval.
5. Keep billing manual/fail-closed. The presence of a Mercado Pago public key is
   not financial activation; do not enable provider/global/production flags.
6. Complete the WhatsApp commercial gate above. Where production history lacks
   the original connection-table migration, apply the reviewed drift-safe
   `20260913110000_whatsapp_production_connection_prerequisite.sql` before the
   runtime contract; never use migration repair or replay the QA-only state-sync
   migration. Create a unique Evolution
   instance for this tenant; never reuse `miwsp` or another tenant's number.
7. The owner scans the QR physically. Verify stable `CONNECTED`, refresh
   persistence, instance-to-tenant resolution and the configured webhook without
   displaying the phone, API key or webhook secret.
8. Run shadow-only questions for services, price and availability. Require zero
   cross-tenant data, sends, bookings and customer writes.
9. With separate human authorization, allow exactly one reply-only operation.
   Verify provider ACK, recipient receipt, `fromMe` loop guard and duplicate claim.
10. Booking remains disabled until a fresh multi-turn confirmation is rechecked
    against `horarios_disponibles_reserva_publica` and the QA booking gate passes.

## REQUIRED CONFIGURATION NAMES

Supabase server-side: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`WHATSAPP_RUNTIME_PROJECT_REF`, `WHATSAPP_RUNTIME_ENV`,
`WHATSAPP_PROVISIONING_ENABLED`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`,
`WHATSAPP_N8N_WEBHOOK_URL`, `WHATSAPP_N8N_WEBHOOK_SECRET`,
`WHATSAPP_N8N_ALLOWED_HOST`, `WHATSAPP_PROTECTED_INSTANCES`, `APP_BASE_URL` and
`DEEPSEEK_API_KEY`. Outbound/booking flags are tenant-scoped database flags and
remain off unless their separate gate is approved.

Cloudflare client build: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_APP_BASE_URL`, `VITE_SALES_WHATSAPP_NUMBER` and the non-secret selector
`VITE_WHATSAPP_PROVISION_FUNCTION`. Never expose service-role,
Evolution, DeepSeek, webhook or provider private keys through `VITE_*`.

## OBSERVABILITY

Record only timestamp, environment, tenant id, integration id, partial event id,
intent, stage, duration and sanitized provider result. Do not record full phone
numbers/JIDs, Authorization, API keys, webhook secrets, customer payloads or full
prompts. Diagnose in this order: Evolution connection, webhook status, tenant
resolution, event claim, scoped Supabase reads, proposal, outbound claim, provider
ACK and loop guard. Never retry an ambiguous provider send automatically.
Use `scripts/whatsapp-production-diagnostics.mjs` only with its explicit
production read-only gate and server-side credentials. It resolves the tenant
from the managed instance and emits no phone, message body, prompt, URL, token
or header value.

## ROLLBACK

If tenant resolution, isolation, webhook authentication, provider identity or
idempotency is uncertain, disable the relevant pilot first and stop traffic.
Restore the exact saved webhook configuration for only the affected instance.
Do not delete the Evolution instance, shared volume, workflow or customer data.
Rollback Edge Functions to the last verified version; do not improvise down
migrations. Confirm that other instances and production web traffic are intact.

## HUMAN ACTIONS

The first remaining human action is to configure dedicated production
credentials privately while the workflow, provisioning gate and tenant flags
remain off. Then select the first tenant, run the read-only snapshot and local
preflight, provide/scan the customer-controlled WhatsApp account, and authorize
the tenant-scoped inbound and reply E2E in separate steps. Payments stay manual
unless separately authorized.
