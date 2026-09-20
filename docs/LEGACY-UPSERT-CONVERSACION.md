# Legacy `upsert_conversacion` assessment

Status: `NOT READY`, isolated legacy debt. It is not used by the controlled
production WhatsApp workflow and does not block its first-customer reply-only
gate. This assessment authorizes no change to the legacy workflow or production.

## Evidence

- `20260806110000_harden_security_definer_grants.sql` alters and grants
  `public.upsert_conversacion(text, jsonb)`, assuming the function already exists.
- The repository only creates that signature later in QA-only compatibility
  files: `20260810171755_qa_legacy_function_compatibility.sql` and
  `supabase/qa-migrations/20260810000000_legacy_function_compatibility.sql`.
- The QA compatibility body reads `barberia_id` from `p_payload`. When it is
  null, lookup is based on normalized phone across all tenants. That is not an
  acceptable authority model for a new multi-tenant production runtime.
- The controlled production workflow contains no call to `upsert_conversacion`;
  tenant resolution uses the managed Evolution instance and service-role-only
  runtime RPCs.

## Why no code change was made

The authoritative production function body, dependencies and active legacy n8n
consumers are not represented safely enough in the repository. Replacing the
signature or behavior could break the protected legacy workflow. Making the old
migration conditional would only hide schema drift and would not fix the tenant
authority problem.

## Required read-only discovery

Before proposing a migration, collect from production without writes:

1. `pg_get_functiondef('public.upsert_conversacion(text,jsonb)'::regprocedure)`.
2. Owner, `prosecdef`, `proconfig`, ACL and execute grants from `pg_proc`.
3. Dependencies, triggers and callers; inspect the protected legacy workflow
   without editing or activating it.
4. Table constraints and uniqueness for `conversaciones`, especially tenant and
   normalized identity keys.
5. Whether null `barberia_id` is used by any real consumer.

Do not copy phone numbers, message bodies or credentials into the audit record.

## Safe target contract

Any future replacement must derive tenant and integration from a trusted server
context, require a non-null tenant scope, use an atomic tenant-scoped key, set a
safe `search_path`, expose only the minimum service role grant, handle duplicate
and concurrent calls idempotently, and ship as an additive RPC with a phased
consumer migration. The legacy signature should remain untouched until every
consumer is migrated and rollback has been rehearsed in QA.
