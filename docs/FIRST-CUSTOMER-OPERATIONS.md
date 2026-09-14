# First customer operations

This is the operative boundary for selling Austral to the first barber shop.
It describes the repository and runtime as they exist; it does not authorize a
production change and contains no credential values.

## CURRENT SELLABLE SCOPE

The production web product is usable for an authorized tenant: account signup,
email verification, tenant onboarding, services, prices, barbers, schedules,
blocks, clients, agenda, public reservations and manual billing. Browser access
is membership-scoped and the database remains the authorization boundary.

WhatsApp is proven end to end only in QA. The commercial automation is not part
of the currently enabled production scope. Do not promise automatic WhatsApp
replies or WhatsApp booking until the gate below is completed for the customer.

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

Before the first commercial WhatsApp tenant, an approved change must:

1. introduce an explicit production runtime contract while retaining the QA
   project and instance deny-lists;
2. derive tenant and integration from the authenticated Evolution instance;
3. permit only a server-managed production instance name and tenant allow-list;
4. keep outbound and booking behind separate, default-off server flags;
5. preserve event claims, `fromMe` rejection, LID/PN identity validation,
   authoritative catalog currency and availability recheck;
6. deploy only after `20260913120000_whatsapp_production_runtime_contract.sql`
   is authoritatively planned for production, its provisioning dependency is
   present and QA-only migration `20260824150000` remains out;
7. pass one tenant-scoped production shadow test before any real reply, then one
   explicitly authorized reply-only E2E before booking is considered.

This is an engineering/release gate, not a missing secret or a UI toggle.

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
6. Complete the WhatsApp commercial gate above. Create a unique Evolution
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

The first remaining human action is to restore one authorized server or
production SQL access path. Then verify the effective production RLS catalog
and fresh backup; approve the single planned migration and inactive runtime
deployment; provide/scan the customer-controlled WhatsApp account; and
authorize the first tenant-scoped shadow/reply E2E. Payments stay manual unless
separately authorized.
