# Auditoría integral PRE-RC2

**Fecha:** 2026-08-13 (America/Argentina/Buenos_Aires)  
**Resultado objetivo:** `RC2 CODE AUDIT COMPLETE`  
**Alcance:** repositorio, pruebas, configuración versionada y auditoría read-only del servidor. No se realizaron mutaciones sobre producción.

## Guardrails aplicados

Esta auditoría se realizó aplicando **Austral SaaS Architecture** y **Austral Design System**:

- aislamiento estricto entre tenants y entre QA/producción;
- secretos sólo en entornos privados o credenciales nativas, nunca en frontend, logs o Git;
- cambios funcionales mínimos, reversibles y sin alterar contratos, RPC, RLS, billing productivo, WhatsApp, n8n o Evolution;
- preservación de los primitives, responsive, accesibilidad y estados visuales existentes.

Entornos explícitos:

- **Producción prohibida:** `ssagttjdgtypxjcgdnrw`.
- **QA permitido:** `cmsymmszlzikqpvfqjre`.
- La suite QA falla cerrada si la URL, el project ref o el entorno no coinciden.

## Estado del repositorio

- Rama: `main`.
- HEAD auditado: `c11bf289e07559c3a57f413025ea1f796413716` (`fix(whatsapp): remove env access from reply-only template`).
- El árbol estaba limpio al iniciar la auditoría.
- Los cambios de esta auditoría son locales hasta completar todas las verificaciones y el push normal.
- No se modificaron migraciones, datos, secretos, workflows ni configuraciones de producción.

## Baseline y verificaciones locales

| Control | Resultado |
| --- | --- |
| Node / npm | Node 24.18.0 / npm 11.16.0 |
| `npm run lint` | PASS |
| `npm test` | PASS; incluye verificadores de agenda, SaaS, onboarding, billing, WhatsApp, mobile y RC2 hardening |
| `npm run build` | PASS; Vite compiló 2714 módulos |
| `git diff --check` | PASS |
| `node scripts/scan-secrets.mjs` | PASS; 331 archivos revisados |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilidades de severidad alta |
| Build inicial observado | ~8.59 s |

Bundle inicial de referencia antes de esta auditoría:

| Artefacto | Tamaño | gzip |
| --- | ---: | ---: |
| `index` | 233.29 kB | 60.39 kB |
| `App` | 164.47 kB | 41.01 kB |
| `vendor` | 161.02 kB | 52.41 kB |
| `PlatformCRM` | 73.59 kB | 19.00 kB |
| CSS | 154.34 kB | 26.23 kB |

La corrección de esta auditoría no agrega dependencias ni modifica el contrato visual; el bundle final deberá compararse nuevamente en el cierre.

## E2E y aislamiento

### Suite pública

La ejecución Chromium de los escenarios públicos pasó **9/9**. Los escenarios que requieren QA permanecen separados y no se ejecutan contra producción.

### Suite autenticada QA

El preflight QA validó:

```text
environment=qa
runtime_project_ref=cmsymmszlzikqpvfqjre
project_ref_is_not_production=true
url_matches_project_ref=true
auth_isolated=true
external_providers_disabled=true
cleanup_requires_explicit_execute=true
fixture_prefix=E2E_QA_
```

El seed autorizado creó/reutilizó únicamente fixtures con prefijo `E2E_QA_` (2 tenants ficticios y 12 usuarios QA; sin proveedores externos). La suite autenticada completa pasó **192/192** en Chromium, mobile 390/360/412/430, tablet 768 y desktop 1366/1920 antes del cierre de esta auditoría; se repite nuevamente después de los cambios actuales.

La primera ejecución sin Vite apuntando al proyecto QA fue bloqueada por el guard (`vite_runtime_project_mismatch` / runtime de producción). Esto es un resultado esperado y correcto: el guard impide una prueba QA contra `ssagttjdgtypxjcgdnrw`.

La verificación de aislamiento Tenant A/Tenant B pasó. No se crearon reservas ni se tocaron datos de Central o Nueva.

### WhatsApp y billing QA

- Verificadores offline de Shadow/Reply Only y tests de WhatsApp pasan.
- El workflow legacy permanece activo; el workflow shadow y los temporales QA permanecen inactivos.
- No se enviaron mensajes ni se crearon reservas.
- Billing se prueba mediante mocks/guards; PayPal y Mercado Pago productivo permanecen deshabilitados.

## Cambios implementados en esta auditoría

### 1. Privacidad de Realtime

`src/App.jsx` ya no imprime payloads de `mensajes`, que podían incluir texto, teléfonos o datos de clientes. En desarrollo sólo registra el tipo de evento y el estado de conexión; en producción no se imprimen esos datos.

### 2. Webhooks de Mercado Pago fail-closed

