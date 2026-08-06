# Billing sandbox

Esta carpeta contiene el contrato común, adaptadores y plantillas de webhook para Mercado Pago y PayPal. No se importa desde `src/` y no se ejecuta en el navegador.

## Contrato interno

La fuente de verdad es `saas_suscripciones`. Las referencias del proveedor viven en `saas_suscripciones_externas`; los intentos de checkout usan `saas_billing_checkout_attempts` con una clave de idempotencia por tenant. Pagos, comprobantes, reembolsos, webhooks, historial y outbox tienen tablas separadas con RLS.

Estados normalizados: `trialing`, `active`, `past_due`, `grace_period`, `suspended`, `canceled`, `incomplete`, `payment_review` y `refunded` (se conservan `paused`/`expired` por compatibilidad). Las transiciones se hacen con `transition_saas_subscription()` y registran historial + evento interno en una misma transacción.

## Proveedores

Los adaptadores implementan el mismo contrato (`createCustomer`, `createCheckout`, `getSubscription`, `cancelSubscription`, `reactivateSubscription`, `verifyWebhook`). Sólo aceptan credenciales de entorno del backend. No hay valores reales en el repositorio y no se deben crear variables `VITE_` para secretos.

Variables privadas requeridas:

```text
MERCADOPAGO_ACCESS_TOKEN
MERCADOPAGO_WEBHOOK_SECRET
MERCADOPAGO_API_BASE_URL (opcional; default https://api.mercadopago.com)
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_WEBHOOK_ID
PAYPAL_API_BASE_URL (opcional; default https://api-m.sandbox.paypal.com)
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

El service role sólo se configura en una Edge Function/Cloudflare Worker/backend privado. Nunca en `VITE_*`, n8n compartido, logs o el frontend.

## URLs que quedarán listas al habilitar backend

- Portal: `https://<dominio>/facturacion`
- Mercado Pago: `https://<dominio>/api/billing/mercadopago/webhook`
- PayPal: `https://<dominio>/api/billing/paypal/webhook`
- Retorno aprobado: `https://<dominio>/facturacion?billing=success`
- Retorno cancelado: `https://<dominio>/facturacion?billing=cancel`

Las rutas son documentación/contrato; hoy no están desplegadas y no aceptan webhooks.

## Flujo de un pago

1. El owner selecciona plan/proveedor y llama `create_billing_checkout_intent()`. El RPC verifica tenant, plan, moneda y clave idempotente; no llama al proveedor.
2. El backend sandbox crea el checkout con el adaptador y guarda sólo IDs externos no sensibles.
3. El proveedor llama el endpoint de webhook. Se valida firma, límite de payload y se minimiza el evento antes de `record_billing_webhook_event()`.
4. Un worker idempotente reconcilia el evento, aplica `transition_saas_subscription()`, registra pago/factura y publica el outbox.
5. El acceso se resuelve con `barberia_access_state()`: trial, activo, pago pendiente, gracia o suspendido.

No se debe cambiar estado por una redirección del navegador ni por el contenido sin firma de un webhook.

## n8n

`n8n/billing-workflows.inactive.json` contiene plantillas importables, todas con `active: false`, rutas placeholder y sin credenciales. No se importaron ni activaron; tampoco tienen conexión con el workflow productivo de WhatsApp. Dunning y recordatorios sólo preparan tareas internas hasta definir consentimiento y proveedor.

## Rollout y rollback

1. Configurar credenciales sandbox en el backend privado y registrar IDs externos de planes.
2. Desplegar un endpoint privado con firma, rate limit, tamaño máximo y logs redactados.
3. Ejecutar eventos sintéticos repetidos y verificar que `saas_billing_webhook_events` queda idempotente.
4. Activar un proveedor para un tenant de prueba, sin tocar WhatsApp.
5. Rollback: deshabilitar el proveedor, detener el worker y volver a leer el estado interno; no borrar tablas ni datos. Las migraciones son aditivas.

En esta etapa no se hicieron llamadas a Mercado Pago/PayPal, no se crearon cobros y no se activaron webhooks.
