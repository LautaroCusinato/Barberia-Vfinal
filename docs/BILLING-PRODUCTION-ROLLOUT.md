# Billing productivo: rollout seguro para RC1

La matriz complementaria de readiness y UX está en [`docs/MERCADOPAGO-PRODUCTION-READINESS.md`](./MERCADOPAGO-PRODUCTION-READINESS.md). Estado de esta etapa: **NO ACTIVAR**.

Estado actual: **NO ACTIVAR**. Este documento prepara el cambio de Mercado Pago sandbox a producción sin crear checkout, pagos ni suscripciones reales.

Aplican Austral SaaS Architecture (tenant scoping, RLS/RPC, idempotencia, firma y rollback) y Austral Design System (cualquier control futuro debe reutilizar el Design System y no exponer secretos en la UI). Esta etapa no modifica reservas, WhatsApp, n8n, Evolution, DNS, Cloudflare ni datos de Barbería Central (id 1) o Barbería Nueva (id 5).

## 1. Auditoría de la implementación

### Componentes

- `billing-api`: autenticado con JWT, resuelve el tenant desde la sesión o desde un tenant técnico sandbox validado, consulta precios externos por proveedor/país/moneda/entorno, usa RPC transaccional para la intención y claves idempotentes del proveedor. `config-status`, checkout, status externo, sync y reconciliación están protegidos por roles.
- `billing-webhooks`: sólo POST, valida HMAC antes de persistir, vuelve a consultar el recurso al proveedor, guarda un payload mínimo, vincula por `external_reference`/plan verificado y registra duplicados sin repetir efectos.
- `billing-jobs`: exige `BILLING_CRON_SECRET`, vence trials, procesa outbox y ejecuta reconciliación con transición de estado idempotente. Sin sink no marca eventos como publicados.
- Pricing: `saas_plan_precios` ya separa `plan_codigo`, proveedor, país, moneda, periodicidad y `entorno`. No existe conversión automática.
- Estados: la transición central es `transition_saas_subscription`; conserva historial, versión y evento de proveedor.
- Portal/checkout: el navegador sólo recibe URLs del proveedor; nunca tokens. El portal muestra precios externos y pagos confirmados por webhook.

### Evidencia de producción (lectura)

En `ssagttjdgtypxjcgdnrw`, el proveedor Mercado Pago está `activo=false` y `entorno=sandbox`; PayPal también está deshabilitado. El único precio externo es `starter / AR / ARS 15.000 mensual / sandbox`, vinculado al plan sandbox actual. Los tenants 1 y 5 no tienen metadata de billing sandbox. El tenant técnico 6 conserva la suscripción sandbox histórica y no se lo convierte en piloto productivo.

La base tiene dos intentos de checkout fallidos, uno expirado y tres eventos de outbox pendientes del ensayo sandbox. No se ejecutó ninguna mutación durante esta auditoría. Antes de producción, esos eventos deben drenarse o clasificarse en el runbook sin mezclarlos con métricas productivas.

El candidato comercial productivo preparado offline es `starter`, ARS 30.000 mensuales, con trial interno de 14 días. No existe todavía una fila productiva, `external_plan_id`, checkout ni secreto productivo; el precio sandbox de ARS 15.000 permanece sin cambios.

### Bloqueos encontrados

1. Las Edge Functions actuales son deliberadamente sandbox-only: `MERCADOPAGO_ENVIRONMENT` distinto de `sandbox` se rechaza y la identidad permitida es el vendedor TEST. Esto es una protección correcta para esta etapa, pero significa que no se debe cambiar un secreto y esperar que producción funcione.
2. `saas_proveedores_pago` tiene una fila por proveedor con un único `entorno`; cambiarla en producción reemplazaría el contexto sandbox. No se debe actualizar esa fila ni el precio id 1 durante este cierre.
3. No existe aún una identidad productiva verificada (seller/application), un precio productivo separado, un tenant piloto autorizado ni un monitor de webhook productivo.
4. La documentación vigente de Mercado Pago exige comprobar el canal de notificaciones para la aplicación productiva. El endpoint de suscripción asociado documenta `preapproval` con `card_token_id`, mientras que el flujo actual entrega el `init_point` hospedado del plan. No se debe declarar compatibilidad productiva hasta verificar que ese checkout emite `subscription_preapproval_plan`/`subscription_authorized_payment` al endpoint autorizado; si no, se debe adoptar el flujo `/preapproval` con tokenización de tarjeta en cliente.

