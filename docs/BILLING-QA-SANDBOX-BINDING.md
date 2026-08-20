# Binding sandbox QA de billing

## Tenant elegido

El tenant técnico sandbox QA es `E2E_QA_BARBERIA_A` (ID QA `1`). Es un
fixture ficticio con prefijo `E2E_QA_`. `E2E_QA_BARBERIA_B` (ID QA `2`) queda
deliberadamente sin binding para validar el rechazo por aislamiento.

## Regla de autorización

El backend resuelve el scope únicamente desde:

`tenant autenticado → saas_billing_provider_bindings → proveedor + entorno`

No existe un `tenant_id` sandbox hardcodeado. El ID histórico 6 sólo permanece
en la ruta de reconciliación legacy y nunca autoriza un checkout.

## Estado inicial seguro

El binding QA se crea con:

- proveedor: `mercadopago`;
- entorno: `sandbox`;
- plan: `starter`;
- precio: Starter sandbox ARS 15.000 mensual;
- vendedor/aplicación: identidad TEST esperada;
- `activo=true`;
- `checkout_habilitado=false`;
- `external_plan_id=NULL`.

Por lo tanto, el scope sandbox puede resolverse, pero el checkout permanece
bloqueado hasta que exista un plan externo verificado y se autorice su
habilitación. No se crea ningún recurso en Mercado Pago en esta etapa.
