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

La documentación oficial argentina describe el flujo de plan asociado en dos pasos: crear el plan y luego crear la suscripción con `preapproval_plan_id`; para la suscripción API exige `card_token_id` y estado `authorized`. La referencia de `GET /preapproval_plan/{id}` también devuelve `init_point`, por lo que el enlace hospedado es un recurso documentado, pero la habilitación exacta para una cuenta productiva debe verificarse antes de cobrar. Referencias: [plan asociado](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/integration-configuration/subscription-associated-plan), [crear plan](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval-plan/post), [crear suscripción](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/create-preapproval/post), [obtener plan e `init_point`](https://www.mercadopago.com.ar/developers/es/reference/online-payments/subscriptions/get-preapproval-plan/get), [notificaciones](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications), [Webhooks y firma](https://www.mercadopago.com.ar/developers/es/docs/subscriptions/additional-content/your-integrations/notifications/webhooks).

### Auditoría técnica actualizada

- `billing-api` resuelve el precio externo en backend, crea una intención idempotente y, cuando hay `external_plan_id`, consulta el plan y devuelve su `init_point`; no crea una suscripción por URL ni confía en parámetros del navegador.
- `billing-webhooks` valida HMAC con `x-signature`/`x-request-id`, prioriza el `data.id` del query param documentado, vuelve a consultar el recurso y deduplica antes de transicionar.
- Se corrigió el enrutamiento server-side para que suscripciones usen `/preapproval/{id}`, pagos `/v1/payments/{id}`, pagos autorizados `/authorized_payments/{id}` y eventos de plan `/preapproval_plan/search?q={id}`. Los eventos de plan, pagos y pagos autorizados se auditan/reconcilian sin transicionar; sólo un `preapproval` verificado puede cambiar el estado de la suscripción.
- La documentación de Mercado Pago presenta una tensión entre la configuración general de Webhooks y el apartado de Suscripciones: una sección indica que la configuración por aplicación no está disponible para Suscripciones, mientras que la tabla de tópicos incluye `subscription_preapproval_plan`, `subscription_preapproval` y `subscription_authorized_payment`. Por eso el webhook productivo queda **pendiente de verificación en la aplicación productiva**; no se declara listo sólo por tener una URL.

Conclusión de flujo: el sandbox validado usa un checkout hospedado derivado de `preapproval_plan`; para producción no se cambiará a Preferences ni se reutilizará el plan sandbox. Antes de activar hay que confirmar en la cuenta productiva si el enlace hospedado entrega los tópicos esperados. Si no los entrega, el cambio mínimo será completar el flujo oficial `/preapproval` con `card_token_id` tokenizado en cliente, manteniendo los mismos contratos internos, webhook, reconciliación e idempotencia.

## Decision: `init_point` hospedado frente a `card_token_id`

### Fuente exacta del checkout actual

El checkout sandbox actual no es una Preference ni una suscripcion creada por el navegador. `billing-api` llama a `mercadoPago()` con el `external_plan_id` resuelto desde `saas_plan_precios`; esa funcion hace `GET /preapproval_plan/{id}` y devuelve `sandbox_init_point` (o `init_point` como fallback) del plan verificado. La respuesta se persiste en `saas_billing_checkout_attempts` y la UI solo navega a esa URL. No se envia `card_token_id` desde el frontend.

### Lo que la documentacion confirma y lo que no

Mercado Pago documenta que un plan tiene un `init_point` hospedado y que `POST /preapproval` puede crear una suscripcion asociada. La misma guia de plan asociado indica de forma explicita que la suscripcion debe incluir `preapproval_plan_id`, `card_token_id` y `status=authorized`. Por eso el enlace de plan es real y utilizable en sandbox, pero la documentacion no garantiza por si sola que un `init_point` de plan sea el flujo productivo completo para nuestra aplicacion. El estado productivo queda **no confirmado** hasta verificar una suscripcion y sus webhooks en la cuenta productiva.

La decision es **Escenario B para produccion, Escenario A solo para sandbox**:

- Sandbox: conservar el checkout hospedado del plan, sin capturar tarjetas ni crear credenciales nuevas.
- Produccion: no habilitar el `init_point` hasta confirmar el comportamiento en la aplicacion productiva. Si no esta soportado, el cambio minimo es tokenizar la tarjeta con el SDK oficial en el cliente y enviar unicamente el `card_token_id` efimero a una Edge Function que cree `/preapproval` con `status=authorized`. Nunca se aceptara numero de tarjeta, CVV o token desde URLs, logs o tablas.

No se modifican ahora los contratos internos: checkout attempts, suscripciones externas, webhooks firmados, reconciliacion, idempotencia, estados ni la UX de retorno siguen siendo los mismos.

### Enrutamiento de eventos y activacion

El webhook vuelve a consultar el recurso segun el topico documentado: `subscription_preapproval` usa el detalle `/preapproval/{id}` (la documentacion de notificaciones tambien ofrece `/preapproval/search`), `subscription_preapproval_plan` usa `/preapproval_plan/search?q={id}`, `subscription_authorized_payment` usa `/authorized_payments/{id}` y `payment` usa `/v1/payments/{id}`. Un evento de plan solo se audita como `ignored`; los pagos y pagos autorizados se registran sin cambiar el estado de la suscripcion. Solo un `preapproval` verificado, con vendedor, aplicacion (cuando esta configurada), plan, importe/moneda, tenant y referencia compatibles, puede ejecutar `transition_saas_subscription`.

### Trial y datos pendientes

No se crea ningun plan productivo en esta etapa. Antes de preparar uno, solo hay que definir: **plan interno, importe, moneda, periodicidad y trial**. La alternativa recomendada sigue siendo trial interno de Austral y solicitar el metodo de pago al finalizar; no se elige `free_trial` de Mercado Pago sin una decision comercial explicita.

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
- HMAC y encabezados se validan antes de persistir; el identificador `data.id` del query param se usa en el manifiesto y se compara mediante WebCrypto.
- El recurso se vuelve a consultar al proveedor para no confiar en el payload.
- Seller, application, plan, precio, moneda y tenant piloto deben coincidir.
- `record_billing_webhook_event` deduplica; un evento repetido no duplica pago, comprobante ni transición.
- Eventos inválidos o fuera de allowlist quedan auditados como `ignored`/`failed` con errores sanitizados.
- La reconciliación cubre webhook tardío o ausente; nunca se dispara sólo por el retorno del navegador. La API oficial espera HTTP 200/201 y puede reintentar si no recibe confirmación, por lo que el endpoint responde rápidamente y deja el trabajo pesado para la consulta/reconciliación server-side.

## Piloto productivo futuro

No se eligió ni habilitó un tenant. La configuración futura debe permitir exactamente un ID, distinto de los protegidos 1, 5 y 6, con entorno `production`, proveedor `mercadopago`, plan/precio productivo explícitos y allowlist únicamente server-side. El frontend no puede elegirlo.

## Secrets y datos que faltan

Datos no secretos que deberán definirse para un piloto (no se cargan todavía):

- seller ID y application ID productivos, verificados desde la misma aplicación;
- código del plan interno, país, moneda, importe, periodicidad e ID externo del `preapproval_plan` productivo;
- ID del único tenant piloto (distinto de 1, 5 y 6);
- `MERCADOPAGO_ENVIRONMENT=production`, `MERCADOPAGO_API_BASE_URL=https://api.mercadopago.com`, `APP_BASE_URL` y la URL canónica del webhook;
- allowlist server-side de un único tenant, `BILLING_PRODUCTION_ENABLED=0` hasta la autorización final, y PayPal deshabilitado.

Sólo cuando exista autorización separada deberán configurarse en Supabase Edge Function Secrets:

- `MERCADOPAGO_ACCESS_TOKEN` productivo;
- `MERCADOPAGO_WEBHOOK_SECRET` de la misma aplicación productiva;
- `BILLING_CRON_SECRET` para `billing-jobs`;
- `BILLING_OUTBOX_SINK_SECRET` sólo si se habilita un sink privado de outbox.

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
