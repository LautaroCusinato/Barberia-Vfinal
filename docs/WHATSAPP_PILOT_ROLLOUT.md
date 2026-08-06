# Piloto controlado de WhatsApp multi-tenant

## Alcance y límites

Esta etapa deja preparado un workflow piloto en modo **shadow**. El workflow productivo de Barberia Central no fue editado, desactivado ni ejecutado. No se envían mensajes reales, no se crean turnos y no se realizan cobros.

El modo se controla exclusivamente con la variable privada de n8n `PILOT_MODE`; nunca se acepta desde el payload recibido. La plantilla versionada además falla de forma segura a `shadow` cuando la variable no está disponible. En shadow, la reserva usa `simular_reserva_whatsapp` (validación sin escrituras) y la respuesta se guarda sólo como un reporte minimizado en `saas_automation_shadow_runs` mediante `record_whatsapp_shadow_run`.

## Respaldo y estado de n8n

- Workflow productivo: `Barberia Central - Bot WhatsApp (Evolution + Deepseek)`.
- ID: `gRTZDLTXvGgNq4BZ`.
- Estado verificado: activo/publicado, 31 nodos.
- Respaldo descargado: `C:\Users\lauti\Downloads\Barberia Central - Bot WhatsApp (Evolution + Deepseek) (6).json` (6/8/2026 10:52:43).
- El respaldo no contiene valores de secretos; sólo referencias de credenciales.
- Credenciales existentes en n8n (inventario de nombres, sin exportar secretos): `Google Gemini(PaLM) Api account 3`, `DeepSeek account`, `Google Sheets account 5`, `Supabase account 2`, `Postgres account 2`, `Postgres account`, `Supabase account`.

El template versionado es `integrations/templates/WhatsApp Multi Tenant - Contract Template.json`: permanece `active:false`, tiene 25 nodos y no contiene instancias, tenants ni claves hardcodeadas.

El workflow piloto separado está importado en n8n como `WhatsApp Multi Tenant - Pilot Barberia Central`, ID `5UQMp5vAMfBfJtSy`. Se verificó en la lista de workflows sin etiqueta `Published`; permanece inactivo y no se ejecutó. Tiene 25 nodos, sin instancia hardcodeada y con cuatro expresiones que usan el fallback seguro `PILOT_MODE=shadow`.

## Entorno privado de n8n verificado

La API autenticada de n8n informa:

- despliegue Docker (`isDocker=true`), modo `regular` y base SQLite;
- n8n `2.25.7`, Node `24.15.0`, deployment `default`;
- `variables.limit=0` y `enterprise.variables=false`: la cuenta no puede crear variables privadas desde la interfaz;
- el workflow piloto tiene `active=false`, 25 nodos y `triggerCount=0`; el productivo sigue `active=true`.

La interfaz de n8n no expone el nombre real del contenedor, sus volúmenes, la política de reinicio, la red Docker ni el stack Compose. No se dispone de acceso SSH, Portainer o Docker remoto en esta sesión. Por ese motivo no se exportó configuración, no se modificó el contenedor y no se reinició ningún servicio.

La conectividad pública básica quedó comprobada sin enviar credenciales: Supabase REST responde `401` (endpoint alcanzable y protegido), Evolution responde `200` en su raíz y DeepSeek responde `401` en `/v1/models` (endpoint alcanzable, autenticación pendiente). No se pudo validar la autenticación privada de DeepSeek, Evolution ni Supabase desde n8n sin configurar primero las variables del contenedor.

## Verificación de Evolution y bloqueo de alta automática

Se verificó en Evolution API 2.3.7:

- instancia: `miwsp`;
- estado: conectada;
- número receptor: `5491168280107`;
- etiqueta visible: `Austral Automatizaciones`.

El usuario confirmó que el número corresponde a Barberia Central. La migración idempotente `20260806163000_link_barberia_central_evolution.sql` reemplazó únicamente el placeholder `+5491100000000` de `barberias.whatsapp` por el formato canónico `5491168280107` (sólo dígitos). No se modificaron teléfonos históricos de clientes ni turnos.

La integración quedó creada como `saas_integraciones.id=6`, con `external_instance_id=miwsp`, `receiver_number=5491168280107`, estado `conectado`, base URL de Evolution y referencia opaca `n8n:EVOLUTION_API_KEY`; nunca se guardó la clave. Antes de insertar se verificó que no hubiera otra integración con esa instancia o número. El resolver `resolve_whatsapp_tenant_context` devuelve de forma determinista tenant 1, `Barberia Central`, slug `barberia-central`, locale `es-AR`, zona `America/Argentina/Buenos_Aires` y suscripción `active`. También se probó con espacios, mayúsculas y `+54 9 11 6828-0107`; resolvió la misma integración.

## Migraciones aplicadas

