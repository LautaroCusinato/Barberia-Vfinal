# Auditoría final UI / UX / Frontend

Fecha: 2026-08-21  
Alcance: Austral SaaS Architecture + Austral Design System  
Mercado Pago: pausado; no se ejecutaron operaciones financieras.

## Alcance y seguridad

Se revisaron las rutas públicas, la demo aislada, la reserva pública QA y la
evidencia autenticada QA existente. El servidor local se reinició con:

- Supabase QA: `cmsymmszlzikqpvfqjre`.
- Supabase producción: no utilizado en las comprobaciones posteriores.
- `BILLING_PRODUCTION_ENABLED`: sin cambios, deshabilitado.

Durante la primera carga previa a detectar el riesgo, el `.env` local heredado
apuntó al catálogo público de producción. Esa carga fue exclusivamente de
lectura (sin autenticación, writes ni billing); se detuvo y el resto de la
auditoría se ejecutó con variables QA explícitas. El `.env` no fue modificado.

No se tocaron RLS, RPC, migraciones, billing, Mercado Pago, WhatsApp, n8n,
Evolution ni datos productivos.

## Rutas y superficies revisadas

| Superficie | Estado visual | Evidencia |
|---|---|---|
| `/` y `/para/barberia` | PASS tras revisar hero, CTA, tabs, pricing desde catálogo, FAQ, footer, light/dark | `after-landing-390-*`, `after-landing-1366-light.png` |
| `/ingresar` | PASS; foco inicial, labels, password field y error accesible | revisión 390/1366 |
| `/registro` | PASS; formulario, validación y jerarquía | revisión 390/1366 |
| `/recuperar` | PASS; estado inicial, landmarks y status live | revisión 390/1366 |
| `/onboarding` | PASS en estado no autenticado; CTA y jerarquía | revisión 390/1366 |
| `/demo` | PASS; resumen, Agenda, Clientes, Mensajes, Equipo, Configuración, Facturación, WhatsApp bloqueado, menú Más | `after-demo-390-*` + revisión desktop |
| `/reservar/e2e-qa-barberia-a` | PASS tras corregir stepper móvil; light/dark, estados de disponibilidad y overflow | `before-booking-390-light.png`, `after-booking-390-*`, `after-booking-1366-light.png` |
| `/plataforma` | Se verificó el fallback no autenticado y se revisó la evidencia autenticada QA existente | `docs/authenticated-qa/` |
| CRM/plataforma | Evidencia autenticada QA existente revisada; tablas y estados internos permanecen fuera de la lógica del cambio | `docs/authenticated-qa/platform-owner-1366.png` |

## Issues encontrados y correcciones

### P1 corregidos: 1

- **Stepper de reserva pública móvil ilegible.** El selector CSS
  `.booking-progress-step span` también afectaba los spans internos de las
  etiquetas, apilando círculos y textos en 320–390 px. Se limitó el estilo al
  hijo directo (`> span`) y se compactaron las etiquetas móviles a `Serv.`,
  `Prof.`, `Fecha`, `Datos`, `Listo`. La versión desktop conserva los nombres
  completos.

### P2 corregidos: 2

- Las tabs del preview de producto en landing se cortaban horizontalmente en
  pantallas de hasta 420 px. Ahora forman una grilla 2×2 táctil sin overflow.
- El fallback del catálogo público mostraba tiers y precios USD no respaldados
  si el RPC no respondía. Se dejó únicamente Starter ARS 30.000/mes, respaldado
  por el catálogo comercial vigente; cuando el RPC responde, se sigue usando
  exclusivamente ese catálogo.

### P2 de accesibilidad corregido: 1

- Login, registro y recuperación ahora exponen un landmark `<main>`; los
  mensajes de recuperación usan `role="status"` y `aria-live="polite"`.

## Responsive / dark mode / accesibilidad

Se midió `document.body.scrollWidth` contra `innerWidth` en demo y reserva QA
en 320, 360, 375, 390, 412 y 430 px: no hubo overflow horizontal. También se
revisaron 1366 px en landing, demo, Agenda y reserva pública. La bottom nav
mantiene `padding-bottom: 76px` y safe-area para no tapar contenido.

Se revisaron light/dark en landing, demo y reserva QA; los estados se estabilizaron
antes de capturar evidencia para no confundir transiciones con errores de
contraste. Focus visible, labels, `aria-current`, `aria-pressed`, `role=status`
y focus trap del menú Más permanecen activos.

## Evidencia

Archivos nuevos en [`docs/ui-audit-final/`](./ui-audit-final/):

- `before-booking-390-light.png` (baseline con el solapamiento).
- `after-booking-390-light.png`, `after-booking-390-dark.png`.
- `after-booking-1366-light.png`.
- `after-landing-390-light.png`, `after-landing-390-dark.png`.
- `after-landing-1366-light.png`.
- `after-demo-390-light.png`, `after-demo-390-dark.png`.

## Verificación automatizada y deploy

- `npm test`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- Secret scan de archivos trackeados: PASS.
- Playwright público: 72/72 PASS.
- Playwright demo: 160/160 PASS + 8 SKIPPED explícitos; DEMO-01 fue repetido
  3/3 tras alinear su espera con la ruta lazy.
- Playwright autenticado QA: 192/192 PASS con guards explícitos contra
  `cmsymmszlzikqpvfqjre`; Billing QA mock, multi-environment y Tenant A/B PASS.
- CI del commit `3494150`: `quality=SUCCESS`, `e2e-public=SUCCESS`,
  `e2e-demo=SUCCESS`, `authenticated-qa=SKIPPED` por ausencia de secrets del
  workflow. `Cloudflare Pages: barberia-qa-pages=SUCCESS`; el Worker antiguo
  `barberia-qa` continúa fuera de scope y FAILURE independiente.
- Preview Pages reportado por CI: `b3205ebf.barberia-qa-pages.pages.dev`.
  El dominio `https://barberia-qa.cuchitron.lat` responde HTTP 200 y el smoke
  visual remoto en 390 px muestra el stepper compacto, el fixture QA y cero
  overflow (`scrollWidth=382`, `innerWidth=390`).
- El chunk remoto `MercadoPagoCardTokenForm-DMvnt4k1.js` contiene
  `billing-card-secure-field`; el bundle no contiene el ref productivo,
  `service_role`, Access Token ni webhook secret.

Evidencia adicional: `after-qa-booking-390-light.png`.

## Pendientes reales

- No hay P0/P1 visuales pendientes en las superficies auditadas.
- El estado autenticado remoto queda representado por la suite QA 192/192 y la
  evidencia versionada; no se abrió una sesión owner/admin productiva.
- Cualquier decisión sobre tiers adicionales, moneda o precios requiere
  catálogo/backend y autorización comercial; no se inventaron valores en esta
  pasada.

## Resultado

No se encontraron P0. El P1 del stepper y los P2 de tabs/fallback de catálogo,
además de los ajustes de accesibilidad, quedaron corregidos y verificados en
local QA y en el deploy Pages QA. Mercado Pago, producción e integraciones
externas permanecen sin operaciones ni cambios.
