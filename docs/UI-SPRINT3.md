# UI Sprint 3 · Agenda operativa

## Alcance

Se rediseñó únicamente la interfaz de Agenda del workspace de negocio. La vista sigue utilizando los modos mensual y semanal existentes, los mismos filtros, callbacks, modal y operaciones de turnos. No se modificaron disponibilidad, reservas, RPC, Supabase, RLS, Edge Functions, backend, WhatsApp, Evolution ni billing.

La implementación aplica explícitamente **Austral Design System** (tokens semánticos, superficies light/dark, foco visible, targets táctiles, reduced motion y composición responsive) y **Austral SaaS Architecture** (cero cambios de contratos, aislamiento o persistencia; sólo presentación y derivados visuales de datos ya cargados).

## Decisiones UX

- La cabecera prioriza contexto en tres niveles: vista/fecha, filtros y navegación.
- Se agregó una referencia de hora actual que se actualiza cada 30 segundos y se anuncia como estado accesible.
- Se agregó una leyenda textual y con iconos: turno, pausa y bloqueo. El color acompaña el significado, no lo reemplaza.
- Las tarjetas de turno ahora muestran cliente, servicio, profesional, duración y estado en una jerarquía constante.
- Breaks y bloqueos se representan con tramas e iconografía diferenciadas; nunca se confunden con una reserva.
- El panel del día concentra próximos turnos, métricas rápidas y disponibilidad visual del equipo, sin introducir consultas ni acciones nuevas.
- En mobile la Agenda pasa a una sola columna: controles apilados, calendario legible, panel del día debajo y targets táctiles de 44 px.
- El modal de crear/editar conserva exactamente el flujo existente y ahora usa el primitive `FocusTrap`, `role=dialog`, Escape y retorno de foco.

## Componentes y estilos reutilizados

- `src/components/ui/index.jsx`: `FocusTrap` para el modal existente; se mantienen los primitives del Sprint 1.
- `src/components/Calendar.jsx`: mismas vistas, filtros, navegación, turnos y callbacks; sólo se agregan estados visuales derivados.
- `src/components/TurnoRow.jsx`: mismas acciones de notas, estado, edición y eliminación; nueva jerarquía semántica de la tarjeta.
- `src/components/NewTurnoModal.jsx`: misma validación y submit; nueva capa accesible del primitive de foco.
- `src/components/agenda.css`: estilos locales de Agenda sobre los tokens compartidos, con dark mode, responsive y reduced motion.

## Cambios visuales realizados

- Tarjetas con acento del profesional, metadata con iconografía y badge de estado.
- Leyenda de estados y línea de hora actual.
- Indicadores de días bloqueados y slots de pausa/bloqueo en semana.
- Resumen del día con turnos, profesionales y bloqueo, más chips de equipo trabajando/no disponible.
- Calendario mensual accesible por teclado (`gridcell`, `aria-selected`, etiquetas y acción de nuevo turno).
- Layout mobile sin overflow horizontal; el scroll horizontal queda limitado a la grilla semanal que ya lo requería.
- Modal con foco inicial, Escape, retorno de foco, contraste por tokens y controles táctiles.

## Evidencia visual

Las capturas se guardan en [`docs/ui-sprint3/`](./ui-sprint3/):

- [before-desktop-production.png](./ui-sprint3/before-desktop-production.png) — baseline de la Agenda anterior.
- [after-desktop-dark.png](./ui-sprint3/after-desktop-dark.png) — Agenda rediseñada en desktop/dark.
- [after-mobile-390-light.png](./ui-sprint3/after-mobile-390-light.png) — Agenda rediseñada a 390 px/light.

La evidencia mobile se ejecutó con datos mock aislados (sin Supabase ni escrituras externas): 13 turnos, tres profesionales, fecha sin turnos y filtro de profesional. Se verificó `scrollWidth <= innerWidth`; el único scroll horizontal permitido es el de la semana, dentro de `.week-scroll`.

## Verificación

- `npm.cmd run lint` — OK.
- `npm.cmd test` — OK: todas las verificaciones estáticas de agenda, SaaS, onboarding, billing, comercial y piloto pasan.
- `npm.cmd run build` — OK (Vite).
- `npx.cmd playwright test e2e/public.spec.mjs --workers=1` — OK: 8 escenarios públicos pasan; los escenarios sandbox reales quedan omitidos por sus guards de entorno.
- Playwright manual con servidor mock aislado — OK: desktop 1366, mobile 390, vista mensual/semanal, dark mode, agenda llena/vacía, filtro de un barbero, modal/foco y ausencia de overflow.
- `git diff --check` — OK.

La matriz paralela completa puede producir falsos fallos `spawn EPERM`/carga del servidor en Windows; por eso la evidencia final se tomó con Playwright en un worker estable y el servidor mock local sin credenciales.

## Problemas de la auditoría resueltos

- Densidad móvil de Agenda y falta de jerarquía.
- Leyenda de estados que dependía sólo del color.
- Breaks/bloqueos sin tratamiento visual diferenciado.
- Falta de una indicación actualizada de hora.
- Calendario y acciones sin semántica de teclado suficiente.
- Modal de Agenda sin foco atrapado/retorno garantizado.
- Clipping del layout mensual en 390 px.

## Pendiente para Sprint 4

- Mejoras de operación/edición de horarios fuera de la Agenda.
- Optimización de grandes volúmenes de eventos (paginación o virtualización) si el negocio lo necesita.
- Pruebas autenticadas contra un tenant sandbox controlado para validar datos reales sin escribir en producción.
- Cualquier rediseño de CRM, Landing o Plataforma queda fuera de este sprint.
