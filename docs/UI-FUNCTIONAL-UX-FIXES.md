# Correcciones funcionales y UX — Agenda, Billing, WhatsApp e invitaciones

## Diagnóstico

- **Agenda:** el estado se mostraba como un badge adicional dentro del encabezado de cada turno. En tarjetas angostas competía con el nombre del cliente y el servicio. Los popovers de notas y eliminación estaban dentro del stacking context de cada tarjeta, por lo que una tarjeta vecina podía pintarse por encima.
- **Billing:** el RPC de catálogo puede devolver `P0002` cuando la cuenta todavía no tiene suscripción. El frontend sólo clasificaba algunos errores de la API y terminaba mostrando un error técnico para un estado comercial válido. Además, el precio base del catálogo se mostraba como si fuera precio de checkout cuando no había precio externo configurado.
- **WhatsApp:** el toggle quedaba deshabilitado sin explicar si faltaba un plan, la integración o la verificación de billing. La activación no tenía una salida clara hacia el módulo correspondiente.
- **Colaboradores:** el flujo ya tenía RPC, persistencia, expiración, aceptación y enlace manual. La UI no mostraba estados históricos, no ofrecía selector de vencimiento y no protegía visualmente contra doble envío.

## Cambios realizados

- La tarjeta de Agenda conserva el estado en su `aria-label` y en el selector de estado, pero elimina el badge redundante del encabezado. Las acciones, edición, notas y eliminación no cambian.
- La tarjeta que tiene notas o confirmación de eliminación abierta recibe una capa de apilado explícita; los popovers mantienen el foco y quedan por encima de las tarjetas vecinas sin usar un overlay global.
- Billing clasifica `subscription_missing` y `P0002` como estado comercial. Los fallos técnicos muestran un mensaje genérico y seguro, sin exponer mensajes RPC.
- El catálogo distingue precio externo del proveedor seleccionado y referencia base del catálogo. No se convierte moneda ni se inventan importes; si no existe precio externo, el checkout permanece bloqueado.
- WhatsApp verifica `get_billing_portal` antes de permitir activación. Un estado bloqueado dirige a Facturación; un plan habilitado sin integración dirige a Configuración; un error de verificación falla cerrado.
- Invitaciones muestran creación con estado de guardado, vencimiento configurable (1/7/14/30 días), enlace manual explícito y estados pendiente/aceptada/vencida/cancelada. No se agregó envío automático de email.
- La pantalla de aceptación de invitaciones dejó de exponer errores técnicos crudos.

## Contratos preservados

No se modificaron Supabase, migraciones, RLS, RPC, Edge Functions, billing backend, Mercado Pago, WhatsApp, n8n, Evolution ni datos reales. Se reutilizan los contratos existentes y las protecciones de tenant.

## Validación

- `npm run lint` ✅
- `npm test` ✅
- `npm run build` ✅
- `git diff --check` y escaneo de secretos: ejecutar antes del commit/push.
- Playwright público y autenticado QA: ejecutar con el proyecto QA autorizado (`cmsymmszlzikqpvfqjre`) si el entorno local y sus fixtures están disponibles. Producción (`ssagttjdgtypxjcgdnrw`) queda fuera de alcance.
