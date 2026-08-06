# Piloto controlado de WhatsApp multi-tenant

## Alcance y límites

Esta etapa deja preparado un workflow piloto en modo **shadow**. El workflow productivo de Barberia Central no fue editado, desactivado ni ejecutado. No se envían mensajes reales, no se crean turnos y no se realizan cobros.

El modo se controla exclusivamente con la variable privada de n8n `PILOT_MODE=shadow`; nunca se acepta desde el payload recibido. En shadow, la reserva usa `simular_reserva_whatsapp` (validación sin escrituras) y la respuesta se guarda sólo como un reporte minimizado en `saas_automation_shadow_runs` mediante `record_whatsapp_shadow_run`.

## Respaldo y estado de n8n

- Workflow productivo: `Barberia Central - Bot WhatsApp (Evolution + Deepseek)`.
- ID: `gRTZDLTXvGgNq4BZ`.
- Estado verificado: activo/publicado, 31 nodos.
- Respaldo descargado: `C:\Users\lauti\Downloads\Barberia Central - Bot WhatsApp (Evolution + Deepseek) (6).json` (6/8/2026 10:52:43).
- El respaldo no contiene valores de secretos; sólo referencias de credenciales.
- Credenciales existentes en n8n (inventario de nombres, sin exportar secretos): `Google Gemini(PaLM) Api account 3`, `DeepSeek account`, `Google Sheets account 5`, `Supabase account 2`, `Postgres account 2`, `Postgres account`, `Supabase account`.

El template versionado es `integrations/templates/WhatsApp Multi Tenant - Contract Template.json`: permanece `active:false`, tiene 25 nodos y no contiene instancias, tenants ni claves hardcodeadas.

El workflow piloto separado ya fue importado en n8n como `WhatsApp Multi Tenant - Pilot Barberia Central`, ID `5UQMp5vAMfBfJtSy`. Se verificó en la lista de workflows sin etiqueta `Published`; permanece inactivo y no se ejecutó.

## Verificación de Evolution y bloqueo de alta automática

Se verificó en Evolution API 2.3.7:

- instancia: `miwsp`;
- estado: conectada;
- número receptor: `5491168280107`;
- etiqueta visible: `Austral Automatizaciones`.

La base tiene para tenant 1 (`Barberia Central`) el WhatsApp `+5491100000000`. Como los números no coinciden y la etiqueta visible tampoco identifica al negocio, **no se creó ningún registro en `saas_integraciones`**. El alta sólo debe hacerse después de confirmar que esa instancia/número pertenece a Barberia Central o corregir el dato en la base. No se copian tokens ni claves al repositorio.

## Migraciones aplicadas

- `20260806160000_whatsapp_shadow_runs.sql`: tabla de comparación con retención de 30 días, RLS y RPCs `record_whatsapp_shadow_run`/`cleanup_whatsapp_shadow_runs`, únicamente para `service_role`.
- `20260806161000_whatsapp_booking_mutations.sql`: RPCs protegidas `consultar_reserva_whatsapp`, `simular_reserva_whatsapp`, `cancelar_reserva_whatsapp` y `reprogramar_reserva_whatsapp`. Derivan el tenant desde la integración, comprueban el estado de la suscripción, normalizan el teléfono y verifican la agenda. Cancelar/reprogramar requieren al menos 2 horas de anticipación, son idempotentes por `integration_id + event_id` y no exponen datos de otros clientes.

Las RPCs nuevas no son ejecutables por `anon` ni `authenticated`; sólo por el rol de automatización `service_role`. La plantilla todavía usa REST directo sólo para catálogos operativos de lectura (`servicios`, `barberos`, `horarios_barbero`, `bloqueos_agenda`); la centralización de ese catálogo en RPCs es una mejora posterior.

## Variables privadas del workflow piloto

Usar `integrations/templates/n8n-multitenant.env.example` como referencia y configurar los valores reales únicamente en n8n:

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY`, `PILOT_MODE=shadow`.

El secreto de webhook debe ser el mismo que Evolution envía en el header configurado. No se debe reutilizar `SUPABASE_SERVICE_ROLE_KEY` como secreto de webhook.

## Matriz de simulación (22 casos)

| # | Caso | Estado |
|---:|---|---|
| 1 | mensaje de texto simple | validación estática |
| 2 | evento sin `instance` | validación estática |
| 3 | evento sin `event_id` | validación estática |
| 4 | grupo `@g.us` | validación estática |
| 5 | secreto de webhook ausente | validación estática |
| 6 | instancia desconocida | verificado con resolver |
| 7 | integración desconectada | RPC protegida |
| 8 | tenant suspendido/cancelado | RPC protegida |
| 9 | servicio inexistente/inactivo | RPC protegida |
| 10 | barbero inactivo | RPC protegida |
| 11 | barbero sin el servicio | RPC protegida |
| 12 | fecha pasada | regla de agenda existente |
| 13 | horario fuera de jornada | RPC protegida |
| 14 | horario que cruza un break | RPC protegida |
| 15 | bloqueo global | RPC protegida |
| 16 | bloqueo del barbero | RPC protegida |
| 17 | turno solapado | restricción/validación existente |
| 18 | duración específica del barbero | RPC protegida |
| 19 | teléfono con formato variable | normalización en RPC |
| 20 | evento duplicado | idempotencia verificada en dry-run |
| 21 | propuesta shadow registrada | pendiente de payload de piloto |
| 22 | cancelación/reprogramación | RPC creada; pendiente de datos de piloto |

Los casos que requieren una integración real no se ejecutaron para no enviar mensajes ni crear datos. El dry-run anterior de idempotencia confirmó resolver, primer claim, duplicate claim y rollback sin dejar eventos.

## Comparación, retención y activación

El reporte shadow guarda intent, resultado propuesto, longitud, latencia, hashes/resultados actuales cuando se incorporen, diferencias y metadatos mínimos; no guarda conversaciones completas. `expires_at` es de 30 días y `cleanup_whatsapp_shadow_runs` debe programarse una vez al día. También se debe configurar en n8n una retención de ejecuciones compatible con ese plazo.

Para habilitar live se requiere: confirmar el número/tenant, importar el template como workflow separado e inactivo, configurar variables privadas, revisar al menos 22 casos, obtener tasa de error y latencia aceptables, y aprobar explícitamente el cambio de `PILOT_MODE` a `live`. El workflow productivo no se reemplaza.

Rollback: volver `PILOT_MODE=shadow`, desactivar sólo el workflow piloto, conservar el productivo original y ejecutar la limpieza de reportes cuando corresponda. No se borran turnos ni clientes como parte del rollback.

## Acciones manuales pendientes

1. Confirmar a qué negocio corresponde el número `5491168280107` o corregir el WhatsApp de Barberia Central.
2. Crear/importar en n8n un workflow separado llamado `WhatsApp Multi Tenant - Pilot Barberia Central`, mantenerlo inactivo y cargar las variables privadas.
3. Configurar el webhook de Evolution apuntando únicamente al workflow piloto cuando se autorice una prueba controlada.
4. Ejecutar simulaciones con un payload capturado de prueba y revisar los reportes; no usar todavía un número de cliente real.
