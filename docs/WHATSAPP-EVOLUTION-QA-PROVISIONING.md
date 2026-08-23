# WhatsApp Evolution QA provisioning

Estado: adaptador real preparado y desplegado únicamente en Supabase QA. No se
creó todavía ninguna instancia real porque faltan tres secretos en la Edge
Function QA; la instancia productiva `miwsp` permanece intacta.

## Precheck de infraestructura

- Host SSH: `server`.
- Compose: `/home/lautaro/mati-bot/`.
- Evolution API: 2.3.7, contenedor `evolution_api`, saludable.
- URL pública comprobada: `https://evolution.cuchitron.lat` (HTTPS/TLS válido,
  HTTP 200).
- PostgreSQL y Redis del stack están activos; n8n está healthy.
- Instancia existente `miwsp`: `open`.
- Webhook de `miwsp`: se leyó sin modificar; continúa apuntando a n8n y no se
  reutiliza para QA.

La ruta pública HTTPS es necesaria porque una Edge Function no puede depender de
la red Docker privada. El adaptador rechaza cualquier URL que no sea HTTPS o
que no coincida con `evolution.cuchitron.lat`.

## Aislamiento

La Edge Function `whatsapp-provision` mantiene los guards de proyecto QA
(`cmsymmszlzikqpvfqjre`), modo `shadow`, entorno `qa`, fixture `E2E_QA_` y
roles `owner/admin`. El navegador no elige adaptador, instancia, entorno ni
credenciales. `miwsp` es un nombre protegido: cualquier intento de usarlo
falla cerrado.

Los nombres reales son estables y sólo server-side: `austral-qa-tenant-<id>`.
Antes de crear, el adaptador lista Evolution y reconcilia una instancia con ese
nombre. Nunca llama endpoints de mensajes, reservas, clientes, n8n ni billing.

## Webhook QA

`whatsapp-evolution-webhook` está desplegado sin JWT (Evolution no envía una
sesión Supabase) y acepta únicamente el header `X-Austral-Webhook-Secret`.
Sólo procesa `QRCODE_UPDATED` y `CONNECTION_UPDATE`; otros eventos se ignoran.
El estado se vincula por `instance_name` a una fila QA ya existente y responde
con información sanitizada. La versión 2.3.7 no ofrece una firma HMAC saliente
nativa verificable; el header secreto sobre HTTPS es la defensa soportada para
este piloto, y no se reutiliza la API key.

## Configuración pendiente en QA

En Supabase Dashboard → Project `Austral SaaS QA` → Edge Functions → Secrets,
cargar desde el gestor privado del servidor, sin pegarlos en el chat:

- `EVOLUTION_BASE_URL` (debe ser `https://evolution.cuchitron.lat`);
- `EVOLUTION_API_KEY` (API key privada de Evolution);
- `EVOLUTION_WEBHOOK_SECRET` (secreto dedicado del webhook, distinto de la API
  key);
- `WHATSAPP_PROVISIONING_ADAPTER=evolution`.

Los tres valores privados ya existen en `/home/lautaro/mati-bot/.env`; no se
copian al frontend, Git, logs ni respuestas. Hasta que estén cargados, el
adaptador remoto permanece inactivo y la función conserva el modo mock.

Cuando las cuatro variables estén presentes, la única acción autorizada es
conectar `E2E_QA_BARBERIA_A`: se crea o reconcilia una instancia QA, se
configura el webhook con los dos eventos mínimos y se devuelve un QR temporal
en `Configuración → WhatsApp`. No escanearlo todavía. `miwsp`, otros tenants y
los workflows legacy no se modifican.

## Evidencia y rollback

El deployment QA de ambas funciones fue exitoso. Las pruebas estáticas y de
contrato existentes pasan; no hubo llamadas de proveedor, mensajes, reservas ni
mutaciones productivas. Si una creación QA fuese autorizada y fallara, se
conserva la fila auditada y se usa la acción de desconexión del adaptador; nunca
se ejecuta `delete` sobre `miwsp`.

