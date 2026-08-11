# Mobile Real-Device Polish

## Alcance

Este sprint aplica Austral Design System y Austral SaaS Architecture únicamente a la capa visual móvil. No modifica reglas de negocio, consultas, contratos, Supabase, RLS, RPC, billing, WhatsApp, n8n ni Evolution.

La referencia visual disponible en el repositorio fue la evidencia móvil existente. No se adjuntaron nuevas capturas del Samsung/Chrome en esta ejecución, por lo que no se presenta una simulación como si fuera una captura de dispositivo real.

## Cambios realizados

### Agenda

- En pantallas de hasta 520 px la vista mensual deja de comprimir la grilla desktop de siete columnas.
- Se muestra una grilla móvil de tarjetas de día en dos columnas, con día de semana, número legible, estado seleccionado/hoy/bloqueado, cantidad de turnos, indicadores por profesional y acción `+` táctil.
- La selección de día, teclado, `aria-label` y acción de crear turno conservan los callbacks existentes.
- La vista desktop y la vista semanal no cambian.
- Anterior/Hoy/Siguiente mantienen un mínimo táctil de 44 px en móvil.

### Clientes

- Se agrega una representación móvil vertical: identidad, teléfono accionable, última visita, próximo turno, notas y acciones.
- Las fechas ISO se presentan como `DD/MM/YYYY` únicamente en la interfaz. El valor almacenado no se transforma.
- La tabla original queda reservada para desktop, sin duplicar datos ni modificar operaciones.

### Chat y mensajes

- Las burbujas móviles tienen ancho máximo, padding e interlineado controlados para evitar bloques gigantes.
- Los previews eliminan la sintaxis Markdown visible.
- `SafeMarkdown` admite solamente párrafos, listas simples y negrita. React escapa el contenido; no se usa `dangerouslySetInnerHTML` ni se permite HTML arbitrario.
- El listado móvil deja de reservar una altura excesiva con pocas conversaciones y el hilo respeta la altura visible del dispositivo (`100dvh`).

### Shell móvil

- Se reutilizan las variables de safe-area y el padding inferior ya definido por el Design System para que la bottom navigation no cubra el contenido.
- Los nuevos controles y acciones mantienen objetivos táctiles de al menos 44 px.
- Los estados de foco y `prefers-reduced-motion` se mantienen en las nuevas superficies.

## Evidencia visual

La evidencia previa disponible se conserva en:

- [Agenda móvil 390 px (baseline)](ui-sprint3/after-mobile-390-light.png)
- [Clientes móvil (baseline)](ui-sprint4/after-pacientes-mobile-light.png)
- [Shell móvil dark (baseline)](authenticated-qa/owner-a-dashboard-390-dark.png)

Las capturas posteriores autenticadas se generaron con el fixture QA autorizado (Chromium emulando 390×844) y no contra producción:

- [Agenda light](ui-mobile-real-device-polish/after-agenda-390-light.png)
- [Agenda dark](ui-mobile-real-device-polish/after-agenda-390-dark.png)
- [Clientes dark](ui-mobile-real-device-polish/after-clientes-390-dark.png)
- [Chat dark](ui-mobile-real-device-polish/after-chat-390-dark.png)

Son evidencia de viewport automatizado, no una captura de hardware Samsung. La comparación final en Samsung/Chrome físico queda como verificación manual recomendada.

## Verificación

Se prepararon comprobaciones estáticas para las superficies nuevas (`scripts/verify-mobile-polish.mjs`) y se ejecutan con `npm test`. Playwright público pasó en 360×800, 390×844, 412×915, 430×932, tablet 768, desktop 1366 y desktop 1920 (56 escenarios públicos, incluyendo light/dark de reserva mock y chequeos de overflow). Luego de sembrar/reutilizar de forma idempotente los fixtures QA permitidos, los 144 escenarios autenticados pasaron en chromium, mobile 390, mobile 360, tablet 768, desktop 1366 y desktop 1920. No se contactó producción.

La primera ejecución paralela mostró tres timeouts de arranque únicamente en iPhone 390. Al repetir con un worker, los 8 escenarios de ese proyecto pasaron; la matriz serializada quedó estable. Es una flakiness del arranque concurrente local, no un fallo de UI reproducible.

La primera ejecución autenticada se detuvo al detectar que faltaba el usuario QA `unassigned`; el seed versionado (`npm run e2e:qa:fixtures -- --execute`) lo creó con los guards del proyecto QA y la segunda ejecución quedó 144/144.

## Pendientes

- Capturar before/after en Samsung/Chrome real con una sesión QA autorizada.
- Ejecutar el recorrido autenticado completo en los cuatro anchos y registrar cualquier diferencia específica del navegador del dispositivo.
