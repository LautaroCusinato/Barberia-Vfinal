# Hero reliability follow-up

Fecha: 2026-08-13  
Aplicación: Austral SaaS Architecture + Austral Design System

## Diagnóstico

La reproducción local y la inspección read-only de producción mostraron que el CSS del hero no aplica `opacity: 0`, `visibility: hidden`, `content-visibility` ni `IntersectionObserver`. El estado intermitente, sin embargo, era posible por el montaje de la landing completa detrás de un único `Suspense`: cuando el chunk `Landing` tardaba o fallaba, el fallback global reemplazaba toda la superficie pública. El HTML inicial también era un segundo fallback que React debía reemplazar.

## Corrección

- `LandingHero` se importa eager desde `main.jsx` y contiene branding, título, texto y CTAs críticos.
- Las secciones secundarias continúan en el chunk lazy `Landing` mediante `Suspense` local.
- `LandingSectionsBoundary` limita un error secundario a un fallback funcional y no reemplaza el hero.
- El fallback de secciones reserva espacio visible; no es una superficie vacía.
- El visual del producto se comparte entre Hero y Landing en `LandingProductVisual.jsx`, sin duplicar lógica.

## Evidencia

- `npm run build`: OK. Entry JS 231.08 kB raw / 59.85 kB gzip; initial CSS 150.58 kB raw / 25.59 kB gzip. `Landing` continúa separado en 20.30 kB raw / 5.98 kB gzip. Frente al baseline pre-Sprint 8 de 449.67 kB JS raw / 115.30 kB gzip, el payload inicial sigue muy por debajo; el incremento marginal frente al split de Sprint 8 es el costo deliberado de hacer crítico el Hero y su CSS.
- La medición QA en 390×844 (`docs/performance-sprint8/after-hero.json`) registró 10 requests, 0 duplicadas, LCP 260 ms y CLS 0.0034.
- El test de Playwright aborta el chunk lazy `Landing-*.js` y mantiene visible el título y CTA del hero durante 30 segundos, además de verificar scroll, reduced motion y `visibilitychange`.
- `npm run lint`, `npm test`, `npm run build`, Playwright público (9/9 en Chromium) y secret scan pasan.

## Producción

La observación read-only previa en `https://barberia.cuchitron.lat/` fue saludable (hero visible, estilos aplicados y sin errores de consola). Tras el push, GitHub Actions terminó SUCCESS para `aae9b8f`, pero el dominio personalizado y los dominios Pages observados continuaron sirviendo el fingerprint anterior; no se purgaron caches ni se modificó Cloudflare. La validación de ciclo completo en producción queda bloqueada hasta que Pages publique este commit.
