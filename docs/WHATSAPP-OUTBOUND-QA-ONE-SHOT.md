# WhatsApp outbound QA one-shot

Aplica Austral SaaS Architecture: el primer envío real está aislado al
tenant QA `E2E_QA_BARBERIA_A`, a la instancia `austral-qa-tenant-1` y al
entorno `qa`. No habilita respuestas automáticas generales, reservas,
clientes, agenda, billing ni producción.

## Estado por defecto

La función `whatsapp-qa-outbound-one-shot` permanece fail-closed mientras no
se configuren simultáneamente:

- `WHATSAPP_PROVISIONING_ENV=qa`;
- `WHATSAPP_MODE=shadow`;
- `PILOT_MODE=shadow`;
- `WHATSAPP_OUTBOUND_PILOT_ENABLED=1`;
- `WHATSAPP_OUTBOUND_PILOT_APPROVAL` (secreto de una sola autorización);
- `WHATSAPP_OUTBOUND_QA_RECIPIENT` (sólo configuración privada);
- `WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH` (hash `sha256:<12 hex>` del `remoteJid` del evento autorizado).

Los últimos cuatro valores no se versionan ni se exponen al frontend. En esta
etapa el flag y la aprobación permanecen deshabilitados; por lo tanto no se
envió ningún mensaje.

## Contrato de envío

La ruta acepta únicamente `POST` autenticado con un body que contenga
`source_event_id`. Rechaza `to`, `recipient`, `text` y `message`; el número se
deriva de la configuración privada y sólo se admite si el hash coincide con el
sender del shadow run autorizado.

Antes del envío se comprueban tenant, integración, instancia, estado
`CONNECTED`, entorno, modo shadow, `fromMe=false`, `mutation_allowed=false` y
`outbound_allowed=false`. La operación se reclama mediante
`claim_whatsapp_event` con una clave determinística `qa-outbound:<event_id>`;
una repetición no vuelve a llamar al proveedor. Los errores posteriores a la
reclamación quedan sin retry automático para evitar duplicados.

El texto de la primera prueba es fijo y no proviene de IA:

`Prueba QA de Austral: respuesta enviada correctamente.`

La integración usa el contrato oficial de Evolution API 2.x:

`POST /message/sendText/{instance}`

con `number` y `textMessage.text`, y la API key sólo server-side.

Los eventos `fromMe=true` continúan siendo ignorados por el webhook shadow,
evitando loops.

## Autorización manual pendiente

No ejecutar la función hasta contar con una autorización separada para una
única salida. Antes de esa autorización debe verificarse que la instancia QA
sigue abierta, `miwsp` permanece intacta, el destinatario coincide con el
evento autorizado y no hay rutas de mutación habilitadas.
