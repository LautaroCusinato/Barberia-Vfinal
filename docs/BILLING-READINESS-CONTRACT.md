# Billing production readiness contract

The production billing guard now exposes two independent states:

- `technical_readiness`: configuration and operational evidence. It never enables a charge.
- `financial_activation`: the explicit human and runtime gates required before `POST /preapproval` can run.

## Technical checks

The canonical operational flags are:

- `BILLING_PRODUCTION_BACKUP_VERIFIED`
- `BILLING_PRODUCTION_ALERTING_VERIFIED`
- `BILLING_PRODUCTION_WEBHOOK_VERIFIED`
- `BILLING_PRODUCTION_JOBS_VERIFIED`
- `BILLING_PRODUCTION_ROLLBACK_VERIFIED`

The old names (`BILLING_BACKUP_VERIFIED`, `BILLING_ALERTING_CONFIGURED`,
`BILLING_WEBHOOK_VERIFIED`, `BILLING_JOBS_CONFIGURED`, and
`BILLING_ROLLBACK_VERIFIED`) remain compatibility aliases only. If a canonical
flag and an alias are both present with different values, the guard fails
closed. No value is printed by `config-status`.

`BILLING_PRODUCTION_WEBHOOK_VERIFIED` represents the real financial E2E
verification. Until that operation is explicitly approved and completed,
`webhook.configured` and `webhook.e2e_verified` remain separate and the latter
is reported as pending. Offline HMAC, seller, application, plan, environment,
replay, and idempotency tests do not set this flag.

## Financial activation

`POST /preapproval` remains blocked unless all of the following are true:

- `BILLING_PRODUCTION_READINESS=ready`;
- `BILLING_PRODUCTION_CHECKOUT_CONFIRMATION=I_UNDERSTAND_REAL_CHARGES`;
- `BILLING_PRODUCTION_ENABLED=1`;
- technical readiness (including the webhook E2E flag) is complete;
- tenant, provider, environment, plan, price, seller, and application checks pass.

Technical readiness therefore can be complete while financial activation is
still disabled. This is intentional and preserves fail-closed behavior.

## Alerting blocker

The current server has no verified billing alert destination or isolated
`Austral Billing Alerts` workflow. No alert flag is set by this change. Before
the flag can be enabled, configure an operational email-capable destination
(or an equivalent existing monitor), create an isolated billing-only alert
path without touching WhatsApp workflows, and demonstrate one synthetic
`BILLING_ALERT_TEST` received by the owner/admin destination. The test must
produce zero payments, subscriptions, invoices, and charges.

No production checkout, `/preapproval`, payment, invoice, or external
subscription is created by the readiness contract or its tests.
