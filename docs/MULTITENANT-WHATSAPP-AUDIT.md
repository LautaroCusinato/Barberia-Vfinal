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
