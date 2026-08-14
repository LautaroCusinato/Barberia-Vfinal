# WhatsApp Reply-only Pilot

Aplica **Austral SaaS Architecture**: el tenant se deriva server-side, la allowlist no acepta wildcard, el flujo es fail-closed, la idempotencia usa la clave existente `integration_id + event_id`, y no se agregan atajos de RLS/RPC. Aplica **Austral Design System** sólo a la eventual superficie operativa; este cambio no modifica el panel.

## Estado

| Estado | Significado |
| --- | --- |
| **OFFLINE VALIDATED** | Guards, contrato de IA, adapter mock, loop protection, rate-limit y template pasan verificaciones locales sin tráfico externo. |
| **QA DATABASE VALIDATED** | La migración Reply Only se aplicó exclusivamente en QA; RLS, grants, RPCs, identidad estricta, exactly-one y rate limit persistente pasan pruebas transaccionales con rollback. |
| **SERVER PRECHECK PENDING** | Falta verificar n8n/Evolution, `miwsp`, backups, secrets, webhook y workflows en el host. SSH no está disponible. |
| **REAL MESSAGE PENDING** | Requiere autorización explícita para enviar un único mensaje desde un número controlado. |
| **REPLY_ONLY VALIDATED** | No declarado. Sólo después del precheck, activación controlada y prueba real aprobada. |

No se activó `reply_only`, no se habilitó `booking_enabled`, no se modificó el legacy, no se contactó Evolution y no se tocó producción.

## Arquitectura

`Evolution → webhook autenticado → n8n reply-only separado → resolver server-side → lecturas de disponibilidad → respuesta segura → adapter Evolution`.

El workflow versionado es `integrations/templates/Austral WhatsApp Reply Only Pilot.json`. Está `active:false`, usa un trigger manual, un mock determinista de IA y un adapter mock. No contiene secretos, credenciales, webhook público ni operación externa. El workflow shadow y el legacy no se editan.

### Allowlist

La migración `20260813120000_whatsapp_reply_only_pilot.sql` crea `saas_whatsapp_reply_only_allowlist` y un índice parcial que permite como máximo una fila `enabled=true`. Cada fila exige `tenant_id`, `integration_id`, instancia, receptor canónico y `mode='reply_only'`. La RPC sólo resuelve cuando coinciden simultáneamente integración, instancia y receptor con `saas_integraciones` conectada y con el mismo tenant. Nunca se usa `tenant_id` del payload.

Antes de habilitar debe existir exactamente una fila activa. No se puede seleccionar wildcard, y el tenant piloto debe ser autorizado manualmente después del precheck; no se fija Barbería Central ni Barbería Nueva automáticamente.

### Auth e idempotencia

Se reutiliza el contrato `X-Austral-Webhook-Secret` de `scripts/whatsapp-webhook-auth.mjs`: comparación constante, 401 ante ausencia/error y validación antes de resolver tenant, IA o Supabase. El mismo `integration_id + event_id` se reclama con `claim_whatsapp_event`; un duplicado no llama IA, disponibilidad ni adapter.

### Mutation firewall

`scripts/whatsapp-reply-only-core.mjs` bloquea determinísticamente creación/edición/cancelación/eliminación de turnos, cambios de clientes, billing y RPC mutantes. `booking_enabled` nunca es un modo permitido en este piloto. El prompt de IA no es una frontera de seguridad.

Cuando el usuario dice “quiero reservar”, la respuesta sólo ofrece consultar disponibilidad y el link público seguro `https://barberia.cuchitron.lat/reservar/<slug>`. No se afirma que se creó un turno.

### IA y respuestas

La IA puede clasificar saludo, servicios, precio, horarios, profesionales, disponibilidad, información/FAQ, pedido de reserva, handoff y media no soportada. Devuelve `intent`, `confidence`, `arguments` y `needs_clarification`; nunca es autoridad de precios, servicios, empleados, disponibilidad, permisos o tenant. Esos datos deben provenir de la fuente backend existente.

La respuesta se valida antes del adapter: no vacía, no JSON crudo, sin secretos/stack traces y hasta 1000 caracteres. JSON inválido, timeout de IA o timeout de Supabase producen fallback seguro y no mutación.

