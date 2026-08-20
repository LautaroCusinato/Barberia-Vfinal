# Mercado Pago Sandbox

La integración usa únicamente las Edge Functions de Supabase. El navegador nunca recibe el Access Token y PayPal queda sin cambios.

## Secretos y variables

Configurar en **Supabase → Edge Functions → Secrets** del proyecto, nunca en `VITE_*` ni en Git:

```text
MERCADOPAGO_SANDBOX_ACCESS_TOKEN=<Access Token TEST del vendedor>
MERCADOPAGO_SANDBOX_WEBHOOK_SECRET=<secreto de firma de la aplicación TEST>
MERCADOPAGO_ENVIRONMENT=sandbox
APP_BASE_URL=https://barberia.cuchitron.lat
```

`MERCADOPAGO_SANDBOX_ACCESS_TOKEN` y `APP_BASE_URL` son necesarios para crear el checkout y sincronizar planes. `MERCADOPAGO_SANDBOX_WEBHOOK_SECRET` es necesario antes de recibir notificaciones; sin él el endpoint responde `provider_not_configured` y no procesa eventos. `MERCADOPAGO_API_BASE_URL` es opcional y conserva `https://api.mercadopago.com` por defecto.

Un owner/admin de plataforma puede consultar `GET /functions/v1/billing-api/config-status`. Devuelve únicamente booleanos y nombres de variables faltantes; nunca devuelve valores secretos.

El código rechaza cualquier `MERCADOPAGO_ENVIRONMENT` distinto de `sandbox`. La fila `saas_proveedores_pago` también debe conservar `entorno = 'sandbox'`; al primer `sync-plans` o `checkout` válido, la Edge Function habilita automáticamente sólo ese proveedor sandbox.

## Orden de activación

1. Cargar los secretos anteriores.
2. Iniciar sesión como owner/admin de plataforma.
3. Ejecutar `POST /functions/v1/billing-api/sync-plans` con `{ "proveedor_codigo": "mercadopago", "plan_codigo": "starter" }`. La API exige un único plan por operación.
4. Verificar que únicamente el binding sandbox QA autorizado resuelva `starter`. La identidad del tenant se obtiene de `saas_billing_provider_bindings`; no existe un `tenant_id` sandbox hardcodeado.
5. El binding sandbox debe tener `proveedor_codigo=mercadopago`, `entorno=sandbox` y `activo=true`. Sin binding, el tenant queda bloqueado; sin `external_plan_id`/precio habilitado, el checkout permanece bloqueado.
6. Desde una sesión autenticada, la API resuelve el binding del tenant (o el único binding sandbox para una operación de plataforma) y nunca acepta `environment`, precio o credenciales desde el navegador.
6. Configurar el webhook en Mercado Pago apuntando a:

```text
https://ssagttjdgtypxjcgdnrw.supabase.co/functions/v1/billing-webhooks/mercadopago
```

El webhook exige `x-signature` y `x-request-id`, vuelve a consultar el recurso en Mercado Pago y registra cambios de forma idempotente. Los eventos de pago se vinculan por `external_reference` (`billing:<checkout_attempt_id>`) y las suscripciones por su ID externo.

## Idempotencia y seguridad

- Checkout: `X-Idempotency-Key = mp-checkout:<checkout_attempt_id>`.
- Planes: `X-Idempotency-Key = mp-plan:<plan_codigo>`.
- La base impide dos checkouts activos por tenant/plan/proveedor.
- La suscripción interna se vincula en `saas_suscripciones_externas` antes de devolver el checkout listo.
- No se guardan tokens, tarjetas ni payloads completos del proveedor.
- El proveedor global `saas_proveedores_pago` permanece deshabilitado; la autorización sandbox proviene exclusivamente del binding activo por tenant/proveedor/entorno y el plan `starter`. Producción permanece bloqueada.

## Qué falta antes de probar

Si no se cargaron todavía, faltan exactamente:

- `MERCADOPAGO_SANDBOX_ACCESS_TOKEN`;
- `APP_BASE_URL` con HTTPS;
- `MERCADOPAGO_SANDBOX_WEBHOOK_SECRET` para completar la recepción segura de webhooks.

El webhook puede configurarse después de validar la URL de checkout, pero no debe considerarse integración completa hasta cargar su secreto y probar una notificación sandbox firmada.
