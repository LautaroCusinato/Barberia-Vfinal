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

Las pruebas que requieren autenticación o Supabase real están explícitamente gated por `E2E_REAL_SUPABASE=1`. Deben ejecutarse sólo contra un proyecto sandbox separado, con usuarios de prueba y un prefijo único como `E2E_20260807_`. No se deben reutilizar cookies, usuarios ni datos del tenant productivo.

## Cobertura preparada

El spec público cubre landing, registro, recuperación, demo aislada, errores de reserva/invitación y recarga directa de rutas de Cloudflare en desktop y móvil. El bloque sandbox deja catalogados 24 flujos: registro/verificación y duplicados, onboarding y reanudación, tenant/trial, configuración regional y slug, dashboard, branding, servicios, empleados, horarios, reservas y solapamientos, invitaciones, roles, aislamiento multi-tenant, acceso denegado, plataforma, CRM, billing sin proveedor, vencimiento/gracia, suspensión, recuperación/cambio de contraseña, cierre de sesión y responsive.

Los flujos sandbox no se ejecutan automáticamente hasta que exista autorización y un proyecto dedicado. Esto evita que una ejecución CI pueda modificar tenants reales o disparar emails, WhatsApp, pagos o webhooks.

## Cleanup

El cleanup está bloqueado por defecto. Sólo permite borrar filas de tablas CRM cuyo nombre empiece por el prefijo explícito:

```bash
E2E_ALLOW_CLEANUP=true E2E_TEST_PREFIX=E2E_20260807_ \
E2E_SUPABASE_URL=https://sandbox.supabase.co \
E2E_SUPABASE_SERVICE_ROLE_KEY='(fuera del repositorio)' \
npm run e2e:cleanup
```

Nunca se imprime la clave. Si la suite crece para crear tenants reales de prueba, debe agregarse un cleanup transaccional específico para esas tablas antes de habilitar `E2E_REAL_SUPABASE`.

## CI

GitHub Actions ejecuta lint, tests estáticos, build, revisión de secretos, bundle size y Playwright público. Las migraciones nunca se despliegan desde CI; sólo se validan estáticamente.
