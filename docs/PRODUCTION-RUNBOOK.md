# Production Runbook

Runbook operativo para Austral Automatizaciones. No contiene credenciales ni sustituye las validaciones de seguridad del servidor. El procedimiento detallado de backups está en [docs/BACKUP-DISASTER-RECOVERY.md](./BACKUP-DISASTER-RECOVERY.md).

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

Consultar el procedimiento completo en [docs/BACKUP-DISASTER-RECOVERY.md](./BACKUP-DISASTER-RECOVERY.md). Antes del primer cliente, el responsable debe confirmar en Supabase el plan, backup administrado/PITR, retención y último backup de cada proyecto. La organización actualmente figura en plan Free; no asumir daily backups ni PITR sin verificación en Dashboard.

1. Para producción, no ejecutar comandos destructivos ni restaurar sobre el mismo proyecto. Crear un proyecto destino aislado y registrar ref, región, ventana y aprobación.
2. Programar dumps lógicos cifrados desde un entorno privado con Supabase CLI/`pg_dump`, fuera del repositorio. No almacenar service keys, contraseñas ni dumps en Git.
3. Respaldar por separado Auth settings/usuarios (sin contraseñas), Storage objects/policies, Edge Functions/configuración, secretos por nombre y ajustes de Realtime.
4. Restaurar primero esquema/migraciones y luego datos; verificar RLS, RPC, Auth, Storage y funciones antes de cualquier tráfico.
5. Ejecutar smoke público/autenticado y comprobar aislamiento multi-tenant. Documentar checksum, duración, RPO/RTO y rollback.
6. En QA, usar sólo `node --env-file=.env.e2e.local scripts/qa-backup-restore.mjs --dry-run` y `--restore-test` con `E2E_ALLOW_QA_RESTORE=1`; el script rechaza el ref productivo y elige únicamente datos `E2E_QA_`.

Los backups de DB no contienen objetos Storage; la clonación administrada también requiere reconfigurar manualmente Auth settings, API keys, Edge Functions, Realtime, extensiones y secretos. No probar una restauración sobre producción.

## 10. Monitoring y alertas

El diseño y los checks están en [docs/MONITORING-ALERTING.md](./MONITORING-ALERTING.md). `scripts/monitoring-health.mjs` solo ejecuta GET/OPTIONS y exige `MONITOR_ENVIRONMENT`, `MONITOR_SUPABASE_PROJECT_REF`, `MONITOR_SUPABASE_URL` y `MONITOR_BASE_URL` explícitos. Nunca toma el proyecto desde `.env` ni acepta un fallback silencioso.

- P0: caída de landing/login/reserva, Supabase inaccesible o Edge crítica en 5xx/timeout sostenido. Confirmar con una segunda fuente, congelar deploys y seguir rollback.
- P1: Auth anormal, error técnico de reserva, webhook inválido/pendiente, reconciliación stuck, Realtime general desconectado o backup fallido. Abrir incidente y buscar correlation id sin copiar secretos.
- P2: error aislado de frontend, 4xx esperado, sin disponibilidad, validación o conflicto de reserva. Registrar tendencia sin reintentos financieros.

En producción solo se permiten probes de lectura con aprobación explícita y `MONITOR_ALLOW_PRODUCTION_READONLY=1`. QA debe usar exclusivamente `cmsymmszlzikqpvfqjre`; si el ref o la URL no coinciden, el guard aborta antes de iniciar.

## 11. Acciones manuales pendientes

- Responsable de Supabase: plan/retención de backups, PITR, secretos y logs.
- Responsable de Cloudflare: deployment, dominio y rollback.
- Responsable de billing: credenciales sandbox/producción, webhook y conciliación.
- Responsable de WhatsApp: Evolution, n8n, shadow y activación productiva.
- Responsable comercial/legal: precios, trial, privacidad, términos, cancelación y soporte.
