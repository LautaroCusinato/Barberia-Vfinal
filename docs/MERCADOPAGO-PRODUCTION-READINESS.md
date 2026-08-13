# Mercado Pago production readiness

Estado al 2026-08-13: **OFFLINE READY / NO ACTIVAR**.

Esta revisión usa **Austral SaaS Architecture** para preservar tenant scoping, RLS/RPC, idempotencia, firma y rollback, y **Austral Design System** para que el retorno de checkout sea claro en desktop, mobile y app-switch sin cambiar el dominio de billing.

No se cargaron credenciales productivas, no se consultó Mercado Pago productivo, no se creó checkout, no se cobró y no se modificaron Supabase productivo, Barbería Central, Barbería Nueva, WhatsApp, n8n ni Evolution.

## Estado por etapa

| Etapa | Estado | Evidencia |
| --- | --- | --- |
| OFFLINE READY | Sí | auditoría de Edge Functions, guards, dry-run, contratos y pruebas estáticas |
| SECRETS PENDING | Sí | faltan token/secret seller y application productivos; no se almacenan en Git, frontend ni chat |
| PRODUCTIVE PILOT PENDING | Sí | todavía no existe allowlist productiva de un único tenant autorizado |
| REAL PAYMENT PENDING | Sí | no se generó checkout ni pago productivo |

## Arquitectura confirmada

La implementación existente usa **suscripciones de Mercado Pago con `preapproval_plan` / `preapproval`**, no una Preference de Checkout Pro. `billing-api` crea una intención idempotente, resuelve el precio externo desde Supabase y devuelve sólo la URL del proveedor. `billing-webhooks` valida `x-signature`/`x-request-id`, vuelve a consultar el recurso en Mercado Pago y procesa una única transición. `billing-jobs` atiende outbox, trials y reconciliación con un secreto de cron server-side.