### Loop protection

Eventos `fromMe`, `from_me`, `key.fromMe` o equivalentes se ignoran. Esto evita el ciclo `bot → Evolution → evento propio → bot`. Hay una prueba específica para un evento saliente generado por la propia respuesta.

### Rate limit

La migración agrega `saas_whatsapp_reply_only_rate_limits`, con autoridad en PostgreSQL (no memoria local): 10 mensajes por combinación integración/remitente durante 60 segundos. El remitente se guarda como hash `sha256:<12 hex>`, nunca como teléfono completo. Se limita el burst, se registra `rate_limited` y se responde de forma segura; la ventana es configurable dentro de límites acotados por la RPC.

### Handoff y media

“Quiero hablar con una persona”, “encargado”, “reclamo” o “humano” produce `handoff_requested`, una respuesta de derivación y detiene la resolución automática de esa interacción. Audio, imagen, sticker, documento, ubicación y mensajes vacíos reciben el fallback de texto; no se descarga ni procesa media en esta fase.

### Observabilidad

Eventos sanitizados previstos: `webhook_received`, `auth_failed`, `from_me_ignored`, `tenant_resolved`, `tenant_resolution_failed`, `duplicate_event`, `rate_limited`, `ai_success`, `ai_failure`, `availability_success`, `availability_failure`, `reply_prepared`, `reply_sent`, `reply_failed`, `mutation_blocked`, `handoff_requested`. No se guardan secrets, tokens, payload completo, chat completo ni teléfono sin necesidad.

## Pruebas offline

`npm run whatsapp:reply-only:offline` cubre:

- allowlist exacta, sin wildcard e identidad cruzada;
- modos shadow/reply-only/booking-enabled y kill switch;
- firewall para todas las mutaciones;
- contrato de IA y JSON inválido;
- saludo, disponibilidad, reserva solicitada y link Tenant A/B;
- respuestas vacías, JSON, secretos y stack traces;
- media/empty fallback;
- handoff;
- rate limit;
- fromMe y loop;
- adapter mock con cero requests reales;
- observabilidad sin PII sensible;
- template n8n inactivo y migración aditiva.

## Activación futura (requiere servidor y autorización)

1. Precheck read-only: Docker, n8n, Evolution, PostgreSQL, Redis, `miwsp`, health, backups, legacy activo y shadow inactivo.
2. Backup/config snapshot de n8n; verificar que `WHATSAPP_MODE` y `PILOT_MODE` no se cambien globalmente sin rollback.
3. Aplicar la migración sólo en QA primero; revisar RLS, grants, índices y RPC.
4. Crear en n8n una Credential privada que apunte exclusivamente a Supabase QA; nunca incluir la service role en el JSON.
5. Importar el template como workflow `E2E_QA_...`, `active=false`; configurar la allowlist para un único tenant QA y ejecutar fixtures.
6. Ejecutar negativos: header ausente/incorrecto, identidad cruzada, tenant no allowlisted, duplicado, fromMe, modo inválido, rate limit, timeout y RPC mutable.
7. Crear workflow separado `Austral WhatsApp Reply Only Pilot`, `active=false`, sin tocar legacy ni shadow.
8. Sólo con todos los checks verdes, habilitar el kill switch `REPLY_ONLY_KILL_SWITCH=enabled` y activar ese workflow; registrar timestamp y responsable.
9. La primera prueba real requiere autorización explícita del propietario para enviar desde un número controlado. Enviar “Hola”, verificar una respuesta, luego precio/disponibilidad y finalmente “Quiero reservar”. Confirmar siempre 0 reservas y 0 clientes modificados.

## Rollback

Desactivar inmediatamente el workflow reply-only y poner `REPLY_ONLY_KILL_SWITCH=disabled` (o `WHATSAPP_MODE=shadow`/`PILOT_MODE=shadow` según el runbook), sin reiniciar Evolution ni tocar el legacy. Conservar logs, deshabilitar la única fila de allowlist y revisar `reply_sent`, `mutation_blocked`, `duplicate_event`, `from_me_ignored` y `rate_limited`. Si aparece loop, cross-tenant, mutación o spam, el rollback es obligatorio y no se reintenta hasta revisar evidencia.
