# UI Sprint 7 · Product polish

## Alcance y guardrails

Se implementó únicamente la pasada de **Product Polish**. No se agregaron funcionalidades ni se modificaron reglas de negocio, contratos, datos o integraciones. Se aplicaron explícitamente **Austral Design System** y **Austral SaaS Architecture**:

- No hubo cambios en Supabase, RPC, RLS, billing, Mercado Pago, Edge Functions, WhatsApp, n8n, Evolution, autenticación ni multi-tenant.
- La capa nueva es presentación compartida: tokens existentes, estados visuales, foco, feedback y responsive.
- Los datos, rutas, permisos, callbacks y consultas siguen siendo los existentes.

## Cambios implementados

### Microinteracciones y estados

- Se creó `src/components/polish.css` como capa visual común, importada después de las hojas de producto existentes.
- Se unificaron transiciones de controles en el rango 160–240 ms, estados hover/pressed/disabled/focus y entradas sutiles de páginas, modales, sheets y avisos.
- Los botones con `loading` exponen `aria-busy` y mantienen un cursor de espera; el login muestra spinner y texto de progreso.
- La capa compartida aplica focus rings consistentes a botones, icon buttons, navegación, selección de reserva, tabs, filtros y controles demo.
- Se respetan `prefers-reduced-motion` y las safe areas móviles existentes.

### Feedback, loading, empty y error

- Los errores de datos del panel siguen registrándose para observabilidad, pero la interfaz muestra únicamente una explicación amigable y una acción explícita para cerrar el aviso.
- El aviso global de error pasó a `role="alert"`/`aria-live="assertive"` con botón de cierre accesible; ya no depende de hacer click en todo el banner.
- Se reforzaron skeletons, spinners, estados vacíos, tablas desplazables y áreas de carga para evitar saltos visuales y mantener la geometría del contenido.
- Las superficies vacías comparten borde, contraste, jerarquía y espacio, sin inventar datos ni métricas.

### Accesibilidad y navegación

- `FocusTrap` bloquea el scroll del documento mientras un modal/sheet está abierto, conserva el foco inicial, mantiene el ciclo de Tab y devuelve el foco al elemento que lo abrió.
- Navegación de escritorio, mobile tabs y sheet exponen `aria-current` en la vista activa; controles de tema y bot exponen `aria-pressed`.
- Los estados intermedios de selección de workspace/negocio usan `<main>`, eyebrow y headings semánticos.
- Login y registro ahora reutilizan `PasswordField`, labels asociados, `autocomplete`, `required` y mensajes de progreso consistentes. No cambiaron las reglas de autenticación.
- La reserva pública reutiliza la misma regla y formato de teléfono en hint y validación (la validación agrega la instrucción compatible con el mensaje histórico del test), sin alterar la normalización ni el contrato de persistencia.

### Responsive y dark mode

- La capa compartida ajusta acciones, modales, panels, sheet, tabbar y padding inferior en pantallas pequeñas.
- Se agregó fallback de tokens dark para preferencia del sistema en superficies que no tienen un selector local, preservando el override explícito `[data-theme="light"]`.
- Los contenedores de tablas, banners y cards evitan overflow horizontal accidental; la barra inferior respeta `safe-area-inset-bottom`.

## Componentes reutilizados

Se extendieron sin duplicar API los primitives de `src/components/ui/`: `Button`, `IconButton`, `PasswordField`, `FocusTrap`, `Modal`, `Sheet`, `EmptyState`, `Skeleton`, `Spinner`, `FormField`, `Toast` y `LiveRegion`. No se eliminaron componentes existentes porque todos mantienen referencias activas.

## Superficies recorridas

La auditoría visual cubrió landing, login, registro, onboarding, demo, reserva pública y el entrypoint de Plataforma sin sesión de pruebas. Las evidencias de Agenda, gestión, billing, CRM y Plataforma autenticada de Sprints 2–5 se mantienen como baseline; esta etapa solo aplicó la capa compartida para no alterar sus consultas ni contratos.

## Evidencia

Las capturas nuevas están en [docs/ui-sprint7/](ui-sprint7/). Incluyen landing light/dark en mobile/desktop, auth, onboarding, demo dark, reserva pública y el estado de entrada de Plataforma. Las capturas “before” se referencian desde los directorios de Sprints anteriores para que la comparación no duplique assets.

No se contactaron clientes, no se escribieron datos reales y no se ejecutaron pagos ni webhooks.

## Revisión como dueño de barbería

La revisión no técnica está en [docs/PRODUCT-REVIEW.md](PRODUCT-REVIEW.md). Es una pasada estructurada sobre los flujos disponibles y la evidencia de Sprints anteriores, no un estudio con usuarios reales ni una métrica de conversión.

## Verificaciones

Se ejecutaron o quedan registrados para la pasada final:

```text
npm run lint
npm test
npm run build
npm run test:e2e
git diff --check
node scripts/scan-secrets.mjs
```

Playwright cubre los proyectos configurados de 360, 390, 768, 1366 y 1920 px, con los escenarios públicos disponibles y skips documentados para rutas que requieren una sesión Supabase. Lighthouse no está instalado en el entorno y no se agregó una dependencia solo para esta etapa; no se reporta un score inventado.

## Pendientes reales

- Ejecutar una pasada autenticada con usuarios de prueba en Agenda, gestión, CRM y Plataforma para validar cada estado de datos con sus permisos reales.
- Revisar Lighthouse cuando exista un entorno con el CLI disponible.
- La optimización global de performance y Product QA quedan fuera de Sprint 7.

Sprint 8 no fue iniciado.
