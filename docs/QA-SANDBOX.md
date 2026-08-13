# Austral SaaS — entorno Supabase QA/E2E

Estado: **proyecto aislado creado, esquema aplicado, fixtures QA sembrados, billing mock desplegado y E2E autenticado ejecutado**.

Esta preparación aplica **Austral SaaS Architecture** (proyecto/ref explícitos, RLS/RPC versionados, doble guard para mutaciones, cero datos productivos) y **Austral Design System** (evidencia visual sólo con fixtures identificables y eliminables).

## Proyecto y aislamiento

- Nombre: **Austral SaaS QA**.
- Project ref: `cmsymmszlzikqpvfqjre`.
- Región: South America (São Paulo) / `sa-east-1`.
- Productivo prohibido: `ssagttjdgtypxjcgdnrw`.
- No se copiaron filas, usuarios, storage, backups, secretos ni logs de producción.
- Mercado Pago, PayPal, n8n, Evolution y WhatsApp permanecen desactivados; billing se prueba sólo con contratos internos/mock.

## Migraciones aplicadas

Se aplicaron el esquema base, las migraciones versionadas estructurales/funcionales permitidas y la compatibilidad QA `supabase/qa-migrations/20260810000000_legacy_function_compatibility.sql`.

No se aplicaron, por guard explícito:

- `20260806163000_link_barberia_central_evolution.sql`.
- `20260807070000_mercadopago_sandbox_tenant.sql`.

No se importaron datos reales ni configuraciones de Central/Nueva.

## Variables locales

Las variables viven únicamente en `barberia/.env.e2e.local` (ignorado por Git). Nunca se imprimen ni se versionan:

```text
E2E_ENVIRONMENT=qa
E2E_REAL_SUPABASE=1
E2E_SUPABASE_PROJECT_REF=cmsymmszlzikqpvfqjre
E2E_ALLOWED_PROJECT_REF=cmsymmszlzikqpvfqjre
E2E_SUPABASE_URL=https://cmsymmszlzikqpvfqjre.supabase.co
E2E_SUPABASE_ANON_KEY=<local QA only>
E2E_SUPABASE_SERVICE_ROLE_KEY=<local QA only>
E2E_TEST_PREFIX=E2E_QA_
E2E_ALLOW_CLEANUP=1
E2E_ALLOW_FIXTURE_SEED=1
E2E_QA_PASSWORD=<local synthetic users only>
```

El service key sólo se usa desde scripts Node locales; nunca se coloca en `VITE_*`, el navegador, commits, capturas o logs.

## Guards anti-producción

`npm run e2e:preflight` verificó:

- ref permitido y distinto de `ssagttjdgtypxjcgdnrw`;
- URL HTTPS coincidente;
- entorno `qa`;
- prefijo exacto `E2E_QA_`;
- ausencia de secretos de proveedores externos;
- cleanup y fixture seed requieren confirmaciones explícitas.

Ante cualquier discrepancia, el script aborta. No existe override silencioso.

## Usuarios y fixtures

Se crearon/reutilizaron idempotentemente **12 usuarios** con emails `.invalid`:

- owner/admin/recepción/empleado/readonly de Tenant A;
- owner de Tenant B;
- platform owner/admin/sales/support/readonly.
- usuario QA sin tenant para probar onboarding y acceso denegado.

Tenants:

- `E2E_QA_BARBERIA_A` (`e2e-qa-barberia-a`).
- `E2E_QA_BARBERIA_B` (`e2e-qa-barberia-b`).

Cada tenant tiene servicio, empleado, relación servicio-profesional, horario laboral, break, cliente, turno futuro, configuración, branding local, CRM negocio/lead e integración Evolution mock desactivada. Teléfonos sintéticos respetan el contrato argentino `54911XXXXXXXX`; no se usan teléfonos reales.

## Cleanup

`npm run e2e:cleanup` se ejecutó en **dry-run** y encontró exactamente 2 tenants y 12 usuarios. No se borró nada.

Para borrar, se requieren simultáneamente `E2E_ALLOW_CLEANUP=1` y `--execute`; el script vuelve a verificar ref QA, entorno, prefijo y metadata antes de cualquier eliminación. Nunca acepta el ref productivo.

## Verificación ejecutada

- Aislamiento Tenant A/B: **OK**. Owners autenticados sólo ven su tenant y sus filas.
- Smoke autenticado owner A (1366/390, light/dark): **OK**.
- Smoke platform owner (1366): **OK**.
- Catálogo de reserva pública QA (390): **OK**, sin crear reserva.
- `billing-api` mock Edge Function: **ACTIVE sólo en QA**, JWT obligatorio, CORS limitado a orígenes conocidos, sin secretos ni proveedores externos.
- Estados de billing ejercitados: `trialing`, `active`, `past_due`, `suspended`, `canceled`; checkout y reconciliación mock idempotentes.
- Playwright autenticado: **192/192** escenarios reales en 8 proyectos (corrida serial QA del 2026-08-13).
- Playwright público: **72/72** escenarios en 8 proyectos (corrida serial).
- Verificación billing mock: estados, checkout y reconciliación idempotente; usuario sin tenant bloqueado.
- Host productivo contactado: **no**.
- Evidencia: `docs/authenticated-qa/`. Los usuarios ausentes detectados en la auditoría previa se restauraron con `npm run e2e:qa:fixtures -- --execute`; no se insertaron datos arbitrarios.

## Pendiente seguro

No quedan bloqueos de infraestructura QA para la matriz autenticada. Billing sigue siendo un mock interno: no conecta Mercado Pago, PayPal, n8n, Evolution ni WhatsApp, y no debe desplegarse en producción. El cleanup posterior a la corrida se dejó en dry-run y detectó solamente los dos tenants y 12 usuarios `E2E_QA_`.

## Rollback

Ejecutar primero el dry-run; luego el cleanup marcado si se requiere eliminar fixtures. Si se necesitara reset total, eliminar exclusivamente el proyecto **Austral SaaS QA** desde Supabase Dashboard. Nunca usar el ref productivo.
