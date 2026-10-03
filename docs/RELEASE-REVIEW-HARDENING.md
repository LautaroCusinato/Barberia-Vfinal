# Release `fix/review-hardening`

- Comparar / abrir PR: https://github.com/LautaroCusinato/Barberia-Vfinal/compare/main...fix/review-hardening
- El PR no se creó automáticamente: `gh` no está instalado en la máquina de release y el conector de GitHub no respondió. Pegar el título y la descripción de abajo.

---

## Título del PR

`fix: endurecimiento de seguridad, RLS multi-tenant, billing y UX del panel (review-hardening)`

## Descripción del PR

### Seguridad
- **Envío manual por WhatsApp**: el navegador ya no llama a n8n. Ahora pasa por la Edge Function `whatsapp-panel-send`, que valida la sesión, la membresía y el rol (no `readonly`) y que el plan esté operativo. El teléfono sale de la ficha del cliente y n8n recibe un secreto server-side (`X-Austral-Panel-Secret`). Se eliminó la URL pública `VITE_*`.
- **RLS multi-tenant** (`20261002091000_tenant_write_boundaries`): se quitó el INSERT directo de `barberias`, y en `barberia_members` el INSERT directo queda cerrado y el UPDATE sólo puede cambiar `role`. `saas_integraciones` sólo se escribe con service_role. Se agregaron triggers que exigen que cliente, turno y barbero/servicio pertenezcan al mismo tenant.
- **Reserva pública** (`20261002092000_public_booking_hardening`): `crear_reserva_publica` respeta `reservas_publicas`, el horizonte, la anticipación y la grilla. Sólo acepta horarios que ofrece la RPC de disponibilidad, no pisa los datos de clientes existentes, limita el tamaño de los campos y admite hasta 5 reservas web activas por teléfono.
- **Billing con service_role** (`20261002090000_billing_service_role_claims`): `request_is_service_role()` lee `request.jwt.claims`. Antes todo webhook, cron o reconciliación con la service key era rechazado con 42501.
- `billing-jobs` compara el secreto del cron en tiempo constante. `billing-webhooks` ya no confía en campos sin firmar del body (`preapproval_plan_id`, fechas).
- Se corrigió el contraste y los targets táctiles con una auditoría automática.

### Bugs
- Teléfonos de cualquier área de Argentina (`549` + área + número, 13 dígitos). Antes sólo se aceptaba AMBA y `+54 9 11 …` no se normalizaba (`20261001091000_phone_any_argentine_area`).
- La pausa del bot al responder a mano ahora funciona para todo el staff con la RPC `pause_whatsapp_bot_for_manual_reply` (`20261001090000`), y el workflow productivo la respeta antes de la IA y antes del envío.
- **Roles invitados** (`20261003090000_invited_roles_agenda_access`): `admin` y `empleado` podían ser invitados pero no aparecían en ninguna política de escritura, así que no podían crear turnos ni clientes. Ahora `admin` tiene los mismos permisos operativos que `owner` sobre agenda, clientes, notas, pagos, mensajes, profesionales, servicios, horarios y bloqueos. `empleado` tiene los mismos que `barbero`. No cambian billing, `config`, `barberias`, membresías ni integraciones.
- Reconciliación de billing: se mergea `metadata` en vez de reemplazarla, porque reemplazarla perdía `environment`.
- Agenda: la vista semana muestra cada turno una sola vez y entran los 7 días. Se corrigieron horarios vacíos, rangos "Lun a Vie", la recuperación de errores de cobro y bugs de pérdida de datos y consistencia en el workspace.

### UI/UX
- Ajustes visuales del panel: layout de escritorio a la altura de la pantalla con scroll interno en listas, agenda móvil compacta, estados vacíos accionables, un único formato de moneda, labels de estado y copy en español sin jerga técnica.
- Ajustes de landing, reserva, registro, login y onboarding. Transiciones y micro-interacciones con fallback seguro. Los modales ya no roban el foco.

### Tests
- Suite Vitest + Testing Library (lib, utils, componentes y regresiones).
- Nuevos contratos en `npm test`, entre ellos `verify-panel-send-boundary`, `verify-phone-format`, `verify-billing-service-role`, `verify-tenant-write-boundaries`, `verify-public-booking-hardening`, `verify-whatsapp-manual-pause` y `verify-invited-roles-access`.
- Antes de cada commit se corren `npm run lint`, `npm test` y `npx vitest run`.

