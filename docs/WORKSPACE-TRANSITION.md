# Transición de workspace después del onboarding

## Diagnóstico

El RPC de onboarding ya terminaba correctamente la creación del tenant y de la membresía. El flash ocurría después: `OnboardingWizard` navegaba a `/`, `Root` resolvía la membresía y `App` montaba el shell de negocio inmediatamente. Mientras las consultas iniciales todavía estaban pendientes, `App` mostraba sidebar, encabezado y skeletons de las páginas del panel. No era una pantalla de datos incorrectos, pero sí una transición visual incoherente.

## Cambio aplicado

- El onboarding persiste inmediatamente la preferencia `business + tenantId` usando el almacenamiento de workspace existente y marca una transición de sesión de corta duración.
- `Root` muestra `WorkspacePreparing` mientras confirma membresía y workspace; el marcador se limpia al terminar esa resolución.
- `App` vuelve a mostrar `WorkspacePreparing` durante el bootstrap de un tenant nuevo o al cambiar de workspace. El shell no aparece hasta que los datos base de Resumen/Agenda y sus dependencias iniciales están coherentes.
- La consulta de pagos continúa en paralelo y no bloquea el primer render del panel; se mantiene disponible para Facturación/Estadísticas cuando termina.
- El estado es accesible (`role=status`, `aria-live`, `aria-busy`), compatible con safe areas móviles y reduced motion.

## Contratos preservados

No se modificaron Supabase, RPC, RLS, billing, reservas, WhatsApp, n8n, Evolution ni la resolución de tenant. La preferencia se revalida contra `barberia_members` antes de restaurarse y no contiene tokens ni datos sensibles.

## Verificación

El verificador `scripts/verify-workspace-transition.mjs` cubre persistencia, resolución, guard por tenant, carga paralela, accesibilidad y estilos de la transición. Las pruebas completas de lint, test y build deben ejecutarse antes de publicar.
