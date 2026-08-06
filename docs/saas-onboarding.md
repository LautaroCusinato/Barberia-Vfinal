# Onboarding self-service

## Flujo

1. `/registro` crea únicamente el usuario de Supabase Auth y guarda el nombre en los metadatos.
2. El email debe confirmarse antes de acceder al asistente.
3. `/onboarding` guarda el progreso en el navegador y registra pasos en Supabase.
4. `complete_self_service_onboarding` valida y crea tenant, owner, trial, configuración, CRM y auditoría en una transacción.
5. El panel muestra el checklist de primeros pasos y una guía manual de WhatsApp.

## Migraciones

- `20260807000000_self_service_onboarding.sql`: catálogo de verticales, país/moneda, sesiones/eventos/auditoría y RPCs.
- `20260807010000_onboarding_observability.sql`: registro automático de alta y evento de abandono.
- `20260807020000_localize_onboarding_catalog.sql`: etiquetas localizadas del catálogo.

Las RPCs de onboarding sólo tienen `EXECUTE` para `authenticated`; `anon` no puede ejecutarlas. No se exponen tablas de sesiones, eventos ni auditoría al navegador.

## Rollback seguro

El rollback recomendado es revertir el commit de frontend y volver a desplegar. Las tablas y funciones nuevas son aditivas y se pueden conservar sin afectar reservas ni WhatsApp; no se deben borrar porque contienen métricas. Si hubiera que desactivar el alta temporalmente, revocar el `EXECUTE` de `complete_self_service_onboarding` para `authenticated` y restaurarlo después de corregir el problema. No se toca ni se desactiva ningún workflow de WhatsApp.

## Variables de entorno

No se agregaron secretos ni variables nuevas. El frontend continúa usando únicamente `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`; nunca usa una service role key.
