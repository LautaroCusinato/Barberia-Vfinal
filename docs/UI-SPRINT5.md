# UI Sprint 5 · Plataforma y CRM

## Alcance

Se implementó exclusivamente el rediseño visual de la Plataforma y el CRM. Se mantuvieron intactos los contratos, consultas, RPC, permisos, RLS, Supabase, billing, Mercado Pago, Edge Functions, n8n, Evolution, autenticación y aislamiento multi-tenant.

La implementación aplica las reglas de **Austral SaaS Architecture** (cero cambios de dominio y autorización) y **Austral Design System** (tokens semánticos, primitives existentes, estados y responsive consistente).

## Cambios realizados

- Nuevo stylesheet scoped en `src/components/platform.css` para no contaminar el resto del producto.
- Importación del stylesheet desde `src/main.jsx` junto con los estilos compartidos existentes.
- `PlatformCRM` recibió hooks visuales (`platform-screen`, `platform-nav`, `platform-kpis`, paneles por contexto) sin modificar handlers, queries ni payloads.
- `CRMLeadsWorkspace` reutiliza la misma lógica y ahora puede compartir la capa visual de Plataforma mediante `platform-crm-tool`.
- Dashboard de Plataforma: jerarquía de encabezado, KPIs con contexto, acciones primarias, tabla de negocios con tratamiento de card en mobile.
- CRM/Leads: toolbar y filtros más legibles, métricas de pipeline, breakdown por etapa, tabla con densidad controlada y lectura tipo ficha en mobile.
- Seguimientos: timeline visual, estados y acciones con mejor agrupación.
- Billing: panel de salud y consola sandbox separados en tarjetas, manteniendo el control técnico y sus restricciones actuales.
- Navegación responsive: el sidebar existente se transforma en navegación horizontal desplazable hasta 860 px, sin crear rutas ni estados nuevos.
- Dark mode, focus-visible, reduced motion, safe-area inferior y prevención de overflow horizontal.

## Componentes reutilizados

Se reutilizaron los primitives y tokens globales ya disponibles (`Button`/`.btn`, `.panel`, `.stat-card`, `.status-pill`, `.crm-search`, `.table-scroll`, `.empty-state`, `.error-banner`, `.modal-*`, tokens `--space-*`, `--control-*`, `--radius-*`, `--shadow-*`, `--motion-*`). No se creó una segunda implementación de Button, Input, Badge, Modal o Toast.

## Evidencia visual

Las capturas se tomaron con un fixture local anonimizado que intercepta únicamente las respuestas de red de la prueba; no se escribieron datos ni se contactaron servicios externos.

- Baseline: [dashboard antes](ui-sprint5/before-platform-1366-light.png), [CRM antes](ui-sprint5/before-crm-1366-light.png).
- Dashboard light: [1366 px](ui-sprint5/after-businesses-1366-light.png), [360 px](ui-sprint5/after-businesses-360.png), [390 px](ui-sprint5/after-businesses-390.png), [768 px](ui-sprint5/after-businesses-768.png), [1920 px](ui-sprint5/after-businesses-1920.png).
- Dashboard dark: [1366 px](ui-sprint5/after-businesses-1366-dark.png).
- Leads/CRM: [desktop](ui-sprint5/after-leads-1366-light.png), [mobile](ui-sprint5/after-crm-390.png).
- Seguimientos: [desktop](ui-sprint5/after-actions-1366-light.png).
- Billing: [desktop](ui-sprint5/after-billing-1366-light.png).

## Verificaciones

Playwright recorrió Dashboard/Negocios, Leads/CRM, Seguimientos y Billing en light y dark, con viewports 360, 390, 768, 1366 y 1920. Se comprobó:

- navegación visible y operable en mobile;
- cero overflow horizontal;
- cero errores de consola en la pasada final;
- controles sin labels ausentes (`missingLabels: 0`);
- estilos dark aplicados después de completar la transición;
- estados de cards, tablas, métricas, filtros y timeline.

También se ejecutaron:

```text
npm run lint
npm test
npm run build
git diff --check
```

El escaneo de secretos no encontró valores hardcodeados de alta confianza. La única coincidencia residual es el nombre `service_role` dentro de una plantilla contractual existente, sin token ni valor secreto.

## Pendientes para Sprint 6

- Landing y Product Polish.
- Optimización de performance/bundle, diferida por alcance.
- Nuevas capacidades funcionales o cambios de backend, fuera de este Sprint 5.

Sprint 6 no fue iniciado.
