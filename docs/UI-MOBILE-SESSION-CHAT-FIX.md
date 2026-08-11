# Mobile session + chat fix

## Alcance

Este cambio aplica Austral Design System y Austral SaaS Architecture sólo a la experiencia frontend de chat y selección de workspace. No modifica Supabase, RLS, RPC, billing, reservas, WhatsApp, n8n, Evolution, contratos ni permisos.

## Chat: causa y solución

La causa del salto al inicio era un efecto que sobrescribía `scrollTop` en cada cambio de conversación o cantidad de mensajes sin distinguir entre una conversación nueva, un mensaje entrante y una persona que había leído mensajes anteriores.

Ahora el hilo:

- llega al mensaje más reciente al abrir o cambiar de conversación;
- sigue mensajes nuevos mientras la persona está cerca del final;
- conserva la posición si la persona se desplazó hacia arriba;
- muestra `Nuevos mensajes` como acción táctil cuando corresponde;
- vuelve al final al enviar un mensaje propio;
- recalcula el final ante cambios de viewport/teclado sin timers arbitrarios;
- conserva `SafeMarkdown`, que sólo renderiza contenido permitido y nunca HTML arbitrario;
- mantiene padding inferior y `scroll-padding` para safe-area y bottom navigation.

La decisión de seguimiento se concentra en `src/lib/chatScroll.js`, lo que permite probar el comportamiento sin duplicar la lógica del componente.

## Workspace: causa y solución

La selección anterior sólo guardaba el tenant en `sessionStorage` y nunca persistía el tipo de workspace. Además, la resolución de membresías reseteaba el estado a `null` antes de restaurar una selección, generando pérdida al cambiar de pestaña o recargar.

Se agregó una preferencia no sensible en `localStorage` (`austral-selected-workspace`) con únicamente:

- `type: platform`, o
- `type: business` y `tenantId`.

La preferencia no es una fuente de autenticación. En cada bootstrap de sesión se consulta nuevamente Auth y las membresías actuales; sólo se restaura una selección si la membresía correspondiente existe. Las preferencias inválidas o sin acceso se eliminan y se muestra el flujo normal de selección. El logout y la expiración de sesión limpian la preferencia.

La selección manual actualiza la preferencia y la ruta `/plataforma` conserva prioridad explícita para miembros de plataforma.

## Verificaciones

- `scripts/verify-mobile-session-chat-fix.mjs` cubre el contrato de persistencia, invalidación, umbral de scroll, seguimiento de mensajes propios y protección de `SafeMarkdown`.
- Se mantienen las pruebas públicas y autenticadas QA existentes; no se modificaron datos productivos.
- Viewports objetivo: 360×800, 390×844, 412×915 y desktop.
- Se mantienen light/dark, focus visible, reduced motion y safe-area mediante los tokens existentes.

## Pendientes

- Ejecutar la matriz Playwright completa y los recorridos QA autenticados después de integrar el cambio.
- Capturar evidencia before/after del chat y del selector en un dispositivo Samsung/Chrome real.
