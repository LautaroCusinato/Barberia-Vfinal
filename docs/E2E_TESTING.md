# Estrategia E2E segura

El proyecto usa Playwright para validar las superficies públicas en Chromium desktop, tablet y móvil. La matriz incluye 390×844, 360×800, 768×1024, 1366×768 y 1920×1080. Las pruebas públicas no envían formularios de registro, no crean reservas y no llaman a proveedores externos. La ruta `/demo` usa `sessionStorage` y servicios ficticios.

## Instalación y ejecución

```bash
npm ci
npx playwright install chromium
npm run test:e2e
```

`playwright.config.mjs` levanta Vite en `127.0.0.1:4173` cuando no se define `E2E_BASE_URL`. Para probar una URL de preview:

```bash
E2E_BASE_URL=https://preview.example.com npm run test:e2e
```

Las pruebas que requieren autenticación o Supabase real están explícitamente gated por `E2E_REAL_SUPABASE=1`. Deben ejecutarse sólo contra un proyecto sandbox separado, con usuarios de prueba y el prefijo único `E2E_QA_`. No se deben reutilizar cookies, usuarios ni datos del tenant productivo.

## Cobertura autenticada QA

El spec público cubre landing, registro, recuperación, demo aislada, errores de reserva/invitación y recarga directa de rutas de Cloudflare en desktop y móvil. El bloque sandbox deja catalogados 24 flujos: registro/verificación y duplicados, onboarding y reanudación, tenant/trial, configuración regional y slug, dashboard, branding, servicios, empleados, horarios, reservas y solapamientos, invitaciones, roles, aislamiento multi-tenant, acceso denegado, plataforma, CRM, billing sin proveedor, vencimiento/gracia, suspensión, recuperación/cambio de contraseña, cierre de sesión y responsive.

Con `.env.e2e.local` cargado y `npm run e2e:preflight` aprobado, `npm run test:e2e -- --workers=1` ejecuta 24 flujos autenticados por cada uno de los 6 proyectos Playwright (144 escenarios reales). La suite usa sólo el ref QA `cmsymmszlzikqpvfqjre`, usuarios `e2e_qa_*` y el prefijo `E2E_QA_`. No debe ejecutarse contra producción.

Billing se prueba mediante la Edge Function mock `billing-api` desplegada sólo en QA: devuelve estados controlados, checkout `qa.invalid`, reconciliación idempotente y ausencia de proveedores. No conecta Mercado Pago, PayPal, n8n, Evolution ni WhatsApp.

El logout móvil usa el sheet “Más” y todas las mutaciones QA son reversibles o están marcadas con el prefijo. Para limpiar, ejecutar primero dry-run y sólo después `npm run e2e:cleanup -- --execute` con los guards explícitos.

## Preflight y fixtures QA

El guard verifica proyecto, URL, entorno, prefijo y ausencia de secretos de proveedores externos antes de cualquier conexión:

```bash
npm run e2e:preflight
node scripts/e2e-qa-fixtures.mjs                 # dry-run
node scripts/e2e-qa-fixtures.mjs --execute       # requiere E2E_ALLOW_FIXTURE_SEED=1
```

El script de fixtures es idempotente, revalida la contraseña local de cada usuario ficticio y crea sólo tenants/usuarios marcados `E2E_QA_`.

## Cleanup

Las instrucciones históricas de este documento quedan reemplazadas por `scripts/e2e-cleanup.mjs`: usar `node scripts/e2e-cleanup.mjs` para dry-run y `node scripts/e2e-cleanup.mjs --execute` sólo con `E2E_ALLOW_CLEANUP=1`, `E2E_ALLOWED_PROJECT_REF` coincidente y el prefijo exacto `E2E_QA_`. No usar los valores de prefijo ni el flag booleano de ejemplos antiguos.

El cleanup está bloqueado por defecto. Sólo permite borrar filas de tablas CRM cuyo nombre empiece por el prefijo explícito:

```bash
E2E_ALLOW_CLEANUP=true E2E_TEST_PREFIX=E2E_QA_ \
E2E_SUPABASE_URL=https://sandbox.supabase.co \
E2E_SUPABASE_SERVICE_ROLE_KEY='(fuera del repositorio)' \
npm run e2e:cleanup
```

Nunca se imprime la clave. Si la suite crece para crear tenants reales de prueba, debe agregarse un cleanup transaccional específico para esas tablas antes de habilitar `E2E_REAL_SUPABASE`.

## CI

GitHub Actions ejecuta lint, tests estáticos, build, revisión de secretos, bundle size y Playwright público. Las migraciones nunca se despliegan desde CI; sólo se validan estáticamente.
