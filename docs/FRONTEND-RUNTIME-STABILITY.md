# Frontend runtime stability

Aplicación de **Austral SaaS Architecture** y **Austral Design System** sin modificar RLS, RPC, billing contracts, WhatsApp, n8n, Evolution ni producción.

## Cambio de pestaña / foreground

La causa no era un `window.location.reload()` del panel. El síntoma provenía de que el bootstrap de `Root` podía volver a entrar por un evento de sesión `SIGNED_IN`/recuperación del cliente al volver a foreground. `resolveSession` ponía `checking=true`; mientras eso ocurría, `Root` reemplazaba el `App` montado por `WorkspacePreparing`. Al terminar la consulta, el panel reaparecía y parecía una recarga completa.

La corrección mantiene el workspace montado cuando la sesión y el usuario ya fueron resueltos:

- revalidación de sesión/membership en background con ventana de 30 segundos;
- `visibilitychange` y `focus` sólo disparan stale-while-revalidate;
- `preserveUi=true` ante fallos transitorios de red o reconexión móvil;
- no se muestra `WorkspacePreparing` por volver a una pestaña;
- la selección `type + tenantId` se vuelve a validar contra Supabase;
- si la sesión realmente es nula, se limpian preferencias y datos de workspace;
- si la membership fue removida, el resolver ajusta el selector/estado sin conservar datos del tenant.

La ruta, la sección actual de `App`, las conversaciones y preferencias no se desmontan durante el refresh normal. Cada pestaña conserva su propia ruta y preferencia de workspace.

## Billing: estados comerciales

`get_billing_portal` devuelve `P0002`, traducido por `billing-api` a `409 subscription_missing`, cuando un tenant nuevo todavía no tiene fila en `saas_suscripciones`. Ese resultado no es una caída técnica.

Antes, `Billing` mostraba un banner rojo aunque el resto de la pantalla funcionara. Ahora:

- `subscription_missing` se muestra como estado comercial informativo;
- no se inventan plan, importe, trial ni vencimiento;
- el plan actual queda como “Sin suscripción activa”;
- el acceso queda “Pendiente de activar”;
- los pagos se muestran separados como no habilitados para esa cuenta;
- errores reales (5xx, 401, 403, catálogo fallido) siguen siendo errores técnicos y conservan retry/diagnóstico sanitizado.

El catálogo continúa proviniendo de `get_billing_catalog`; precios y monedas no se hardcodean. Los proveedores y precios externos no se habilitan desde el frontend.

## Cobertura local

`npm test` incluye `scripts/verify-runtime-stability.mjs`, que verifica la revalidación de background, la ausencia de reload en `Root`, la clasificación de `subscription_missing` y la separación de provider disabled.

La validación autenticada se ejecutó únicamente contra el proyecto QA configurado localmente. La suite pública completa pasó 72/72 en ejecución serial. La suite autenticada no pudo completar el recorrido porque el proyecto QA no contiene los fixtures de Auth requeridos: `e2e_qa_unassigned@e2e-qa.invalid` bloquea los escenarios de onboarding y `e2e_qa_owner_a@e2e-qa.invalid` bloquea el resto de la matriz serial. En la corrida completa hubo 24 casos iniciales pasados, 8 fallos por `unassigned` y 152 casos que no se ejecutaron; excluyendo los dos escenarios dependientes de esos usuarios, hubo 24 pasados, 8 fallos por `ownerA` y 144 no ejecutados. Esto es un prerrequisito de datos QA, no una regresión del cambio de runtime.

No se consultó producción ni se modificó ningún tenant productivo durante esta corrección. Para cerrar la matriz autenticada hay que crear/restaurar los usuarios QA definidos en `docs/QA-SANDBOX.md` y repetir Playwright sin cambiar el código de producto.

## Pendientes manuales

- Ejecutar la matriz Playwright autenticada en QA con un tenant `E2E_QA_` nuevo.
- Confirmar en DevTools que `visibilitychange` no dispara remount y que los requests de revalidación no se duplican.
- Confirmar en QA los estados `trialing`, `active`, `provider disabled`, `subscription_missing`, 401/403/500 y Tenant A/B.

## Clasificación de hallazgos

- P0: ninguno.
- P1: ninguno en el código modificado; la ejecución autenticada queda bloqueada por fixtures QA ausentes.
- P2: completar los usuarios QA y repetir la matriz; no requiere cambios de producción.
- P3: instrumentar métricas de remount/request en una sesión real de dispositivo cuando QA esté disponible.
