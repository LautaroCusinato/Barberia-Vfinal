# Performance baseline — Sprint 8

Fecha: 2026-08-10
Entorno: preview local, viewport 390×844 (la captura QA usa el proyecto aislado; no se contacta producción)
QA permitido: `cmsymmszlzikqpvfqjre`
Producción prohibida: `ssagttjdgtypxjcgdnrw`

## Bundle inicial

Medición previa a los cambios de Sprint 8, obtenida con `vite build`:

| Artefacto | Raw | Gzip |
| --- | ---: | ---: |
| Entry JS `index` | 449.67 kB | 115.30 kB |
| CSS inicial `index` | 193.97 kB | 32.14 kB |
| `vendor` JS | 160.84 kB | 52.34 kB |
| `ui` JS | 29.13 kB | 8.19 kB |

Los módulos `App`, `PlatformCRM`, `Landing` y sus CSS se resolvían desde el grafo inicial de `main.jsx`.

## Rutas y red

La medición Playwright de preview está guardada en [`performance-sprint8/baseline.json`](./performance-sprint8/baseline.json). Los números son una muestra cold-load, no un promedio estadístico.

Nota de trazabilidad: al retomar Sprint 8, el split inicial de rutas ya estaba aplicado. Por eso este JSON es la primera captura del arnés sobre el estado parcial y no pretende reconstruir el grafo previo al split. Los valores de bundle de la sección anterior sí son la referencia pre-optimización registrada por el trabajo interrumpido. No se inventaron requests o Web Vitals pre-split que no estuvieran disponibles.

| Ruta | Requests | JS | CSS | Duplicados |
| --- | ---: | ---: | ---: | ---: |
| Landing barbería | 11 | 5 | 2 | 0 |
| Reserva pública | 11 | 5 | 3 | 0 |
| Login | 8 | 4 | 2 | 0 |
| Dashboard autenticado QA | 11 | 5 | 2 | 0 |

En `App.jsx` la carga inicial hacía 10 consultas operativas: `clientes` se consultaba una vez para la lista y otra vez dentro de mensajes. Además existía polling fijo cada 6 segundos para mensajes, turnos, clientes y pagos aunque Realtime estuviera conectado.

`CRMLeadsWorkspace` recargaba `platform_members` en cada búsqueda, filtro o cambio de página aunque los responsables no dependieran de esos filtros.

## Web Vitals y render proxy

Los valores de navegación se midieron con `performance-measure.mjs`. `MutationObserver` se usa sólo como proxy de actividad DOM; no se modificó React para instrumentar producción.

| Ruta | LCP | CLS | FCP | TTFB | Mutaciones DOM |
| --- | ---: | ---: | ---: | ---: | ---: |
| Landing barbería | no capturado en esa muestra | 0.0021 | no capturado | 6.1 ms | 4 |
| Reserva pública | 592 ms | 0.00001 | 232 ms | 4.1 ms | 5 |
| Login | 236 ms | 0 | 236 ms | 4.4 ms | 3 |
| Dashboard autenticado QA | 240 ms | 0.0021 | 240 ms | 4.4 ms | 5 |

INP no fue medible sin una interacción sintética representativa. TTFB de preview local no representa Cloudflare/Supabase productivo.

## Evidencia y límites

- No se imprimieron tokens, cookies, claves ni valores de `.env.e2e.local`.
- La sesión utilizada para el dashboard fue un usuario QA sintético; no se hicieron escrituras.
- Lighthouse CLI no está instalado; se usó Playwright/Performance API sin inventar puntuaciones.
- La referencia de bundle fue capturada antes del split; el JSON de rutas documenta el primer estado observable al retomar la tarea.