`supabase/functions/_shared/providers.ts` ahora:

- rechaza un `MERCADOPAGO_ENVIRONMENT` ausente en vez de inferir `sandbox`;
- mantiene producción bloqueada;
- valida HMAC antes de consultar `/users/me` u otra identidad externa;
- no realiza llamadas al proveedor para firmas inválidas.

### 3. Scope del sandbox de billing

`supabase/functions/billing-api/index.ts` aplica el scope técnico completo para Mercado Pago sandbox:

- proveedor `mercadopago`;
- entorno `sandbox`;
- plan `starter` en las rutas de sincronización;
- tenant técnico autorizado `id=6`;
- usuarios de plataforma sólo con rol owner/admin;
- los demás tenants no pueden ser seleccionados por estas rutas.

### 4. Regresión automatizada

Se agregó `scripts/verify-rc2-hardening.mjs` al comando `npm test`. Comprueba privacidad de logs, fail-closed del entorno/HMAC y el scope de tenant sandbox sin conectarse a servicios externos.

## Hallazgos clasificados

### P0

**0 encontrados.** No se observó bypass de tenant, exposición de `service_role` en frontend, secreto versionado, ni mutación productiva.

### P1

**0 pendientes.** Los recorridos QA de autenticación, aislamiento y módulos operativos pasan; no se detectó un bloqueante para RC2 en el código auditado.

### P2 resueltos

1. Payload de mensajes expuesto en la consola del navegador: corregido con logging DEV-only sanitizado.
2. Webhook MP inválido podía provocar una consulta de identidad antes del rechazo: HMAC ahora se valida primero.
3. Rutas MP sandbox permitían un scope técnico más amplio que el permitido: restringidas al tenant 6 y a metadata sandbox.
4. Entorno MP ausente se infería como sandbox: ahora falla cerrado.

### P2/P3 documentados para una etapa posterior

- `confirmarCobro` cambia un turno a `atendido` antes de insertar el pago. Si la inserción falla, puede quedar un estado parcial. Resolver requiere una operación transaccional/RPC y autorización explícita; no se modifica en esta auditoría.
- La reserva pública calcula la fecha por la zona horaria de Argentina mientras el negocio puede tener otra zona. El cambio correcto necesita decisión de contrato y prueba de medianoche multi-zona; no se cambia sin autorización.
- Algunas vistas internas autorizadas muestran `error.message` crudo de Supabase. Es una mejora de sanitización P2, no observada como fuga pública y no necesaria para bloquear RC2.
- Los contenedores del servidor distintos de n8n no tienen healthcheck Docker; existen puertos publicados en 0.0.0.0. Requiere una ventana operativa y revisión de firewall.
- No hay cuenta de monitoring externo configurada. El runbook debe usar las señales existentes hasta que se autorice crear una cuenta.

## Auditoría read-only del servidor

Servidor `servidor-barberia`, stack `/home/lautaro/mati-bot`:

- Docker 29.5.0 activo.
- n8n healthy; Evolution API, PostgreSQL de Evolution y Redis activos.
- Workflow legacy `gRTZDLTXvGgNq4BZ` activo e intacto.
- Workflow shadow `5UQMp5vAMfBfJtSy` inactivo para tráfico externo.
- `WHATSAPP_MODE=shadow`, `PILOT_MODE=shadow`, `REPLY_ONLY_KILL_SWITCH=disabled`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=true`.
- Supabase efectivo de n8n apunta a `cmsymmszlzikqpvfqjre.supabase.co`.
- En la ventana auditada no se observaron errores relevantes en los logs de los cuatro contenedores principales.
- Disco raíz aproximadamente 22% usado; memoria disponible; no hubo reinicios ni cambios de red/puertos.

Riesgos operativos no modificados: ausencia de healthchecks en algunos servicios, puertos publicados y necesidad de revisar rotación/retención de backups y firewall.

## Bloqueos explícitos

- La migración Reply Only `20260813120000_whatsapp_reply_only_pilot.sql` no se aplica: falta que el usuario configure de forma privada la URL de base/Management API QA y su token. No se solicitaron secretos por chat.
- Mercado Pago productivo sigue bloqueado. Falta autorización explícita, credenciales productivas separadas, plan/productor verificado, webhook productivo, backup reciente y rollout de un único tenant.
- No se habilitaron Reply Only, `booking_enabled`, webhooks externos, pagos, mensajes ni checkouts reales.

## Criterio de cierre

El cierre se declarará sólo después de repetir lint, tests, build, 9 escenarios públicos, 192 escenarios autenticados QA, WhatsApp offline, diff-check y secret scan sobre este estado, seguido de un commit y push normal sin secretos. Cualquier fallo deja el estado en `RC2 AUDIT BLOCKED` y se documenta sin tocar producción.

