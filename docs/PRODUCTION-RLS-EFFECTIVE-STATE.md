# Production RLS effective-state checkpoint

Checkpoint: 2026-09-13. Project: production Supabase project
`ssagttjdgtypxjcgdnrw`.

## Authoritative access result

The authenticated local Supabase management session can list the production
project and deployed Edge Functions. The production database catalog could not
be queried: the official CLI failed while creating its temporary database login
role with `password authentication failed for user "supabase_admin"`. The
Supabase SQL Editor browser session was not authenticated.

Therefore the effective live policies are **not yet verified**. Repository
migrations are evidence of the intended contract, not evidence of the live
catalog. No policy is classified as present or missing until the read-only query
in `scripts/sql/whatsapp-production-preflight.sql` runs against production.

The required live inventory covers `barberias`, `barberia_members`, `servicios`,
`barberos`, `barbero_servicios`, `horarios_barbero`, `bloqueos_agenda`,
`clientes`, `turnos`, `mensajes`, `saas_integraciones`,
`saas_whatsapp_connections`, `saas_automation_events` and
`saas_automation_shadow_runs`. It records RLS enablement, force-RLS state,
policy commands/roles/expressions and relevant RPC execution privileges without
reading customer rows or secrets.

## Release decision

Production WhatsApp activation is blocked until an administrator authenticates
the official SQL Editor or repairs/creates the official temporary database
login, runs the read-only preflight and reviews its output. Credentials must be
entered only through the official local/dashboard mechanism, never chat or Git.

No RLS repair migration has been created because no live policy defect has been
observed authoritatively. If the result differs from the tenant-membership
contract, create a minimal policy-only migration from that observed delta and
add a two-tenant regression before applying it.

Production writes, migrations and deployments performed by this checkpoint: 0.
