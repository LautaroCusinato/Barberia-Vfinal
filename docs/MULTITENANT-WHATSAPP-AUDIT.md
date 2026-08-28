# Auditoría multitenant de WhatsApp

Fecha: 2026-08-21

Esta auditoría aplica Austral SaaS Architecture para la frontera de tenant,
roles, RLS, secretos y workflows. Las superficies nuevas de configuración se
deben implementar con Austral Design System; no se reutilizan términos técnicos
de Evolution/n8n en la interfaz comercial.

## Alcance y guardas

- Supabase auditado: proyecto QA `cmsymmszlzikqpvfqjre`.
- Supabase producción `ssagttjdgtypxjcgdnrw`: no contactado ni modificado.
- Mercado Pago: pausado; no se crearon planes, checkouts, suscripciones,
  pagos ni cargos.
- Host auditado por SSH en modo read-only: `servidor-barberia`.
- No se reiniciaron contenedores ni se editaron workflows, webhooks o
  variables privadas.

## Estado de QA

El proyecto QA contiene únicamente dos tenants ficticios identificables con el
prefijo obligatorio `E2E_QA_`:

| Tenant | ID QA | Membresías observadas | Integración WhatsApp |
| --- | ---: | --- | --- |
| `E2E_QA_BARBERIA_A` | 1 | owner, admin, recepcionista, empleado, readonly | mock, desactivada |
| `E2E_QA_BARBERIA_B` | 2 | owner | mock, desactivada |

Las integraciones QA usan `e2e-qa.invalid`, `external_provider=false`, modo
shadow y números ficticios. No representan instancias Evolution reales.
La tabla de eventos y los shadow runs existentes están asociados al tenant 1,
con metadata `E2E_QA_`, `mode=shadow` y `mutation_blocked=true`.

## Modelo actual y hallazgos

- `saas_integraciones` ya tiene `integration_type`, `external_instance_id`,
  `receiver_number`, locale, timezone, proveedor de IA y límites.
- Hay índices únicos por instancia y receptor, y el resolver
  `resolve_whatsapp_tenant_context` exige una integración Evolution conectada.
  Una identidad desconocida no devuelve tenant; una identidad duplicada falla
  cerrado.
- `saas_automation_events` garantiza idempotencia por
  `integration_id + event_id` y sólo es accesible por `service_role`.
- `saas_automation_shadow_runs` mantiene reportes minimizados y sin
  conversaciones completas; también es `service_role` only.
- Las RPC de automatización y reserva derivan el tenant desde la integración,
  validan agenda y no son ejecutables por `anon`/`authenticated`.
- La RLS existente permite que un owner escriba directamente en
  `saas_integraciones`; no existe todavía una frontera única server-side para
  owner/admin que cree una instancia, configure webhook, devuelva QR o
  desconecte una integración.
- La UI actual sólo consulta el último registro y escribe `config.bot_activo`.
  No hay flujo de conexión, estados de provisioning, QR, reconexión,
  desconexión ni una API de provisioning idempotente.
- No existe una Edge Function dedicada a WhatsApp en el repositorio. Las
  funciones existentes son billing.

## Servidor y workflows

Read-only en el host:

- Docker y Compose válidos.
- `n8n` healthy, Evolution API `2.3.7`, PostgreSQL y Redis en ejecución.
- `WHATSAPP_MODE=shadow` y `PILOT_MODE=shadow` efectivos.
- `N8N_BLOCK_ENV_ACCESS_IN_NODE` activo.
- Las ocho variables privadas esperadas están presentes en `.env` y en el
  entorno efectivo de n8n; sus valores no se imprimieron.
- Evolution raíz respondió HTTP 200. La consulta de instancias sin credencial
  no se ejecutó con una clave visible y devolvió 401.

Según el inventario previamente validado, el workflow legacy
`gRTZDLTXvGgNq4BZ` sigue activo y el workflow shadow
`5UQMp5vAMfBfJtSy` sigue inactivo. No se modificaron. La única instancia real
conocida es `miwsp`, perteneciente al entorno productivo de Barbería Central;
no se la puede reutilizar para provisioning QA de otro tenant.

## Implementación QA preparada

La entrega local incorpora una frontera server-side aditiva:

- `20260821090000_whatsapp_tenant_provisioning.sql` crea una fila única por
  tenant + entorno, con RLS habilitado, sin acceso a `anon`/`authenticated` y
  CRUD únicamente para `service_role`.
