# UI Sprint 8 — Performance y optimización

Fecha: 2026-08-10
Aplicación explícita: **Austral SaaS Architecture** y **Austral Design System**.

## Alcance

Se optimizó carga, bundle y sincronización sin modificar comportamiento funcional, contratos, Supabase, RLS, RPC, billing, Mercado Pago, n8n, Evolution, WhatsApp ni producción.

## Cambios implementados

### 1. Split de rutas y CSS

- `App`, `PlatformCRM`, `Landing`, `Login` y `DemoWorkspace` pasan a cargarse con `lazy`/`Suspense`.
- `agenda.css` y `management.css` se cargan junto al workspace de negocio.
- `platform.css` se carga junto a Plataforma.
- `landing.css` se carga junto a Landing.
- `logout` se movió a `src/lib/auth.js` para no hacer eager-load del componente Login cuando sólo se necesita cerrar sesión.
- Se preservó un fallback de carga accesible y las rutas existentes.

### 2. Datos y sincronización

- La carga inicial del dashboard comparte la consulta de clientes entre Clientes y Mensajes: se elimina una solicitud duplicada sin cambiar datos ni contratos.
- Realtime sigue siendo la fuente primaria. El polling fijo de 6 segundos fue reemplazado por fallback sólo cuando el canal falla, con backoff de 15 → 30 → 60 segundos y cancelación al desmontar.
- Al ocultar la reserva pública se detiene su intervalo de 30 segundos; se reanuda al volver visible.
- CRM carga `platform_members` una sola vez por montaje; búsqueda, filtros y paginación ya no repiten esa consulta estable.

## Métricas antes/después

### Bundle

| Artefacto | Antes raw | Después raw | Antes gzip | Después gzip |
| --- | ---: | ---: | ---: | ---: |
| Entry JS `index` | 449.67 kB | **217.00 kB** | 115.30 kB | **56.76 kB** |
| CSS inicial `index` | 193.97 kB | **117.25 kB** | 32.14 kB | **20.74 kB** |

La carga de cada ruta agrega ahora sólo su CSS/módulo correspondiente. Por ejemplo, el build produce chunks separados para `App` (142.84 kB), `PlatformCRM` (73.59 kB) y `Landing` (30.44 kB), en lugar de incluirlos en el entry.

### Requests y Web Vitals

La evidencia posterior está en [`performance-sprint8/after.json`](./performance-sprint8/after.json) y la prueba prolongada del dashboard en [`after-dashboard-17s.json`](./performance-sprint8/after-dashboard-17s.json).

| Ruta | Primera captura al retomar → final | JS primera captura → final | CSS primera captura → final | LCP final | CLS final |
| --- | ---: | ---: | ---: | ---: | ---: |
| Landing | 11 → 11 | 5 → 4 | 2 → 3 | 636 ms | 0 |
| Reserva pública | 11 → 12 | 5 → 5 | 3 → 4 | 508 ms | 0.00001 |
| Login | 8 → 10 | 4 → 5 | 2 → 3 | 268 ms | 0 |
| Dashboard QA | 11 → 11 | 5 → 4 | 2 → 3 | 260 ms | 0.0021 |

La primera captura de rutas ya incluía el split inicial porque Sprint 8 se retomó con cambios parciales; por eso esas flechas no representan un baseline pre-split. El número total de requests se mantiene estable porque el código dividido se solicita bajo demanda; el payload inicial sí se reduce de forma importante. La carga inicial operativa elimina una consulta duplicada de clientes. En una ventana de 17 segundos con Realtime conectado, el dashboard no generó requests de fallback adicionales.

Los valores de LCP son muestras cold-load locales y pueden variar por la inicialización del servidor preview. INP no fue medible de forma representativa; TTFB local no se extrapola a producción.

## Accesibilidad y UX preservadas

- Se conserva `Suspense` con `RouteLoading`, roles de estado y layout estable.
- No se cambió ninguna ruta, callback, permiso, RPC ni payload.
- Se mantiene el control de foco, dark mode, safe areas y reduced motion del Austral Design System.
- No se agregaron dependencias.

## Riesgos y pendientes

- La virtualización de listas no se implementó: los fixtures y el volumen disponible no justifican introducir complejidad sin una medición de producción.
- Las consultas con `select('*')` se mantienen donde las pantallas consumen campos completos; reducirlas requiere un inventario de campos por componente y pruebas de contrato.
- La medición de Lighthouse queda pendiente de un entorno con CLI/CDP habilitado.
- Antes de una release candidate conviene observar Realtime y fallback con telemetría agregada, sin datos sensibles.

## Verificaciones requeridas

Antes del commit/push deben pasar lint, tests, build, 48 E2E públicos, 144 E2E autenticados QA, `git diff --check` y `node scripts/scan-secrets.mjs`. Sprint 8 termina aquí; no se inicia Release Candidate.
