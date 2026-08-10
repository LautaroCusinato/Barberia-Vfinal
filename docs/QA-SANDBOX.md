# Austral SaaS — entorno Supabase QA/E2E

Estado: **esquema aplicado; datos QA pendientes de credenciales locales**.

Esta preparación aplica **Austral SaaS Architecture** (proyecto aislado, RLS/RPC versionados, credenciales fuera del repositorio, doble confirmación para mutaciones) y **Austral Design System** (la evidencia visual autenticada se ejecutará sólo sobre fixtures QA marcados y eliminables).

## Estado actual

- Proyecto QA creado: **sí**, `cmsymmszlzikqpvfqjre` (`Austral SaaS QA`, `sa-east-1`, activo).
- Proyecto productivo `ssagttjdgtypxjcgdnrw`: no tocado.
- Migraciones aplicadas: esquema base + 40 migraciones permitidas + compatibilidad QA legacy.
- Usuarios QA creados: ninguno.
- Fixtures creados: ninguno.
- Pagos, webhooks, WhatsApp, n8n y Evolution: no ejecutados.
- `project ref` productivo `ssagttjdgtypxjcgdnrw`: explícitamente bloqueado.

## Arquitectura objetivo

El entorno debe ser un proyecto Supabase independiente y vacío, sin branch ni backup de producción:

```text
Austral SaaS QA
├─ PostgreSQL aislado (migraciones, RLS y RPC del producto)
├─ Auth aislado (usuarios e2e-qa.invalid)
├─ Storage aislado (sólo si una prueba lo requiere)
├─ Edge Functions QA (mocks; sin secretos de proveedores)
├─ E2E_QA_BARBERIA_A / E2E_QA_BARBERIA_B
└─ proveedores externos deshabilitados (billing mock, WhatsApp mock)
```

No se deben copiar filas, usuarios, buckets, secretos ni logs de producción. La URL y el `project ref` tienen que ser distintos de `ssagttjdgtypxcgdnrw`.

## Intervención manual requerida

1. En Supabase Dashboard crear un proyecto nuevo llamado **Austral SaaS QA**.
2. Región recomendada: **South America (São Paulo)**. Elegir una contraseña de base de datos nueva y guardarla en un gestor de secretos.
3. Crear el proyecto vacío. No importar backup, no usar branch de producción y no copiar datos.
4. Obtener desde el panel de ese proyecto: `project ref`, `Project URL`, `anon key` y `service_role key`.
5. Guardar esos valores en el entorno local/CI, nunca en el chat, commits, capturas ni logs.
6. Configurar estas variables fuera del repositorio:

```text
E2E_ENVIRONMENT=qa
E2E_REAL_SUPABASE=1
E2E_SUPABASE_PROJECT_REF=<ref-qa>
E2E_ALLOWED_PROJECT_REF=<ref-qa>
E2E_SUPABASE_URL=https://<ref-qa>.supabase.co
E2E_SUPABASE_ANON_KEY=<anon-qa>
E2E_SUPABASE_SERVICE_ROLE_KEY=<service-role-qa>
E2E_TEST_PREFIX=E2E_QA_
E2E_ALLOW_CLEANUP=1
E2E_ALLOW_FIXTURE_SEED=1
E2E_QA_PASSWORD=<password-qa-local-no-real-users>
```

`E2E_ALLOWED_PROJECT_REF` es una segunda barrera: debe coincidir exactamente con el proyecto QA. El guard rechaza el proyecto productivo, URLs que no correspondan al ref, prefijos distintos y secretos de Mercado Pago, PayPal, Evolution, DeepSeek o n8n.

Cuando termines, avisame sólo que las variables quedaron guardadas fuera del repositorio. No pegues keys ni passwords.

## Esquema y migraciones

El proyecto QA debe recibir el esquema esperado por `main`, incluyendo RLS, RPC, Auth hooks y policies de Storage. El historial contiene migraciones de datos específicas de producción; no deben aplicarse en QA:

- `20260806163000_link_barberia_central_evolution.sql` (vincula Central y `miwsp`).
- `20260807070000_mercadopago_sandbox_tenant.sql` (crea el tenant técnico de billing y precios externos).

