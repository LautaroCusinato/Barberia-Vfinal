# Sprint 2 — Rediseño de reserva pública

Fecha: 2026-08-09  
Alcance: únicamente `/reservar/:slug`  
Bases aplicadas: [UI-UX-AUDITORIA](./UI-UX-AUDITORIA.md) y [UI-SPRINT1](./UI-SPRINT1.md)

## Límites respetados

No se modificaron RPCs, disponibilidad, horarios, breaks, RLS, resolución de tenant, backend, Supabase, billing, Mercado Pago, Edge Functions, WhatsApp, n8n, Evolution, Agenda, CRM, Landing ni Plataforma. Las llamadas existentes mantienen exactamente sus nombres, parámetros y secuencia de confirmación.

## Problemas resueltos

- La reserva dejó de ser una página sin orientación y ahora muestra progreso visible: Servicio → Profesional → Fecha y hora → Tus datos → Confirmación.
- Se agregó un resumen persistente con servicio, profesional, fecha, hora, duración, importe y código de moneda; en desktop queda sticky y en mobile se apila sin tapar contenido.
- Los servicios ahora exponen descripción, duración, importe con moneda y estado seleccionado mediante `aria-pressed` y no sólo color.
- Los profesionales tienen avatar/fallback con iniciales, nombre y contexto del servicio, sin inventar especialidades.
- Fecha, zona horaria, rango desde hoy y estado de disponibilidad tienen jerarquía explícita.
- Los horarios tienen targets táctiles de 48–50 px, estados hover/focus/selected y feedback live cuando una reconsulta elimina el horario elegido.
- El formulario usa `FormField`, `Input`, `PhoneField` y mensajes asociados con `aria-describedby`, `aria-invalid` y `role=alert`.
- El teléfono conserva exactamente el `PhoneField` existente y la validación canónica de 13 dígitos normalizados.
- Antes de confirmar se muestra un resumen final con negocio, servicio, profesional, fecha, hora, duración, moneda, nombre y teléfono.
- Los errores RPC se sanitizan en mensajes accionables; no se muestran cuerpos técnicos ni códigos internos.
- Se agregaron estados de negocio no disponible, sin servicios, sin profesionales, sin horarios, carga, error y confirmación exitosa.
- El loading inicial usa skeletons estables y spinner, evitando el layout shift del texto único “Cargando…”.
- Dark mode conserva contraste, selected states, inputs, errores, CTA y confirmación.
- El color de marca se valida como hex y se calcula un color de texto contrastante para CTA, stepper y estados seleccionados.
- Los precios nunca se muestran sólo con `$`: se usa el código de moneda provisto por el catálogo (con fallback ARS para catálogos legacy que no lo exponen).

## Componentes reutilizados

Desde el Design System del Sprint 1 se reutilizaron `Card`, `Button`, `IconButton`, `Input`, `PhoneField`, `FormField`, `Badge`, `StatusBadge`, `EmptyState`, `Skeleton`, `Spinner` y `LiveRegion`.

La nueva primitive `LiveRegion` se agregó a `src/components/ui` para anuncios polite/assertive consistentes. No se duplicó lógica de teléfono ni se introdujo una nueva capa de datos.

## Evidencia visual

- [before-desktop-1366.png](./ui-sprint2/before-desktop-1366.png)
- [before-mobile-390-dark.png](./ui-sprint2/before-mobile-390-dark.png)
- [after-desktop-1366.png](./ui-sprint2/after-desktop-1366.png)
- [after-mobile-390-dark.png](./ui-sprint2/after-mobile-390-dark.png)

La comparación muestra el salto de una columna larga a una composición con resumen, progreso, cards de selección y estados claramente agrupados.

## Pruebas ejecutadas

- `npm.cmd run lint` — OK.
- `npm.cmd test` — OK; verificaciones de agenda, SaaS, onboarding, billing, serverless, comercial, CRM y piloto pasan.
- `npm.cmd run build` — OK; Vite transformó 2694 módulos sin errores.
- `npm.cmd run test:e2e` — OK: 48 pruebas públicas/mocks pasaron en Chromium, mobile 390/360, tablet 768 y desktop 1366/1920; 144 escenarios sandbox reales se omitieron por sus guards de entorno.
- Prueba mock específica de reserva guiada — OK: selección, cambio de servicio, profesional, horario, teléfono inválido, dark mode y confirmación sin efectos externos.
- Prueba mock de disponibilidad/conflicto — OK: día sin profesionales y slot ocupado durante confirmación.
- Navegador local — sin errores de consola de runtime; overflow horizontal igual a cero en la superficie inspeccionada.

Los escenarios E2E que requieren `E2E_REAL_SUPABASE` permanecen omitidos por diseño para no tocar producción ni crear datos reales.

## Diferencias responsive

- Desktop: dos columnas, resumen sticky y selección de servicios en grid.
- Tablet: una composición fluida sin forzar columnas estrechas.
- Mobile: resumen arriba, contenido apilado, stepper compacto, tarjetas de una columna y horarios en targets grandes.
- 360 px: etiquetas cortas del stepper y horarios en dos columnas para mantener legibilidad.

## Riesgos y pendientes

- El RPC público existente no incluye `moneda` en su migración versionada; la UI consume `barberia.moneda` cuando el despliegue ya lo devuelve y usa ARS como fallback compatible. Para soportar USD/u otra moneda en tenants legacy sin fallback, habría que coordinar una ampliación aditiva del contrato en otra etapa, no incluida aquí por la restricción de no modificar RPC.
- La validación real de contraste de colores configurados por el tenant se limita a colores hex; colores no hex se reemplazan por el acento seguro por defecto.
- La prueba de confirmación real contra Supabase continúa reservada al entorno sandbox aprobado; esta entrega sólo usa mocks para el flujo exitoso y de conflicto.

Sprint 3 (Agenda) no fue iniciado.