La documentación oficial describe el flujo de plan asociado en dos pasos: crear el plan y luego crear la suscripción con `preapproval_plan_id`; también indica los tópicos de suscripción y el uso de Webhooks con firma. El código actual obtiene el `init_point`/`sandbox_init_point` del plan hospedado. Antes de producción debe confirmarse con la cuenta productiva que ese mismo flujo hospedado está habilitado para la aplicación; no se debe mezclar con Preferences ni con otra API. Referencias: [suscripciones con plan asociado](https://www.mercadopago.com.br/developers/en/docs/subscriptions/integration-configuration/subscription-associated-plan), [notificaciones de suscripciones](https://www.mercadopago.com.br/developers/en/docs/subscriptions/additional-content/your-integrations/notifications), [Webhooks y firma](https://www.mercadopago.com.br/developers/en/docs/subscriptions/additional-content/your-integrations/notifications/webhooks), [cuentas de prueba](https://www.mercadopago.com.br/developers/en/docs/subscriptions/additional-content/your-integrations/test/accounts).

## Contratos y estados

La fuente de verdad es el backend: `trialing`, `active`, `past_due`, `grace_period`, `suspended`, `canceled`, `incomplete`, `payment_review`, `refunded` y los estados legacy existentes se conservan. La transición pasa por `transition_saas_subscription`, con historial y versión. Una URL de retorno nunca activa una suscripción.

La pantalla `/facturacion` ahora interpreta sólo `billing=success|pending|failure|cancel` como una señal visual. Muestra que está verificando o que el checkout quedó pendiente/cancelado, pero siempre vuelve a cargar `billing-api/status`; no acepta `subscription`, `status`, `payment_id` ni ningún dato del navegador como autorización. Esto cubre escritorio, mobile y el regreso después de cambiar a la app de Mercado Pago.

## Catálogo auditado

La tabla de precios separa plan interno, proveedor, país, moneda, periodicidad y entorno; no hace conversión automática.

| Plan interno | Sandbox conocido | Producción |
| --- | --- | --- |
| Starter | ARS 15.000 mensual, Mercado Pago sandbox, tenant técnico 6 | precio/plan externo productivo aún no verificado; no listo |
| Pro | catálogo interno existente; no se cambia precio | precio/plan externo productivo pendiente de verificación |
| Business | catálogo interno existente; no se cambia precio | precio/plan externo productivo pendiente de verificación |

No se reutiliza el plan sandbox ni se cambia la fila existente para simular producción. Cada precio productivo debe ser una fila separada y verificarse contra vendedor, aplicación, moneda, importe, periodicidad y país.

## Return URLs y UX

El dominio canónico es `https://barberia.cuchitron.lat`. Las URLs de UX preparadas son:

- `https://barberia.cuchitron.lat/facturacion?billing=success`
- `https://barberia.cuchitron.lat/facturacion?billing=pending`
- `https://barberia.cuchitron.lat/facturacion?billing=failure`
- `https://barberia.cuchitron.lat/facturacion?billing=cancel`

Todas son informativas. El usuario puede cerrar el checkout, cambiar de pestaña o volver desde Android sin depender de `sessionStorage` ni del estado React anterior.

## Webhook, idempotencia y reconciliación

- Endpoint futuro: `https://ssagttjdgtypxjcgdnrw.supabase.co/functions/v1/billing-webhooks/mercadopago`.
- HMAC y encabezados se validan antes de persistir.
- El recurso se vuelve a consultar al proveedor para no confiar en el payload.
- Seller, application, plan, precio, moneda y tenant piloto deben coincidir.
- `record_billing_webhook_event` deduplica; un evento repetido no duplica pago, comprobante ni transición.
- Eventos inválidos o fuera de allowlist quedan auditados como `ignored`/`failed` con errores sanitizados.
- La reconciliación cubre webhook tardío o ausente; nunca se dispara sólo por el retorno del navegador.

## Piloto productivo futuro

No se eligió ni habilitó un tenant. La configuración futura debe permitir exactamente un ID, distinto de los protegidos 1, 5 y 6, con entorno `production`, proveedor `mercadopago`, plan/precio productivo explícitos y allowlist únicamente server-side. El frontend no puede elegirlo.

## Secrets y datos que faltan

Sólo cuando exista autorización separada deberán configurarse en Supabase Edge Function Secrets:

- `MERCADOPAGO_ACCESS_TOKEN` productivo;
- `MERCADOPAGO_WEBHOOK_SECRET` de la misma aplicación productiva;
- seller ID esperado;
- application ID esperado;
- ID de cada `preapproval_plan` productivo;
- secreto privado de `billing-jobs` y evidencia de alerting/backup.

Los valores no deben enviarse por chat, commit, documentación, `VITE_*` ni bundle del navegador.

## Dry-run y guards

`npm run billing:production:dry-run` es offline: no llama a Mercado Pago, no crea checkout y no muta Supabase. Exige entorno y project ref productivos explícitos, `BILLING_PRODUCTION_ENABLED=0`, seller/application verificados, un único piloto, plan/precio/webhook/jobs/alerting/backup/rollback listos, PayPal deshabilitado y proveedor global apagado. Con configuración vacía queda bloqueado, como corresponde.

`npm run billing:production:self-test` cubre ref QA rechazado, sandbox rechazado, activación, tenants protegidos, múltiples pilotos, PayPal y webhook incorrecto.

## Rollback

1. Apagar el flag del tenant piloto y retirar la allowlist.
2. Mantener `BILLING_PRODUCTION_ENABLED=0` y detener nuevos checkouts.
3. Conservar suscripciones, pagos, webhooks y auditoría.
4. Reconciliar eventos pendientes antes de modificar estados.
5. No borrar planes ni convertir la fila sandbox en productiva.
6. Verificar Central, Nueva y los demás tenants sin mutaciones.

## Criterio de activación posterior

Se requiere una autorización nueva que indique el tenant piloto exacto, plan/moneda/importe, seller/application verificados, webhook firmado, backup/restauración, alertas, rollback y permiso explícito para cobrar. Esta etapa no otorga esa autorización.