### Despliegue
- **QA (`cmsymmszlzikqpvfqjre`)**: migraciones aplicadas y verificadas. Edge Functions `whatsapp-panel-send`, `billing-jobs` y `billing-webhooks` desplegadas. Falta `billing-api` (ver abajo).
- **Producción (`ssagttjdgtypxjcgdnrw`)**: pendiente. Ver "Plan de rollout a producción" en este documento.
- n8n: requiere los pasos manuales de la sección "Pasos de operador n8n".

🤖 Generated with [Claude Code](https://claude.com/claude-code)

---

## Estado en QA (`cmsymmszlzikqpvfqjre`), 2026-10-03

Antes de aplicar se comparó (sólo lectura) el historial de migraciones de QA contra `supabase/migrations/`.

| Migración | Acción en QA |
|---|---|
| `20260913110000_whatsapp_production_connection_prerequisite` | Aplicada. Faltaba en QA aunque ya estaba en prod. Es drift-safe y no hizo cambios porque la tabla ya existía. |
| `20260913120000_whatsapp_production_runtime_contract` | Aplicada. Faltaba en QA y ya estaba en prod. Los datos se validaron antes (0 filas incompatibles). |
| `20261001090000_whatsapp_bot_manual_handoff` | Aplicada |
| `20261001091000_phone_any_argentine_area` | Aplicada |
| `20261002090000_billing_service_role_claims` | Aplicada |
| `20261002091000_tenant_write_boundaries` | Aplicada |
| `20261002092000_public_booking_hardening` | Aplicada |
| `20261003090000_invited_roles_agenda_access` | Aplicada |
| `20260806163000_link_barberia_central_evolution` | **No se aplica en QA.** Es un dato de producción y QA no tiene el tenant `barberia-central`. |
| `20260807070000_mercadopago_sandbox_tenant` | **No se aplica en QA.** Es el tenant técnico de prod. |

Las versiones del historial de QA se ajustaron a los timestamps del repo.

**Drift detectado:** QA tiene `20260921210000_whatsapp_pairing_on_demand`, que no está en ninguna rama del repo y no guarda sus statements en el historial. Hay que recuperarla y versionarla.

Verificación (sólo lectura, o en transacciones con `rollback`):
- Existen `pause_whatsapp_bot_for_manual_reply` (authenticated: execute; anon: no), `request_is_service_role` (sólo service_role), `resolve_whatsapp_runtime_context` / `claim_whatsapp_runtime_event` (sólo service_role) y los 4 triggers `enforce_*_same_tenant`, con 8 triggers en total.
- Teléfono: `+54 9 351 555-1234` se guarda como `5493515551234`. Un número inválido se rechaza con 22023.
- Políticas: las de staff incluyen `owner, admin, recepcionista, barbero, empleado`. Las operativas (`servicios`, `barberos`, `horarios`, `bloqueos`, `barbero_servicios`) incluyen `owner, admin`. `config_write_owner` sigue sólo para owner.
- Simulación RLS con rollback:
  - `empleado` puede insertar clientes, pero no bloqueos ni config.
  - `admin` puede insertar clientes y bloqueos, pero no config.
  - `readonly` no puede insertar nada.
- Grants: `authenticated` ya no tiene INSERT en `barberias` ni UPDATE en `saas_integraciones`. Las políticas de escritura que quedan en esas tablas son `barberias_update_owner`, `members_delete_owner` y `members_update_owner`.
- Advisors de seguridad: no aparecieron hallazgos nuevos atribuibles a esta release. Los WARN que siguen son previos: `search_path` mutable en helpers `crm_*`/`set_updated_at`, `btree_gist` en `public`, RPCs SECURITY DEFINER expuestas a propósito y la protección de contraseñas filtradas desactivada.

Edge Functions en QA:

| Función | Versión | verify_jwt | Smoke test |
|---|---|---|---|
| `whatsapp-panel-send` | v1 (nueva) | true | Sin auth: 401. Con anon: 503 `panel_send_not_configured` (faltan secretos). |
| `billing-jobs` | v1 (nueva) | false (auth propia por `x-billing-cron-secret`, igual que en prod) | GET: 405. POST: 503 `cron_not_configured` (falta `BILLING_CRON_SECRET`). |
| `billing-webhooks` | v75 | true (se mantuvo la configuración previa de QA) | GET: 405. Proveedor inválido: 404. POST sin firma: 401 `invalid_signature`. |
| `billing-api` | sin cambios (v82) | — | **Pendiente.** Es un archivo de 103 KB y no se transcribió por MCP. Desplegar con la CLI. |

Incidente en QA: entre el deploy v74 y el v75, `billing-webhooks` quedó caída unos 5 minutos (BOOT_ERROR) porque se subió un `_shared/providers.ts` incompleto. v75 lo corrigió y está verificada.

## Secretos por función

No se configuró ningún secreto. Revisarlos en cada proyecto con `supabase secrets list --project-ref <ref>`.

| Función | Secretos necesarios |
|---|---|
| `whatsapp-panel-send` | `WHATSAPP_PANEL_SEND_WEBHOOK_URL` (https, webhook n8n `panel-enviar-wsp`), `WHATSAPP_PANEL_SEND_SECRET` (el mismo valor que la credencial Header Auth de n8n). `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta la plataforma. **Faltan en QA.** |
| `billing-jobs` | `BILLING_CRON_SECRET` (obligatorio; **falta en QA**). Opcionales: `BILLING_OUTBOX_SINK_URL`, `BILLING_OUTBOX_SINK_SECRET`. Para reconciliar: `MERCADOPAGO_SANDBOX_ACCESS_TOKEN` / `MERCADOPAGO_ACCESS_TOKEN`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`. |
| `billing-webhooks` | `MERCADOPAGO_ENVIRONMENT`. En sandbox: `MERCADOPAGO_SANDBOX_ACCESS_TOKEN` y `MERCADOPAGO_SANDBOX_WEBHOOK_SECRET` (en QA existen, porque la verificación de firma corre). En producción: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_PRODUCTION_SELLER_ID`, `MERCADOPAGO_PRODUCTION_APPLICATION_ID`, `MERCADOPAGO_API_BASE_URL`, `BILLING_ENVIRONMENT`, `BILLING_WEBHOOK_URL` y los flags `BILLING_PRODUCTION_*_VERIFIED`. PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_API_BASE_URL`. |
| `billing-api` | Lo mismo que `billing-webhooks`, más `APP_BASE_URL`, `SUPABASE_ANON_KEY` y los gates de producción (`BILLING_PRODUCTION_ENABLED`, `BILLING_PRODUCTION_READINESS`, `BILLING_PRODUCTION_CHECKOUT_CONFIRMATION`, `BILLING_PRODUCTION_PILOT_TENANT_ID`, `BILLING_PRODUCTION_ALLOWED_TENANT_IDS`, `MERCADOPAGO_PRODUCTION_PLAN_ID`, …). En QA E2E: `BILLING_QA_E2E_ENABLED`, `BILLING_QA_E2E_TENANT_ID`, `MERCADOPAGO_SANDBOX_PAYER_EMAIL`. |

## Pasos de operador n8n (manuales)

Desde este entorno no se puede tocar el n8n en vivo. En cada paso, guardar sin activar y validar con una ejecución de prueba.

1. **Credencial para el envío manual**
   1. Generar un secreto largo (≥ 32 bytes aleatorios).
   2. En n8n, crear la credencial *Header Auth* `Austral Panel Send` con Name `X-Austral-Panel-Secret` y Value igual al secreto.
2. **Webhook `panel-enviar-wsp`** (workflow legado "Barberia Central - Bot WhatsApp", nodo `Recibe mensaje panel1`)
   1. Poner *Authentication* en *Header Auth* con la credencial del paso 1.
   2. Revisar el nodo siguiente (`Filtrar datos panel1`): el body ahora trae `{ telefono, texto, barberia_id }`. `telefono` viene sólo en dígitos y se toma de la ficha del cliente.
   3. Guardar y probar sin el header. Debe devolver 403/401.
   4. En Supabase, configurar `WHATSAPP_PANEL_SEND_WEBHOOK_URL=https://<n8n>/webhook/panel-enviar-wsp` y `WHATSAPP_PANEL_SEND_SECRET=<secreto>` en el proyecto correspondiente.
3. **Webhook entrante de WhatsApp** (nodo `Recibe WhatsApp1`, path `whatsapp-miwsp`)
   1. Crear una credencial *Header Auth* distinta (por ejemplo `X-Austral-Evolution-Secret`).
   2. Asignarla al nodo.
   3. En Evolution API, configurar el webhook de la instancia `miwsp` (evento `messages.upsert`) con ese header y valor.
   4. Verificar que un POST sin header es rechazado y que un mensaje real entra.
4. **Pausa por atención humana en el workflow legado**
   1. Confirmar que el nodo `Chequear bot activo` lee `config.bot_activo` del tenant y corta la respuesta automática cuando vale `'false'`. Ese valor lo escribe la RPC `pause_whatsapp_bot_for_manual_reply`.
   2. Si no lo hace, agregar el corte antes de la llamada a DeepSeek.
5. **Re-importar `integrations/templates/Austral WhatsApp Production - Controlled.json`**
   1. Importarlo encima del workflow existente con el mismo nombre. Queda **inactivo** (`active: false`) y debe seguir así.
   2. Vincular las credenciales dedicadas de producción: Header Auth del webhook `austral-whatsapp-production-inbound`, Supabase prod con el dominio restringido a `ssagttjdgtypxjcgdnrw.supabase.co` y DeepSeek prod.
   3. Verificar que estén los nodos de pausa manual: la lectura de `config.bot_activo` antes de la IA y la relectura antes del envío.
   4. No activarlo hasta abrir una ventana aprobada (ver `docs/WHATSAPP-FIRST-CUSTOMER-RUNBOOK.md`).
6. Desactivar la opción de guardar los payloads de ejecución en los workflows que manejan mensajes (por datos personales).

## Plan de rollout a producción (`ssagttjdgtypxjcgdnrw`)

Estado al 2026-10-03: **no se aplicó nada en producción.** El intento fue bloqueado por el control de permisos del entorno y requiere una aprobación explícita del usuario. La última migración de prod sigue siendo `20260913120000`.

### Pre-flight
1. Backup: confirmar que hay un backup diario o PITR reciente en el dashboard de Supabase, o sacar un `pg_dump` (ver `docs/BACKUP-DISASTER-RECOVERY.md`).
2. Advisors de seguridad y performance: guardar la línea base antes del cambio.
3. Pre-check de dependencias (sólo lectura, **ya hecho el 2026-10-03, OK**): existen `is_barberia_member`, `is_barberia_role`, `billing_is_platform_admin`, `barberia_access_state`, `horarios_disponibles_reserva_publica(text,bigint,date)`, `crm_normalize_record`, `config_pkey (barberia_id, clave)`, `clientes (barberia_id, telefono)` único, `turnos.origen/inicio_at/duracion_min` y las 11 políticas que se reemplazan. El panel no escribe directamente en `barberias`, `barberia_members` ni `saas_integraciones`.
4. Prod tiene 7 barberías, 29 clientes, 156 turnos y 4 usuarios (el usuario indicó que no son datos reales).

### Migraciones (en este orden)
1. `20261001090000_whatsapp_bot_manual_handoff`
2. `20261001091000_phone_any_argentine_area`
3. `20261002090000_billing_service_role_claims`
4. `20261002091000_tenant_write_boundaries`
5. `20261002092000_public_booking_hardening`
6. `20261003090000_invited_roles_agenda_access`

Ejemplo: `supabase db push --project-ref ssagttjdgtypxjcgdnrw`, o aplicar archivo por archivo. Si una falla, frenar sin hacer fixes ad hoc.

Prod además no tiene (por nombre) migraciones previas a esta release: `20260810100000_harden_whatsapp_identity_resolution`, `20260813120000_whatsapp_reply_only_pilot`, `20260817090000_billing_binding_aware_checkout`, `20260817100000_harden_billing_provider_binding_grants`, `20260821090000_whatsapp_tenant_provisioning` y `20260824150000_whatsapp_integration_state_sync`. Las `qa_*` son sólo para QA. Ese drift es anterior a esta release y se evalúa por separado. No se requieren para estas 6 migraciones.

### Edge Functions
1. `whatsapp-panel-send` (nueva, `verify_jwt=true`)
2. `billing-webhooks` (mantener `verify_jwt=false` como está en prod: auth por firma)
3. `billing-jobs` (mantener `verify_jwt=false`: auth por `x-billing-cron-secret`)
4. `billing-api` (`verify_jwt=true`)

Ejemplo: `supabase functions deploy <fn> --project-ref ssagttjdgtypxjcgdnrw` (incluye `_shared/`).

### Secretos en prod
- `WHATSAPP_PANEL_SEND_WEBHOOK_URL`, `WHATSAPP_PANEL_SEND_SECRET` (después de los pasos n8n 1–2).
- Confirmar `BILLING_CRON_SECRET`.
- Confirmar los de Mercado Pago (ver tabla de secretos).

### Verificación post-deploy
- Repetir los chequeos de la sección "Estado en QA": funciones, grants, políticas, trigger de teléfono y simulación RLS con rollback.
- Advisors de seguridad.
- Smoke tests de las 4 funciones.