Conclusión: no se requiere una migración ni una escritura de datos para este dry-run. Una futura activación debe introducir una configuración por entorno (o una fila/configuración equivalente) antes de permitir simultáneamente sandbox y producción; no se debe reutilizar la fila sandbox.

## 2. Separación requerida

| Control | Sandbox actual | Producción futura |
| --- | --- | --- |
| Proyecto | `cmsymmszlzikqpvfqjre` para QA; el ensayo existente debe permanecer aislado | `ssagttjdgtypxjcgdnrw` |
| `MERCADOPAGO_ENVIRONMENT` | `sandbox` | `production` explícito |
| Identidad | vendedor TEST verificado por `/users/me` | seller ID productivo verificado por `/users/me` |
| Aplicación | aplicación TEST del vendedor | application ID productivo esperado |
| Precio | fila `saas_plan_precios` con `entorno=sandbox` | fila nueva con `entorno=production`, mismo plan interno y precio explícito |
| Tenant | técnico sandbox id 6 | un único tenant dedicado, nunca 1, 5 ni 6 |
| Proveedor | `activo=false` global; autorización aislada del tenant técnico | flag específico de entorno/piloto; nunca activación global |
| Checkout | `sandbox_init_point` | `init_point` productivo después de confirmación explícita |
| Webhook | contrato existente en el endpoint productivo | secreto productivo separado y validación de la misma aplicación |

El prefijo del token no decide el entorno. La identidad se valida contra `/users/me`, seller ID, application ID, plan, precio, proyecto y configuración explícita.

## 3. Tenant piloto

No se habilitó ninguno. El rollout sólo podrá aceptar un `BILLING_PRODUCTION_PILOT_TENANT_ID` que:

- sea exactamente un ID;
- no sea 1, 5 ni 6;
- esté marcado en base como `environment=production`;
- tenga provider `mercadopago`, plan y precio productivo explícitos;
- esté incluido en una allowlist de un solo elemento;
- tenga respaldo y rollback verificados.

La allowlist no debe ser elegible desde el frontend ni desde una petición genérica. Debe vivir en configuración privada/servidor y comprobarse junto con el tenant confiable.

## 4. Dry-run productivo

`scripts/billing-production-dry-run.mjs` evalúa la preparación offline. Nunca llama Mercado Pago, no crea checkout, no modifica Supabase y no imprime valores de secretos.

```powershell
$env:BILLING_DRY_RUN='1'
$env:BILLING_ENVIRONMENT='production'
$env:BILLING_PROJECT_REF='ssagttjdgtypxjcgdnrw'
$env:BILLING_PRODUCTION_ENABLED='0'
$env:MERCADOPAGO_ENVIRONMENT='production'
$env:MERCADOPAGO_API_BASE_URL='https://api.mercadopago.com'
# Cargar secretos sólo en el entorno privado del servidor/Edge Function.
# No pegarlos en la terminal compartida ni en Git.
npm run billing:production:dry-run
```

El resultado sólo informa booleanos de secretos, IDs no sensibles, checks y bloqueos. Valida seller/application, tenant único, plan/país/moneda/importes, webhook, jobs, alerting, backup y rollback. La activación debe seguir dando `production_enabled=false` durante esta etapa.

## 5. Webhook productivo

Endpoint a registrar cuando exista aprobación explícita:

```text
https://ssagttjdgtypxjcgdnrw.supabase.co/functions/v1/billing-webhooks/mercadopago
```

Contrato preparado:

1. Mercado Pago envía POST con `x-signature` y `x-request-id`.
2. Se valida HMAC con el secreto productivo, antes de usar el body; el manifiesto usa el `data.id` documentado en el query param y la comparación se realiza con WebCrypto.
3. Se consulta el recurso al proveedor con el token productivo server-side.
4. Se comprueban seller/application/plan/precio/moneda y tenant piloto.
5. `record_billing_webhook_event` deduplica por proveedor + evento.
6. La transición de suscripción y pagos se ejecuta sólo una vez; reintentos son idempotentes.
7. Eventos inválidos, fuera de allowlist o desfasados quedan auditados como `ignored`/`failed` con códigos sanitizados. Los eventos `subscription_preapproval_plan` sólo actualizan auditoría y nunca activan una suscripción.

