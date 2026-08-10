# Resultados QA/E2E — cierre de P1

Fecha: 2026-08-10  
Proyecto: Austral SaaS QA (`cmsymmszlzikqpvfqjre`)  
Producción prohibida: `ssagttjdgtypxjcgdnrw`

## Cobertura

- 24 flujos autenticados reales × 6 proyectos Playwright = **144/144 passed**.
- 8 flujos públicos × 6 proyectos = **48/48 passed**.
- Total de la matriz: **192/192 passed**, sin `test.fail`, placeholders ni skips cuando `E2E_REAL_SUPABASE=1`.
- Viewports: 390×844, 360×800, 768×1024, 1366×768 y 1920×1080, además de Chromium desktop.

## P1 resueltos

1. Se desplegó `billing-api` mock sólo en QA. Requiere JWT, valida el ref QA, autentica al usuario con Supabase, limita roles de plataforma y tenants QA, no lee secretos de proveedores, no escribe pagos ni suscripciones, y responde estados controlados (`trialing`, `active`, `past_due`, `suspended`, `canceled`). Checkout y reconciliación devuelven resultados mock idempotentes.
2. Se reemplazaron los 144 stubs por pasos reales: Auth/onboarding, trial, aislamiento RLS, roles tenant/plataforma, dashboard/configuración, servicios/equipo/horarios, disponibilidad pública sin confirmar reserva, CRM reversible, billing mock, recuperación, logout y responsive.

## Seguridad y aislamiento

- 2 tenants y 12 usuarios QA identificables; todos los datos llevan `E2E_QA_` o correo `.invalid`.
- `npm run e2e:preflight`: OK.
- Cleanup dry-run: OK; no eliminó datos.
- No se usaron secretos en navegador, logs, commits ni capturas.
- No se contactaron servicios productivos ni se activaron pagos, webhooks, WhatsApp, Evolution o n8n.

## Hallazgo adicional corregido

El sidebar ahora tiene scroll interno seguro para mantener las acciones inferiores accesibles en viewports cortos; el logout reutiliza el callback existente y expone un nombre accesible estable. El seed QA revalida de forma idempotente la contraseña únicamente de usuarios ficticios bajo los guards del proyecto QA.

El logout no estaba disponible en el sheet móvil “Más”; se agregó el botón reutilizando el callback existente. También se evitó registrar como error el cierre normal del canal Realtime al desmontar la vista y se mantuvo la limpieza del canal.

## Riesgos pendientes

- El billing mock es exclusivamente QA y no reemplaza una integración sandbox de proveedor.
- La suite no debe ejecutarse contra producción ni con credenciales externas.
- Sprint 8 no se inicia con este cambio.