- `supabase/functions/whatsapp-provision/index.ts` exige proyecto QA,
  `WHATSAPP_PROVISIONING_ENV=qa`, `WHATSAPP_MODE=shadow`, `PILOT_MODE=shadow` y
  una membresía owner/admin. El tenant se resuelve en servidor; el navegador
  no puede elegir instancia, credencial, webhook ni entorno. Los conflictos
  de unicidad se releen como operación idempotente.
- El adapter por defecto es `mock`: genera un QR de prueba temporal y no llama
  Evolution. Un adapter real sólo se habilita con una configuración QA
  explícita y separada; fuera del proyecto QA falla cerrado.
- `WhatsAppConnectionPanel` expone estados de producto, QR temporal,
  reconexión, desconexión y errores sanitizados. No muestra términos técnicos
  ni secretos y sólo ofrece acciones que el servidor vuelve a autorizar.
- La función no usa CORS comodín: sólo devuelve `Access-Control-Allow-Origin`
  para el `APP_BASE_URL` configurado o el origen HTTPS del proyecto QA.
- El catálogo comercial centralizado es Starter ARS 30.000, Pro ARS 60.000 y
  Premium ARS 100.000 por mes. Mientras Mercado Pago está pausado, la landing
  ofrece un CTA opcional `VITE_SALES_WHATSAPP_NUMBER` mediante `wa.me`; no usa
  Evolution ni habilita checkout.

Las verificaciones estáticas locales pasan, pero la migración y la Edge Function
todavía deben aplicarse/desplegarse en QA mediante el mecanismo oficial de
Supabase. No se aplicó ninguna mutación en QA desde esta auditoría ni se tocó
producción.

## Bloqueadores antes de un piloto real

1. Falta una instancia Evolution QA aislada y autorizada. El proyecto QA sólo
   tiene integraciones mock; no es seguro apuntar una nueva UI al `miwsp`
   productivo.
2. Falta aplicar la migración y desplegar la Edge Function en el proyecto QA,
   con `WHATSAPP_PROVISIONING_ENV=qa`; debe verificarse que el bundle no reciba
   ningún secreto. No se debe desplegar esta función en producción.
3. Falta una instancia Evolution QA aislada si se quiere pasar del adapter mock
   a QR real. La UI y los tests permanecen en modo shadow.
4. El escaneo físico de QR no se ejecutó. Si el cierre requiere escanear un QR
   real, necesita una acción manual en un teléfono autorizado y una instancia
   QA, nunca `miwsp`.

## Próxima implementación segura

La implementación debe ser aditiva y reversible en QA:

1. Aplicar la migración y desplegar la función únicamente en QA.
2. Ejecutar la matriz owner/admin/staff/read-only con Tenant A y Tenant B,
   incluidos intentos cruzados y doble click concurrente.
3. Mantener el adapter mock para validar estados y QR sin efectos externos.
4. Habilitar un host Evolution QA dedicado sólo después de una autorización
   operativa separada; nunca reutilizar `miwsp`.

## Verificación local de esta entrega

- `npm test`: PASS, incluyendo la verificación específica de arquitectura
  multitenant/WhatsApp, catálogo y cleanup.
- `npm run lint`: PASS.
- `npm run build`: PASS; un intento intermedio devolvió `spawn EPERM` del
  runner Windows y el reintento aislado terminó correctamente.
- `git diff --check`: PASS.
- Secret scan del diff: sin valores de credenciales.
- Playwright y smoke visual no pudieron iniciar Chromium en este runner: el
  proceso hijo falla con `spawn EPERM`. No se interpreta como un PASS visual.
  Requiere repetirlo en CI o una sesión de navegador con permisos de proceso.

## Continuación de cierre QA

El proyecto QA `cmsymmszlzikqpvfqjre` fue verificado por host y el frontend
`https://barberia-qa.cuchitron.lat` respondió HTTP 200. El bundle remoto aún
corresponde al deploy anterior: contiene los secure fields y la referencia QA,
pero todavía no contiene el panel nuevo de WhatsApp ni el CTA comercial
accesible por plan del commit local.

El preflight oficial de migraciones se detuvo sin escribir. QA contiene 43
versiones remotas entre `20260810171324` y `20260811024120` que no existen en
este repositorio; además `20260813120000` y
`20260821090000_whatsapp_tenant_provisioning.sql` figuran sólo localmente. Por
eso `db push --dry-run` devuelve `LegacyDbPushMissingLocalError`. No se ejecutó
repair automático ni se aplicó la migración nueva.