La documentación de Mercado Pago indica que el receptor debe responder HTTP 200/201 dentro de 22 segundos; los reintentos posteriores hacen necesaria la idempotencia existente. La verificación final del tópico y URL debe hacerse en el panel/API de la aplicación productiva, sin usar un pago real.

La función desplegada todavía rechaza producción a propósito. No modificar secretos ni desplegar una nueva versión como parte de este cierre.

## 6. Checklist de activación futura

### Antes de tocar configuración

- [ ] Aprobación escrita para un único tenant piloto.
- [ ] Backup reciente y restauración verificable.
- [ ] Rollback probado en preview/QA.
- [ ] Alertas y health checks activos.
- [ ] Precio productivo creado separadamente; no se convierte moneda automáticamente.
- [ ] Seller ID y application ID obtenidos desde la misma aplicación productiva.

### Configuración privada

- [ ] `MERCADOPAGO_ENVIRONMENT=production`.
- [ ] `MERCADOPAGO_ACCESS_TOKEN` productivo guardado sólo en Edge Function Secrets.
- [ ] `MERCADOPAGO_WEBHOOK_SECRET` productivo guardado sólo en Edge Function Secrets.
- [ ] `MERCADOPAGO_EXPECTED_SELLER_ID` y `MERCADOPAGO_EXPECTED_APPLICATION_ID` configurados.
- [ ] `BILLING_PRODUCTION_ENABLED` sigue en `0` hasta la autorización final.
- [ ] PayPal permanece deshabilitado.

### Verificaciones server-side

- [ ] `/users/me` devuelve el seller esperado.
- [ ] El plan productivo devuelve seller, application, moneda, importe y periodicidad esperados.
- [ ] La fila de precio productivo coincide con el plan externo y el país del piloto.
- [ ] El tenant piloto es el único allow-listed y no es Central/Nueva/sandbox técnico.
- [ ] El webhook firma y procesa un evento sintético en QA; no usar pago real para validar firma.
- [ ] La aplicación productiva confirma qué tópicos de Suscripciones están disponibles y el panel de notificaciones muestra entrega correcta a la URL productiva.
- [ ] `billing-jobs` tiene cron secret, alertas y reconciliación preparados.
- [ ] Dry-run completo verde.

### Activación controlada (otra etapa)

- [ ] Confirmación explícita del responsable inmediatamente antes de habilitar.
- [ ] Habilitar sólo la configuración del tenant piloto.
- [ ] No activar proveedor global.
- [ ] Crear checkout sólo después de una segunda confirmación.
- [ ] No activar por URL de retorno; esperar webhook validado o reconciliación backend.
- [ ] Monitorizar durante la ventana de observación.

## 7. Rollback

1. Marcar la configuración del tenant piloto como deshabilitada; no borrar historial.
2. Mantener `BILLING_PRODUCTION_ENABLED=0` y retirar el allowlist productivo.
3. Detener nuevos checkouts; no cancelar automáticamente suscripciones sin decisión del responsable.
4. Conservar webhooks, pagos, facturas y transiciones para auditoría.
5. Reconciliar eventos pendientes con el proveedor antes de volver a trial/grace, usando backend autorizado.
6. Restaurar la configuración sandbox sólo en su entorno/tenant técnico; nunca cambiar el precio productivo por el sandbox.
7. Verificar Central, Nueva y los demás tenants sin modificaciones.

## 8. Pasos manuales en Mercado Pago

Cuando se autorice la siguiente etapa, el responsable debe:

1. Crear/seleccionar la aplicación productiva del vendedor real.
2. Obtener sus credenciales productivas y guardarlas en Supabase Edge Function Secrets; nunca en el chat, Git o `VITE_*`.
3. Registrar el webhook de planes/suscripciones y pagos en la URL productiva anterior.
4. Confirmar que el webhook esté asociado a la misma aplicación que emite el token.
5. Crear un plan productivo con la moneda e importe autorizados y guardar su ID externo.
6. Probar `/users/me` y la consulta del plan desde una función privada, sin imprimir tokens.
7. Avisar cuando todo esté listo para una revisión de dry-run. No activar ni pagar hasta una autorización explícita separada.

## 9. Autorización necesaria para cobrar

Se necesita una autorización explícita, en un mensaje posterior, que indique: tenant piloto exacto, plan/moneda/importe, seller/application verificados, webhook probado, backup/rollback/alertas verdes y permiso para habilitar cobro productivo. Esa autorización no está otorgada en esta etapa.
