# Production Runbook

Runbook operativo para Austral Automatizaciones. No contiene credenciales ni permite sustituir las validaciones de seguridad del servidor.

## 1. Verificación previa a un deploy

1. Confirmar que el commit está en `main`, que el worktree está limpio y que no contiene `.env*` ni secretos.
2. Ejecutar `npm run lint`, `npm test`, `npm run build`, la suite pública y la suite autenticada QA.
3. Ejecutar `git diff --check` y `node scripts/scan-secrets.mjs`.
4. Confirmar que las migraciones previstas son aditivas, idempotentes y tienen rollback documentado.
5. Confirmar que ningún cambio apunta al ref productivo desde los tests.

## 2. Verificar Cloudflare Pages

1. Revisar en Cloudflare Pages que el deployment de `main` esté en estado exitoso.
2. Comprobar HTTP 200 en `/`, `/para/barberia`, `/registro` y una ruta de reserva pública.
3. Comprobar recarga directa de esas rutas y ausencia de errores de consola.
4. Confirmar que el dominio personalizado y DNS no fueron cambiados por el deploy.

## 3. Verificar Supabase

1. Confirmar visualmente el proyecto y región antes de ejecutar cualquier operación.
2. Revisar migraciones aplicadas y diferencias de esquema.
3. Revisar logs de Auth, PostgREST, RPC y Edge Functions sin copiar tokens, cookies ni headers.
4. Validar RLS y aislamiento por tenant con usuarios de QA; no usar `service_role` desde el navegador.
5. Confirmar que los secretos sólo existan en Edge Function Secrets o el entorno privado correspondiente.

## 4. Rollback

1. Detener el deploy o el cambio que presenta errores y conservar el commit fallido.
2. Seleccionar el último commit verificado en GitHub/Cloudflare; no hacer force push.
3. Desplegar ese commit en preview y repetir smoke tests públicos y autenticados.
4. Promover el rollback sólo con aprobación del responsable.
5. Si hubo una migración, ejecutar únicamente su reversión documentada; nunca borrar datos manualmente para “deshacer” una aplicación.
6. Verificar HTTP 200, Auth, reservas y aislamiento después del rollback.

## 5. Ante errores de aplicación

- Congelar cambios y no reintentar operaciones financieras a ciegas.
- Registrar hora, ruta, tenant afectado y mensaje sanitizado; no registrar secretos ni datos de clientes.
- Distinguir error de frontend, Auth, RLS, RPC, Edge Function o proveedor externo.
- Revisar primero el último deployment y los logs del servicio afectado.
- Escalar si el error implica cruce de tenant, permisos, reservas duplicadas, billing o webhook no validado.

## 6. Suspender un tenant

Usar sólo el flujo administrativo existente y con un usuario `platform owner/admin`. Confirmar tenant, motivo y auditoría antes de aplicar. Verificar que la suspensión no altere otros tenants y que el acceso muestre un estado claro. No modificar tablas directamente desde el cliente.

## 7. Billing

- Mantener el proveedor deshabilitado hasta confirmar credenciales, entorno, plan, webhook firmado, reconciliación e idempotencia.
- No activar una suscripción por la URL de retorno.
- Ante un webhook dudoso, conservar el estado interno y reconciliar mediante backend autorizado.
- No probar con dinero real ni mezclar cuentas, tokens o planes de producción y sandbox.

## 8. WhatsApp/Evolution

- No activar workflows productivos durante una prueba.
- Verificar instancia, tenant, número canónico, modo shadow, logs sanitizados y rollback.
- Confirmar explícitamente que un ensayo no envía mensajes reales.

## 9. Backups y restauración

Antes del primer cliente, confirmar en Supabase el backup/PITR disponible, retención y responsable. Ejecutar una restauración en un proyecto separado o entorno de prueba y verificar Auth, RLS, RPC, Storage y datos tenant-scoped. No probar restauraciones sobre producción.

## 10. Acciones manuales pendientes

- Responsable de Supabase: backups/PITR, secretos y logs.
- Responsable de Cloudflare: deployment, dominio y rollback.
- Responsable de billing: credenciales sandbox/producción, webhook y conciliación.
- Responsable de WhatsApp: Evolution, n8n, shadow y activación productiva.
- Responsable comercial/legal: precios, trial, privacidad, términos, cancelación y soporte.