Tampoco se deben ejecutar migraciones futuras que nombren Central, Nueva, Evolution productivo o Mercado Pago. Después de recibir el ref QA se hará una revisión final del plan de migraciones y se aplicarán sólo las migraciones estructurales/funcionales seguras, sin datos productivos.

El comando `npm run e2e:qa:migration-plan` sólo analiza y lista migraciones; no se conecta ni aplica cambios. La migración QA-only `supabase/qa-migrations/20260810000000_legacy_function_compatibility.sql` cubre tres funciones legacy que no estaban en el baseline versionado y que son requeridas por los grants endurecidos; no pertenece al stream de producción.

## Fixtures y usuarios

El script `scripts/e2e-qa-fixtures.mjs` crea/reutiliza de forma idempotente:

- tenants `E2E_QA_BARBERIA_A` y `E2E_QA_BARBERIA_B`;
- servicios, empleados, relación servicio-profesional, horarios, break, cliente, turno futuro, configuración y branding mínimo;
- CRM negocio + lead por tenant;
- integración Evolution marcada `desactivado`, `shadow` y `external_provider=false`;
- usuarios con email `.invalid`: owner/admin/recepción/empleado/readonly de A, owner de B, platform owner/admin/sales/support/readonly.

No se crean empleados ni clientes reales. Los teléfonos son `000000000001`, `000000000002`, `000000000011` y `000000000012`.

```bash
npm run e2e:preflight
node scripts/e2e-qa-fixtures.mjs                 # dry-run
node scripts/e2e-qa-fixtures.mjs --execute       # requiere E2E_ALLOW_FIXTURE_SEED=1
```

El password QA se lee sólo del entorno y nunca se imprime.

## Cleanup seguro

`scripts/e2e-cleanup.mjs` funciona en dry-run por defecto. Sólo considera tenants cuyo nombre, slug y metadata contengan el prefijo exacto y el entorno QA; también exige el `project ref` permitido explícitamente. Para borrar se necesitan **dos confirmaciones independientes**: `E2E_ALLOW_CLEANUP=1` y `--execute`.

```bash
node scripts/e2e-cleanup.mjs                 # audita, no borra
node scripts/e2e-cleanup.mjs --execute       # sólo QA marcado
```

Ante cualquier candidato sin todas las marcas, el script aborta. Nunca acepta producción ni un override silencioso. La salida es un resumen sin secretos y sirve como auditoría.

## Billing y WhatsApp en QA

Billing usa proveedor mock y eventos sintéticos. No se configuran Access Tokens, webhooks o secretos reales/TEST de Mercado Pago o PayPal. WhatsApp usa fixtures/mock; Evolution permanece desactivado y no se envían mensajes.

## E2E y evidencia

La suite autenticada queda gated hasta que exista este proyecto y sus fixtures. Se repetirán Auth, onboarding, aislamiento multi-tenant, roles, dashboard, Agenda, gestión, reserva, CRM, Plataforma, billing mock, recuperación y responsive en 390×844, 768×1024 y 1366×768, light/dark. No se afirmará `passed` mientras no se ejecute sobre QA.

En la ejecución local previa, Playwright reportó 48 escenarios públicos pasados y 144 escenarios sandbox omitidos por el guard. La suite autenticada aún no puede ejecutarse hasta crear usuarios/fixtures.

La evidencia se guardará en `docs/authenticated-qa/` y el informe se actualizará en `docs/AUTHENTICATED-QA.md` sin incluir cookies, tokens, headers o secretos.

## Rollback

El rollback normal es ejecutar el dry-run y luego el cleanup marcado. Si se requiere reset total, eliminar el proyecto **Austral SaaS QA** desde Supabase Dashboard, nunca el productivo. Como no se importan datos reales, no existe una operación de recuperación de producción involucrada.

## Siguiente paso exacto

Guardar las variables QA fuera del repositorio y avisar sólo que quedaron configuradas. El esquema ya está aplicado; después se podrán sembrar fixtures, ejecutar el dry-run de cleanup y comenzar la matriz autenticada.
