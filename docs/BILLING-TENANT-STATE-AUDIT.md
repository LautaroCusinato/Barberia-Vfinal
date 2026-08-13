# Billing tenant state audit

## Contrato observado

El portal de facturación consulta en paralelo:

1. `GET /functions/v1/billing-api/status` → `get_billing_portal`.
2. `rpc('get_billing_catalog')`.

Cuando un negocio recién creado todavía no tiene una fila en `saas_suscripciones`, el RPC devuelve `P0002`; `billing-api` lo expone como `409` con `code=subscription_missing`. Es un estado comercial válido, separado de un error técnico.

## Presentación frontend

`src/pages/Billing.jsx` clasifica `subscription_missing` mediante `src/lib/runtimeStability.js` y mantiene el catálogo visible. No muestra valores inventados: plan, trial, vencimiento e importe quedan sin datos hasta que el onboarding cree la suscripción.

Los proveedores se muestran en un bloque independiente. Si la cuenta no tiene proveedor habilitado, se informa que los pagos aún no están habilitados y no se crea checkout. Un fallo real del portal o del catálogo sigue mostrando error técnico sanitizado.

## Matriz QA y evidencia de ejecución

| Caso | Resultado esperado |
| --- | --- |
| tenant nuevo / subscription missing | Estado informativo, sin banner técnico |
| trialing | Plan, trial y vencimiento provenientes del portal |
| active | Estado activo y renovación real |
| provider disabled | Bloque separado, checkout deshabilitado |
| precio externo ausente | Plan visible, CTA deshabilitado y explicación |
| backend 500 | Error técnico con retry, sin datos falsos |
| 401/403 | Sesión/permisos inválidos, sin filtrar detalles internos |
| Tenant A/B | Cada portal y catálogo permanecen aislados |

La validación estática y los contratos existentes pasan. La suite autenticada se ejecutó sólo contra QA, sin pagos ni checkouts: no pudo completar los casos porque faltan los usuarios QA `e2e_qa_unassigned@e2e-qa.invalid` y `e2e_qa_owner_a@e2e-qa.invalid`. No se ejecutaron pagos, checkouts, Mercado Pago productivo ni mutaciones sobre Barbería Central o Barbería Nueva. El catálogo y el estado `subscription_missing` no se consideran una caída técnica; se deben repetir los casos de billing una vez restaurados los fixtures QA.