La regresión de demo causada por el catálogo de tres planes fue corregida de
forma mínima: cada CTA ahora incluye el nombre del plan y el test selecciona
Starter de manera explícita. Resultado final: demo 160 PASS y 8 SKIPPED
esperados; DEMO-14 pasó en los ocho viewports. La suite pública quedó en 72/72
PASS. `npm test`, lint, build, diff-check y secret scan siguen verdes.

Mientras el historial no sea reconciliado, no se desplegó
`whatsapp-provision`, no se ejecutó la matriz live Tenant A/B y no se publicó
ningún commit en `main`.

## Actualización de cierre técnico — 2026-08-27

Esta actualización sustituye cualquier referencia histórica anterior cuando
entra en conflicto con la verificación actual.

- El host `servidor-barberia` fue comprobado en modo read-only: Docker 29.5.0,
  n8n healthy y Evolution respondió HTTP 200. Las únicas instancias observadas
  son `austral-qa-tenant-1` y `miwsp`; ambas están `open`. No se reinició ni
  modificó ningún contenedor.
- La instancia QA conserva exclusivamente los eventos configurados
  `QRCODE_UPDATED`, `CONNECTION_UPDATE` y `MESSAGES_UPSERT`, con endpoint en el
  proyecto QA. No se tocaron `miwsp`, n8n ni workflows legacy.
- En Supabase QA (`cmsymmszlzikqpvfqjre`), Tenant A (1) tiene la conexión
  autoritativa `evolution/qa/shadow/CONNECTED` asociada a
  `austral-qa-tenant-1`. La proyección `saas_integraciones.estado` aún figura
  `desactivado`; la migración de sincronización preparada corrige únicamente
  esa proyección y refuerza el claim con la conexión autoritativa.
- `supabase db push --dry-run --skip-vault` se detuvo antes de aplicar SQL por
  dos migraciones locales deliberadamente diferidas que faltan en el history
  QA: `20260806163000_link_barberia_central_evolution.sql` y
  `20260807070000_mercadopago_sandbox_tenant.sql`. La migración
  `20260824150000_whatsapp_integration_state_sync.sql` no se aplicó ni se
  marcó como aplicada. No se utilizó `--include-all`.
- La corrección quedó preservada localmente en la rama `qa-whatsapp-hardening`,
  commit `f914dcd`, sin push ni deploy. `main` no fue alterada.
- El preflight outbound no fue consumido: hay cero claims `qa-outbound:*`, cero
  envíos registrados y cero operaciones sobre reservas/clientes. Los shadow
  runs QA observados mantienen `outbound_allowed=false` y
  `mutation_allowed=false`. Los nombres de los cuatro secrets outbound QA se
  verificaron sin leer ni registrar sus valores.
- El contrato de outbound continúa QA-only, Tenant A-only,
  `austral-qa-tenant-1`-only, `fromMe=false`, allowlist por hash,
  idempotencia determinística y sin retry automático después de alcanzar
  Evolution. No se ejecutó `sendText`.
- El esquema actual no contiene una entidad persistente de conversación
  multipaso para servicio/fecha/hora/confirmación; el shadow agent conserva
  propuestas por evento en `saas_automation_shadow_runs.metadata`. La futura
  reserva debe seguir el flujo inbound → datos faltantes → disponibilidad →
  confirmación inequívoca → RPC autoritativa → idempotencia, manteniendo la
  mutación deshabilitada mientras no exista esa confirmación.

### Verificación local

- `npm test`: PASS (incluye state-sync, shadow, outbound, aislamiento e
  idempotencia).
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- `node scripts/scan-secrets.mjs`: PASS.

### Bloqueo operativo

No se puede aplicar de forma segura la migración de sincronización ni ejecutar
el único outbound autorizado mientras el history QA siga requiriendo las dos
migraciones diferidas. Se necesita una decisión explícita para resolver ese
drift (sin aplicar SQL ni marcar esas versiones automáticamente). Hasta
entonces: producción sin contacto, `miwsp` intacta, outbound cerrado y sin
reservas/clientes modificados.

## Cierre del transporte outbound QA — 2026-08-27

La ejecución autorizada se reanudó sólo después de corregir el contrato de
Evolution API v2.3.7. El payload de `sendText` ahora usa exclusivamente los
campos de nivel superior `{ number, text }`; no se reintentó la llamada fallida
anterior ni se reutilizó su idempotency key. La corrección está en el commit
`70ce267` de `qa-whatsapp-hardening`, con CI oficial completamente verde
(quality, e2e-public, e2e-demo y authenticated-qa).

