# WhatsApp Reply Only — QA validation

Fecha de ejecución: 2026-08-14

Esta validación se ejecutó exclusivamente contra el proyecto Supabase QA
`cmsymmszlzikqpvfqjre`. El proyecto productivo `ssagttjdgtypxjcgdnrw` fue
rechazado por guard y no fue contactado. No se utilizaron secretos, números
reales, Evolution productivo ni webhooks públicos.

## Preflight y migración

- Conexión QA: validada previamente con Session Pooler, TLS y hostname verification.
- Base: `postgres`.
- Migración aplicada únicamente en QA: `20260813120000_whatsapp_reply_only_pilot.sql`.
- No se ejecutó la cola completa de migraciones.
- Snapshot lógico previo: tenants E2E A/B, 4 turnos, 2 clientes y contadores de billing sin cambios.
- La migración es aditiva y reversible por migración posterior; no modifica reservas, clientes ni billing.

## Controles de base de datos

| Control | Resultado |
| --- | --- |
| RLS en allowlist y rate limits | PASS |
| Grants públicos/tenant | PASS — no hay acceso indebido |
| Funciones SECURITY DEFINER | PASS |
| `search_path = public, pg_temp` | PASS |
| Ejecución de RPC por `service_role` | PASS |
| Ejecución anónima/authenticated | PASS — denegada |
| Identidad estricta instancia + receptor + integración | PASS |
| Protección exactly-one active pilot | PASS |
| Rate limit persistente | PASS |
| Índices y constraints | PASS |

La prueba transaccional dejó cero filas activas en la allowlist y cero filas
de rate limit creadas por la prueba. Las dos integraciones E2E existentes
permanecen desactivadas.

## Fixtures A–J

Se ejecutó `npm run whatsapp:reply-only:offline` (32 escenarios) y se
contrastó con las pruebas transaccionales sobre QA:

| Fixture | Resultado |
| --- | --- |
| A. Saludo | PASS — respuesta segura propuesta |
| B. Precios | PASS — contrato sólo informativo |
| C. Horarios | PASS — sin mutación |
| D. Servicios | PASS — datos tenant-scoped |
| E. Pedido de turno | PASS — booking intent, link público, 0 reservas |
| F. Cancelación | PASS — informativo, 0 cancelaciones |
| G. Prompt injection | PASS — mutation firewall |
| H. Tenant inexistente | PASS — fail closed |
| I. Secret incorrecto/ausente | PASS — rechazo 401 |
| J. Evento duplicado | PASS — idempotencia |

También se verificaron identidad cruzada, instancia/receptor incorrectos,
integración desconocida o inactiva y tenant no allowlisted; todos fallan
cerrado.

## Rate limit y mutation firewall

- 10 mensajes por ventana de 60 segundos por integración + remitente: PASS.
- Mensaje 11: bloqueado.
- Remitente B e integración B: ventanas independientes.
- Expedición de ventana: PASS.
- Snapshots antes/después: 4 turnos, 2 clientes, 0 eventos billing y 0
  suscripciones antes y después.
- Reservas creadas/editadas/canceladas: 0.
- Clientes creados/modificados: 0.
- Mutaciones de billing/subscriptions: 0.

## Shadow/offline regression

`npm run whatsapp:shadow:offline` pasó con tenant QA A, intención de
disponibilidad, respuesta propuesta, evento duplicado, identidad cruzada,
modo inválido y `mutation_blocked=true`; mensajes enviados y mutaciones: 0.

## Limpieza

La ejecución usó una transacción y rollback completo para los datos técnicos
temporales. Estado final de la allowlist activa: 0. No se eliminaron fixtures
QA base. No se activó ningún workflow ni endpoint público.

## Estado pendiente

Esta evidencia cubre la base QA y los harnesses offline. La declaración
`WHATSAPP REPLY_ONLY SERVER READY / ACTIVATION PENDING` requiere además el
precheck read-only final del host (n8n/Evolution/workflows), la regresión
Playwright pública y autenticada, lint, tests, build, diff-check y secret scan.
Hasta completar esos checks se mantienen:

- `REPLY_ONLY_KILL_SWITCH=disabled`;
- `WHATSAPP_MODE=shadow`;
- `PILOT_MODE=shadow`;
- workflow Reply Only inactivo;
- workflow shadow inactivo;
- workflow legacy intacto y activo;
- cero mensajes y cero reservas reales.

## Regresión ejecutada

- `npm run lint`: PASS.
- `npm test`: PASS.
- `npm run build`: PASS.
- `npm run whatsapp:reply-only:offline`: PASS.
- `npm run whatsapp:shadow:offline`: PASS.
- Playwright público Chromium: 9/9 PASS (los escenarios QA permanecen omitidos en ese modo).
- Playwright autenticado QA: 192/192 PASS en Chromium, mobile 390/360/412/430,
  tablet 768 y desktop 1366/1920.
- `git diff --check`: PASS.
- Secret scan: PASS.

El precheck SSH read-only del host no pudo completarse en esta ejecución:
`servidor-barberia` respondió timeout en el puerto 22. Por ese motivo no se
declaran como verificadas desde esta máquina las condiciones runtime de n8n,
Evolution y los tres workflows; deben confirmarse cuando el host vuelva a ser
accesible.
