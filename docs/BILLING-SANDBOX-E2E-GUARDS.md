# Billing sandbox E2E: same-plan guard y cancelación

Este cambio prepara el E2E de Mercado Pago sin ejecutar ninguna operación financiera.

## Autorización server-side

El checkout del mismo plan Starter sólo puede abrirse cuando `billing-api` verifica
simultáneamente:

- `SUPABASE_URL` pertenece al proyecto QA `cmsymmszlzikqpvfqjre` y no al proyecto productivo;
- `BILLING_ENVIRONMENT=qa`;
- `BILLING_QA_E2E_ENABLED=1`;
- `BILLING_QA_E2E_TENANT_ID` coincide con el tenant autenticado;
- el binding activo resuelve `mercadopago/sandbox` y `checkout_habilitado=true`.

El navegador no puede enviar `tenant_id`, `environment`, `is_e2e`, precios ni un
identificador externo para obtener este permiso. En producción el predicado nunca
es verdadero.

Para habilitarlo en QA, configurar las tres variables no secretas en los secrets
de la Edge Function `billing-api` del proyecto `cmsymmszlzikqpvfqjre`:

```text
BILLING_ENVIRONMENT=qa
BILLING_QA_E2E_ENABLED=1
BILLING_QA_E2E_TENANT_ID=1
```

No agregar estas variables en producción. La protección normal del plan permanece
deshabilitada mientras no se configure este flag.

## Cancelación sandbox

`POST /functions/v1/billing-api/subscription/cancel` resuelve el tenant desde la
sesión owner/admin, el binding sandbox y la suscripción externa ya vinculada. Hace
un GET autoritativo del preapproval y del plan antes de cancelar, exige seller,
application, plan, importe, moneda y entorno sandbox, y rechaza cualquier ID o
entorno enviado por el navegador. La función usa el PUT oficial de Mercado Pago
con `status=canceled`, vuelve a leer el recurso y sólo entonces transiciona la
suscripción interna y registra una auditoría deduplicada.

El endpoint falla cerrado para producción, tenants sin binding, identidad cruzada,
IDs arbitrarios y configuraciones ambiguas. Repetirlo sobre un recurso ya cancelado
es idempotente y no emite otra mutación al proveedor.

## Public Key

La `VITE_MERCADOPAGO_SANDBOX_PUBLIC_KEY` se compila en el frontend porque es una
credencial pública. Su correspondencia autoritativa debe confirmarse en Mercado
Pago → Credenciales de prueba → Public Key de la aplicación sandbox; el Access
Token permanece únicamente server-side y nunca se incluye en el bundle.

No se ejecutó tokenización, `/preapproval`, webhook financiero, suscripción ni
cancelación en esta preparación.