Evidencia sanitizada del único intento nuevo:

- La función QA respondió HTTP 200 y registró exactamente una fila de operación
  `qa-outbound:*` nueva en estado `completed`. La operación anterior quedó en
  `failed` con referencia `evolution_validation_rejected_pre_send`, sin volver a
  invocarse.
- Evolution v2.3.7 registró una única línea `Sending message` para
  `austral-qa-tenant-1` y un acuse `DELIVERY_ACK`. No se expone el destinatario
  ni el identificador del mensaje.
- El evento de webhook posterior fue atendido por la función QA (HTTP 200). El
  guard `fromMe` del webhook mantiene esos eventos fuera del agente; no apareció
  un shadow run adicional atribuible al envío ni un segundo outbound.
- La tabla de operaciones conserva exactamente dos filas QA outbound: una
  fallida (pre-send) y una completada. No hay filas para otro tenant o
  integración. El replay no se ejecutó contra Evolution: la unicidad de la
  operación y la prueba del claim idempotente se verificaron sin producir otra
  llamada externa.
- En la ventana de la ejecución no hubo actualizaciones de `clientes`, `turnos`,
  checkout, pagos ni facturas. n8n no registró actividad relacionada.
- `austral-qa-tenant-1` y `miwsp` continuaron `open`; el inventario Evolution
  permaneció en exactamente dos instancias. No se realizaron mutaciones sobre
  `miwsp`, producción, billing ni Mercado Pago.

El piloto outbound QA quedó cerrado nuevamente (`WHATSAPP_OUTBOUND_PILOT_ENABLED=0`),
por lo que cualquier nueva ejecución falla cerrado. Los cuatro nombres de
secrets QA siguen presentes; sus valores no se registran aquí. La evidencia
privada de aprobación temporal se conserva fuera del repositorio hasta el
cierre administrativo del piloto.

## Agent outbound y estado conversacional determinista — 2026-08-27

Esta sección aplica explícitamente Austral SaaS Architecture a la frontera de
tenant y Austral Design System a los estados que eventualmente se comunicarán
en el panel. La implementación es local, pura y no está desplegada.

### Frontera de confianza del agente

- `whatsapp-agent-outbound-pilot` acepta únicamente `event_id`. No acepta desde
  el navegador número, `remoteJid`, texto, tenant o instancia.
- El servidor debe resolver la conexión por la integración Evolution y exigir
  proyecto QA `cmsymmszlzikqpvfqjre`, entorno `qa`, modo `shadow`, Tenant A y
  `austral-qa-tenant-1`; `miwsp`, producción, Tenant B y cualquier instancia
  distinta fallan cerrado.
- La fuente debe ser un shadow run real, reciente, `from_me=false`, con
  `mutation_allowed=false`, `outbound_allowed=false`,
  `mutation_blocked=true` y `outbound_send=false`. La respuesta propuesta debe
  pertenecer al mismo evento/tenant y estar sanitizada.
- La operación usa una clave idempotente derivada de `event_id`, un único POST
  con el contrato Evolution v2.3.7 `{ number, text }` y ningún retry después de
  alcanzar Evolution. El flag del piloto permanece deshabilitado y no se hizo
  ningún envío en esta sesión.

### Estado conversacional preparado

No existe actualmente una entidad persistente de conversación en Supabase. El
helper `supabase/functions/_shared/whatsappConversationState.mjs` define el
contrato sin conectarlo al webhook ni a una RPC. Si se integra posteriormente,
la persistencia debe ser estructurada y tenant-scoped (por ejemplo, una
extensión aditiva de `saas_automation_shadow_runs.metadata` o una tabla nueva
tras un preflight separado), nunca memoria libre del LLM ni un identificador
controlado por el cliente.

Cada estado contiene, como mínimo: `conversation_id`, `tenant_id`,
`integration_id`, `instance`, `environment`, `sender_hash`, `pending_intent`,
`service_id`, `requested_date`, `requested_time`, `daypart`, `barber_id`,
`confirmation_required`, `confirmation_state`, `last_event_id`, `expires_at`,
`version` y los datos de la propuesta de disponibilidad. La identidad queda
ligada a la integración/instancia y al hash del sender; nunca se deriva tenant
desde un teléfono.

