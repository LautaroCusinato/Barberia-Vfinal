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

- `npm run build`: OK. Entry JS 232.50 kB raw / 59.97 kB gzip; `Landing` continúa separado en 23.48 kB raw / 6.57 kB gzip.
- La medición QA en 390×844 (`docs/performance-sprint8/after-hero.json`) registró 10 requests, 0 duplicadas, LCP 260 ms y CLS 0.0034.
- El test de Playwright aborta el chunk lazy `Landing-*.js` y mantiene visible el título y CTA del hero, además de verificar scroll, reduced motion y `visibilitychange`.
- `npm run lint`, `npm test`, `npm run build`, Playwright público (9/9 en Chromium) y secret scan pasan.

## Producción

La observación read-only previa en `https://barberia.cuchitron.lat/` fue saludable (hero visible, estilos aplicados y sin errores de consola). La corrección necesita desplegarse para validar el ciclo completo sobre el build nuevo; no se purgaron caches ni se modificó Cloudflare.