- `20260806160000_whatsapp_shadow_runs.sql`: tabla de comparación con retención de 30 días, RLS y RPCs `record_whatsapp_shadow_run`/`cleanup_whatsapp_shadow_runs`, únicamente para `service_role`.
- `20260806161000_whatsapp_booking_mutations.sql`: RPCs protegidas `consultar_reserva_whatsapp`, `simular_reserva_whatsapp`, `cancelar_reserva_whatsapp` y `reprogramar_reserva_whatsapp`. Derivan el tenant desde la integración, comprueban el estado de la suscripción, normalizan el teléfono y verifican la agenda. Cancelar/reprogramar requieren al menos 2 horas de anticipación, son idempotentes por `integration_id + event_id` y no exponen datos de otros clientes.

Las RPCs nuevas no son ejecutables por `anon` ni `authenticated`; sólo por el rol de automatización `service_role`. La plantilla todavía usa REST directo sólo para catálogos operativos de lectura (`servicios`, `barberos`, `horarios_barbero`, `bloqueos_agenda`); la centralización de ese catálogo en RPCs es una mejora posterior.

## Variables privadas del workflow piloto

Usar `integrations/templates/n8n-multitenant.env.example` como referencia y configurar los valores reales únicamente en n8n:

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY`, `PILOT_MODE=shadow`.

El secreto de webhook debe ser el mismo que Evolution envía en el header configurado. No se debe reutilizar `SUPABASE_SERVICE_ROLE_KEY` como secreto de webhook.

En esta instancia de n8n, la pantalla **Variables** muestra que la función está bloqueada por el plan y **Environments** requiere Enterprise. Por eso no fue posible guardar variables privadas desde la interfaz disponible. Quedan pendientes en el nivel del servidor/contenedor (SSH, Docker o Portainer): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY` y `PILOT_MODE=shadow`. No se solicitaron ni se expusieron secretos en el repositorio o en este chat.

### Procedimiento seguro para el host Docker/Portainer

Cuando se autorice acceso al host, antes de modificar nada se debe registrar el contenedor/stack sin imprimir valores de entorno: imagen y versión, nombre, mounts, `RestartPolicy`, red y estado de los workflows. El backup debe guardarse fuera de Git y con las variables secretas redactadas. El volumen persistente no se elimina ni se recrea.

Las variables se agregan en el Compose/Portainer del servicio n8n, nunca en el repositorio. Deben incluir `PILOT_MODE=shadow`. Después se reinicia sólo n8n (`docker compose up -d --no-deps n8n` o el equivalente del contenedor), se comprueba que el productivo continúe activo y que el piloto siga inactivo, y se conserva el backup para rollback. Evolution, Supabase, Postgres y Redis no deben reiniciarse.

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
| 21 | propuesta shadow registrada | probado con payload anonimizado; fila de prueba eliminada |
| 22 | cancelación/reprogramación | RPC creada; pendiente de ejecución controlada |

Los casos que requieren una integración real no se ejecutaron para no enviar mensajes ni crear datos. La resolución real de `miwsp`/`5491168280107` y la normalización del receptor sí fueron probadas en Supabase. También se comparó el esquema con el workflow productivo: ambos usan `body.data.key.remoteJid` y los campos de texto de Evolution; la plantilla agrega `instance`, `destination`, `event_id` y secreto de webhook. El path del webhook es deliberadamente distinto (`whatsapp-multitenant-template` frente a `whatsapp-miwsp`) para impedir que el piloto intercepte tráfico productivo.

## Comparación, retención y activación

El reporte shadow guarda intent, resultado propuesto, longitud, latencia, hashes/resultados actuales cuando se incorporen, diferencias y metadatos mínimos; no guarda conversaciones completas. `expires_at` es de 30 días y `cleanup_whatsapp_shadow_runs` debe programarse una vez al día. También se debe configurar en n8n una retención de ejecuciones compatible con ese plazo.

Para habilitar live se requiere: confirmar el número/tenant, importar el template como workflow separado e inactivo, configurar variables privadas, revisar al menos 22 casos, obtener tasa de error y latencia aceptables, y aprobar explícitamente el cambio de `PILOT_MODE` a `live`. El workflow productivo no se reemplaza.

Rollback: volver `PILOT_MODE=shadow`, desactivar sólo el workflow piloto, conservar el productivo original y ejecutar la limpieza de reportes cuando corresponda. No se borran turnos ni clientes como parte del rollback.

## Acciones manuales pendientes

1. Configurar en el servidor/contenedor de n8n las variables privadas indicadas, manteniendo `PILOT_MODE=shadow`.
2. Obtener acceso al host Docker/Portainer para realizar backup, inspección de volumen y reinicio controlado; no enviar secretos por chat.
3. Mantener el workflow piloto `5UQMp5vAMfBfJtSy` inactivo y sin publicar; no tocar el productivo `gRTZDLTXvGgNq4BZ`.
4. Cuando exista autorización explícita, configurar un webhook de prueba de Evolution apuntando únicamente al piloto.
5. Ejecutar una única prueba punta a punta con payload anonimizado, repetir el mismo `event_id` para idempotencia y revisar `saas_automation_shadow_runs`; no usar todavía un número de cliente real.