Las operaciones de transición reciben además el scope resuelto por servidor y
lo comparan con el estado persistido; sin ese scope, o ante cualquier cambio
de tenant, integración, entorno, instancia o hash, la transición se rechaza.

La máquina de estados es `collecting` → `awaiting_confirmation` → `confirmed`.
Un estado vencido pasa a `expired` y borra los campos de la propuesta; un “sí”
posterior no puede confirmar contexto antiguo. El TTL es de 30 minutos,
coherente con la ventana de frescura del evento outbound actual. Los campos
faltantes se solicitan en orden determinista: servicio, fecha y hora; cuando
están completos se consulta disponibilidad, sin repetir preguntas ya resueltas.

La disponibilidad sólo puede registrarse con la fuente autoritativa
`horarios_disponibles_reserva_publica`, junto a un `availability_snapshot_id`.
Un slot libre genera una propuesta vinculada a tenant, conversación, sender,
servicio, fecha, hora, barbero (si aplica), snapshot y versión. La confirmación
acepta únicamente frases inequívocas (`sí`, `confirmo`, `confirmar turno` y
equivalentes normalizados), la versión y propuesta vigentes. Expresiones
ambiguas como “dale”, “ok”, “puede ser” o “creo que sí” no confirman.

Antes de una futura mutación se exige una nueva consulta autoritativa. Si el
slot cambió, el resultado es `slot_changed` y no se crea turno. Incluso cuando
la revalidación es positiva, el contrato preparado devuelve
`ready_for_booking_mutation=true` pero `mutation_allowed=false` y
`booking_mutation_executed=false` en este estado del proyecto.

El contrato futuro queda secuenciado como: claim de mutación,
revalidación autoritativa, RPC centralizada de reserva, resultado idempotente y
respuesta. La clave sería `conversation_id + version`; duplicados de webhook,
mensaje, confirmación o retry deben producir como máximo una reserva. No se
ejecutó la RPC ni se creó ninguna reserva o cliente.

Los mensajes no textuales (audio, imagen, documento, sticker), vacíos, grupos,
broadcasts y eventos malformados se rechazan explícitamente; no se agrega STT
ni visión. Timeouts del LLM, JSON inválido, errores de Supabase/RPC,
conexiones obsoletas, tenant ausente y eventos duplicados deben fallar cerrado.
La observabilidad permitida se limita a `event_id`, `conversation_id`, tenant,
instancia, intent, campos faltantes, estado, latencia y clase de error; nunca
teléfono crudo, mensajes innecesarios, tokens o secretos.

### Verificación de esta entrega

- `npm test` incorpora `verify-whatsapp-conversation-state.mjs`, que cubre
  campos faltantes, confirmación estricta, TTL, revalidación/race de slot,
  duplicados, aislamiento A/B, tipos de mensaje no soportados y la bandera de
  mutación permanentemente falsa.
- CI #117 sobre `cebb93b` quedó `success` en quality, e2e-public, e2e-demo y
  authenticated-qa antes de este trabajo.
- No se creó migración y no se modificó ninguna tabla, secreto, Edge Function
  desplegada, Evolution, n8n o producción.

**AGENT OUTBOUND CODE READY BUT NOT DEPLOYED**

### Integración QA multi-turn preparada — 2026-08-28

La implementación QA ahora conecta el helper determinista al webhook de
Evolution sin crear una tabla nueva: cada evento de una conversación de reserva
guarda `conversation_state`, `conversation_scope`, `instance` y la acción en el
`metadata` del `saas_automation_shadow_runs` correspondiente. El siguiente
evento recupera únicamente el estado cuyo `tenant_id`, `integration_id`,
`environment`, instancia y `sender_hash` coinciden con la conexión resuelta por
el servidor.

El flujo admite la recolección ordenada de servicio, fecha y hora, consulta la
RPC autoritativa `horarios_disponibles_reserva_publica`, solicita confirmación
de la propuesta vigente y pasa a `confirmed`/`ready_for_booking_mutation` sólo
tras una afirmación explícita. En esta fase `mutation_allowed` permanece siempre
`false`; no se ejecuta la RPC de reserva ni se modifican clientes o turnos.

`booking_intent` puede usar el outbound QA únicamente para preguntas,
disponibilidad y acuse de confirmación no mutante. La función outbound exige
además que el estado persistido y su scope pertenezcan a la misma conversación;
los claims de reserva creada/modificada continúan bloqueados. El cambio está
validado localmente y todavía requiere CI/deploy QA antes de una conversación
real.
