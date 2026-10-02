# Commercial trial QA backup and rollback runbook

This runbook is preparation only. It is not an instruction to apply the
commercial migrations, mutate QA, or touch production. Execute it only after
an explicit QA change window is approved.

## Migration split

- **Migration A** (`20260831090000_commercial_trial_15_days.sql`) owns the
  15-day catalog default/update, onboarding/bootstrap dates, access-state
  evaluation, the membership-scoped operational helper, operational write
  policies, subscription transitions, and trial expiry.
- **Migration B**
  (`20260831091000_platform_manual_activation_support.sql`) owns only the
  PlatformCRM billing overview projection used by the existing guarded
  owner/admin activation flow. The shared transition RPC remains in A so
  expiry and manual activation cannot drift into two state machines.

Neither migration deletes historical rows or changes a payment provider.
The deferred historical migrations
`20260806163000_link_barberia_central_evolution.sql` and
`20260807070000_mercadopago_sandbox_tenant.sql` remain outside this change.

## Intentional onboarding delta

The existing `complete_self_service_onboarding` contract is retained with
only the approved commercial change: the server-authoritative trial fallback
is 14 → 15 days. Existing tenant trial dates (including NULL legacy dates) are
preserved, and existing `suspended`/`canceled` account state is not reopened by
re-running onboarding. No unrelated onboarding writes or tenant resolution
rules are introduced by this change.

## Exact QA backup checklist (do not run automatically)

Capture a restorable, access-controlled snapshot in the QA project before
applying either migration. Never include tokens, keys, or other secrets in the
snapshot artifact.

- [ ] `saas_planes`: every row, including `codigo`, `activo`, `trial_dias`,
  prices, limits, `created_at`, and `updated_at`.
- [ ] `saas_suscripciones`: every row and all state/version/date fields,
  including `trial_started_at`, `trial_ends_at`, `estado`, `status_reason`,
  `state_version`, provider event fields, and `metadata`.
- [ ] Commercial `barberias` fields for every tenant: `estado_cuenta`,
  `plan_codigo`, `trial_started_at` (when present), `trial_ends_at`,
  `onboarding_completed`, `updated_at`, plus the tenant id/slug needed to
  restore the correct row. Preserve other columns as part of the row
  snapshot.
- [ ] Function definitions and signatures for `bootstrap_barberia_saas`,
  `complete_self_service_onboarding`, `barberia_access_state`,
  `barberia_operational_access`, `transition_saas_subscription`,
  `expire_saas_trials`, and `get_platform_billing_overview`.
- [ ] All twelve operational RLS policies replaced by Migration A, plus the
  existing `barberias_update_owner` policy and all other policies on the
  affected tables. The twelve names are `servicios_write_owner`,
  `barberos_write_owner`, `clientes_write_staff`, `turnos_write_staff`,
  `mensajes_write_staff`, `conversaciones_write_staff`, `pagos_write_staff`,
  `notas_write_staff`, `config_write_owner`, `horarios_write_owner`,
  `barbero_servicios_write_owner`, and `bloqueos_write_owner`. Capture
  command, policy name, table, roles, and USING / WITH CHECK expressions.
- [ ] Grants/ACLs for `barberias`, `barberia_members`, the twelve operational
  tables, and every function above, including PUBLIC, `anon`, `authenticated`,
  `service_role`, and owner ACLs.
- [ ] Migration history rows and checksums for every migration in the target
  QA project, before and after the change.

The backup is valid only after row counts, checksums, and the function/policy/
grant inventory have been recorded and reviewed by a second operator.

## Rollback plan (documented, not executed)

1. Stop new QA writes and record the migration history entry and deployment
   timestamp. Do not run a production command.
2. Compare the post-change inventory with the snapshot. Restore the prior
   function bodies, policy expressions, and ACLs from the snapshot only after
   confirming that no newer approved migration depends on them.
3. Restore `saas_planes.trial_dias` from the snapshot values rather than
   blindly setting every active plan to 14. The pre-change per-row snapshot is
   mandatory because plan values may legitimately differ.
4. Restore the commercial `barberias` fields only if a reviewed diff proves the
   migration (or an approved test) changed them. Never overwrite newer owner,
   admin, or billing state changes.
5. Never delete `saas_suscripciones`, billing events, state history, audit
   rows, or onboarding history. Historical state is append-only evidence and
   must remain queryable after rollback.
6. Re-run the read-only policy, grant, RPC, RLS, tenant-isolation, and
   trial-expiration checks. Confirm owner normal settings still use
   `update_tenant_settings` and that entitlement fields cannot be changed by
   an authenticated direct table update.
7. Reconcile migration history using the supported migration mechanism; do not
   edit the internal migration table directly.

`set_updated_at` triggers write `updated_at = now()` on updates. A rollback
therefore cannot restore the old timestamp byte-for-byte unless the approved
database restoration mechanism explicitly preserves it. Treat this timestamp
drift as expected and record it in the rollback audit.

## Required post-change evidence

- Trialing rows with an expired `trial_ends_at` resolve to `expired`; paid
  `past_due` rows remain `past_due` unless their `status_reason` is the legacy
  `trial_expired` marker.
- Expired tenants retain historical reads while all twelve operational write
  policies deny writes. Active/trialing/past_due behavior remains unchanged.
- Authenticated users can query the operational helper only for a tenant in
  `barberia_members`; unknown or unrelated tenant ids return false. Anonymous
  callers have no execute privilege.
- Normal tenant settings still work through the allow-listed
  `update_tenant_settings` RPC, while direct authenticated `barberias` UPDATE
  is denied, including entitlement/billing columns.
- Platform owner/admin manual activation continues through the existing
  `transition_saas_subscription` RPC and preserves state history, audit, and
  expected-version/idempotency checks.
- `transition_saas_subscription` continues to synchronize
  `barberias.estado_cuenta` with the resulting subscription state: `active`
  becomes operational, trialing remains `trial`, payment-failure states map to
  `past_due`, and canceled/expired states remain non-operational until an
  authorized reactivation.
