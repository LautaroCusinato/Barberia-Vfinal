# Backup y Disaster Recovery

Estado de esta etapa: **QA validado; producción pendiente de habilitar un backup operativo verificable**.

Este documento aplica los guardrails de **Austral SaaS Architecture**: ref de proyecto explícito, separación de entornos, restauraciones idempotentes y reversibles, y ningún secreto en Git. Austral Design System sólo se aplica a la evidencia de QA (fixtures identificables, sin datos reales); no se modificó ninguna pantalla.

## Decisión ejecutiva

El proyecto QA (`cmsymmszlzikqpvfqjre`) está aislado y la restauración controlada de fixtures pasó. El proyecto productivo (`ssagttjdgtypxjcgdnrw`) no fue modificado ni restaurado.

La organización de Supabase actualmente figura en plan **Free**. No se debe asumir retención de backups diarios administrados ni PITR hasta confirmarlo en el Dashboard del proyecto. La documentación oficial indica que los backups diarios administrados son una capacidad de planes pagos y que, en Free, se recomienda generar dumps lógicos con la CLI. [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)

Por lo tanto, el gate de RC1 para backups/PITR queda **pendiente operativo**, no por un fallo de la aplicación. La decisión READY requiere que el responsable confirme retención, RPO/RTO y una restauración en un proyecto separado.

## Auditoría de entornos

| Área | QA `cmsymmszlzikqpvfqjre` | Producción `ssagttjdgtypxjcgdnrw` | Implicación |
|---|---|---|---|
| Estado del proyecto | ACTIVE_HEALTHY, región São Paulo | ACTIVE_HEALTHY, región us-west-2 | Ref y región se verifican antes de operar |
| Plan/backup administrado | Organización Free; backup/PITR no confirmado en Dashboard | Organización Free; backup/PITR no confirmado en Dashboard | Requiere confirmación manual y/o dump lógico |
| Dump lógico automatizado | No configurado; CLI/`pg_dump` no están instalados localmente | No configurado | Ejecutar fuera del repo en CI/servidor privado |
| Esquema | 51 tablas públicas, 42 migraciones desplegadas | 51 tablas públicas, 44 migraciones desplegadas | QA reproduce migraciones permitidas; producción conserva dos integraciones que QA excluye |
| Auth | 12 usuarios sintéticos `.invalid`, confirmados | No auditado ni exportado | No copiar usuarios ni contraseñas reales |
| Storage | Bucket `tenant-logos`, sin objetos en la auditoría | No inspeccionado | Un backup de DB no incluye objetos de Storage |
| Edge Functions | Sólo `billing-api` mock, JWT obligatorio | `billing-api`, `billing-webhooks`, `billing-jobs` | Código versionado; despliegue, settings y secretos son configuración aparte |
| Proveedores | Mercado Pago/PayPal/n8n/Evolution/WhatsApp desconectados | No tocado | No se ejecutaron acciones externas |

La lista de extensiones PostgreSQL observada fue equivalente en ambos proyectos (pgcrypto, btree_gist, pg_stat_statements, supabase_vault, uuid-ossp y plpgsql). Los advisors existentes no se modificaron porque no pertenecen a este alcance.

## Alcance del backup lógico QA

El script `scripts/qa-backup-restore.mjs` implementa un snapshot lógico **exclusivo de QA** en JSON, fuera del repositorio:

- Requiere `E2E_REAL_SUPABASE=1`, `E2E_ENVIRONMENT=qa|sandbox`, el ref QA exacto, URL coincidente y `E2E_TEST_PREFIX=E2E_QA_`.
- Rechaza el ref productivo, rutas dentro del repositorio/`docs`/`.git` y secretos de proveedores externos.
- Requiere `E2E_ALLOW_QA_RESTORE=1` para la prueba de restauración.
- Incluye sólo tenants, filas tenant-scoped, relaciones CRM, metadatos mínimos de usuarios QA y nombres de objetos Storage con prefijo QA.
- Nunca guarda contraseñas, service keys, JWT, cookies, headers ni tokens externos.
- `--dry-run` no muta datos; `--backup` crea `snapshot.json` y `MANIFEST.json` con SHA-256; `--restore-test` muta un cliente QA, lo restaura en `finally` y verifica integridad/RLS.
- No es un dump PostgreSQL completo: no sustituye roles, extensiones, funciones, migraciones, Auth settings, Storage policies, Edge Functions, secretos ni configuración de Cloudflare.

Comandos, usando `.env.e2e.local` ignorado por Git:

```text
node --env-file=.env.e2e.local scripts/qa-backup-restore.mjs --dry-run
node --env-file=.env.e2e.local scripts/qa-backup-restore.mjs --backup
E2E_ALLOW_QA_RESTORE=1 node --env-file=.env.e2e.local scripts/qa-backup-restore.mjs --restore-test
```

En PowerShell, `E2E_ALLOW_QA_RESTORE=1` debe cargarse mediante un archivo temporal de entorno o una variable de proceso; nunca se debe pegar una credencial en el chat.

## Estrategia de producción recomendada

### Base de datos

En el servidor privado o CI, instalar Supabase CLI, Docker y `psql`. Ejecutar dumps con una conexión privada y sin exponer la contraseña:

```text
supabase db dump --db-url "$SUPABASE_DB_URL" -f schema.sql
supabase db dump --db-url "$SUPABASE_DB_URL" --data-only -f data.sql
```

Separar roles, esquema y datos cuando el procedimiento lo requiera. Cifrar en reposo, transferir por canal privado y verificar SHA-256. La guía oficial describe el flujo CLI de backup/restore y el uso de `pg_dump`/`psql`. [Backup and Restore using the Supabase CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

Retención inicial propuesta: 7 diarios, 4 semanales y 3 mensuales, con al menos una copia fuera del servidor. El RPO con sólo un dump diario puede llegar a 24 horas; no se debe presentar como garantía hasta medirlo.

### PITR y restauración administrada

El responsable debe revisar en cada proyecto **Database → Backups/PITR** el plan, retención y fecha del último backup. PITR es un add-on pago; si se habilita, documentar ventana, costo, responsable y una restauración a un proyecto nuevo. La restauración PITR implica downtime y debe ensayarse fuera de producción. [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)

La clonación a un proyecto nuevo puede incluir DB/schema/Auth data en planes con backups físicos, pero Storage objects, Edge Functions, Auth settings/API keys, Realtime settings y extensiones requieren reconfiguración manual. [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)

### Auth

No se exportan contraseñas. Para un restore administrado, verificar que los usuarios/Auth data queden en el proyecto destino y reconfigurar manualmente URLs, proveedores, SMTP y plantillas. Para el plan Free, documentar la limitación de recuperación de usuarios antes de vender el servicio.

### Storage

Los backups de base de datos no contienen los objetos de Storage. La estrategia debe copiar objetos de cada bucket a almacenamiento privado cifrado, conservando bucket, path, MIME, tamaño y checksum. Restaurar primero buckets/policies y luego objetos; no convertir un bucket privado en público durante una prueba.

### Edge Functions y secretos

Versionar el código de funciones y un inventario de nombres de secretos/configuración, nunca sus valores. Tras restaurar, desplegar funciones desde la versión fijada, revalidar `verify_jwt`, CORS y endpoints, y cargar secretos en Supabase Secrets. QA sólo tiene `billing-api` mock; las funciones productivas de billing no se copiaron ni desplegaron en QA.

### GitHub, Cloudflare y servicios privados

GitHub es la fuente de migraciones y código. Cloudflare Pages, dominio, DNS y variables de build deben verificarse por separado; no están contenidos en un dump de DB. El script privado `ops/server/saas-backup.sh` cubre artefactos de n8n/Evolution del servidor, pero no se ejecutó durante esta etapa y no se debe usar para operar Supabase.

## RPO/RTO propuestos

| Servicio | Objetivo inicial | Cómo se valida |
|---|---|---|
| DB con dump diario | RPO ≤ 24 h; RTO 2–4 h orientativo | Restore medido a proyecto QA nuevo |
| DB con PITR habilitado | RPO de minutos/segundos según plan | Restore PITR medido y documentado |
| Auth/Storage/Functions | Recuperación coordinada | Checklist manual y smoke autenticado |

Los valores son objetivos de diseño, no garantías actuales.

## Evidencia QA ejecutada

- Guards anti-producción: **OK**; ref usado únicamente `cmsymmszlzikqpvfqjre`.
- Dry-run: **OK**, 2 tenants, 12 usuarios, 1 bucket, 17 grupos de tablas; sin mutaciones.
- Restore controlado: **OK**. Se modificó y restauró un único cliente QA (`E2E_QA_`).
- Conteos post-restore: servicios 2, barberos 2, horarios 2, bloqueos 5, clientes 2, turnos 4, config 6, suscripciones 2, integraciones 2 y CRM negocios 2.
- Relaciones de turnos: **OK**, 4 turnos sin cruces tenant.
- RLS autenticado Tenant A/B: **OK**, cada owner sólo ve sus filas.
- Proveedores externos: **no contactados**.

## Checklist antes de declarar READY

1. Owner confirma plan y retención de backups en producción y QA.
2. Owner decide si habilita PITR pago; registrar costo y RPO/RTO.
3. Instalar CLI/Docker/psql en un entorno privado y programar dumps cifrados.
4. Configurar almacenamiento off-site y alertas de fallo del backup.
5. Ejecutar restore a un proyecto QA nuevo, incluyendo Auth, Storage, funciones y secrets por canales separados.
6. Ejecutar smoke público/autenticado y verificar aislamiento.
7. Registrar fecha, duración, checksum, responsable y resultado del restore.

Hasta completar estos puntos, el software puede continuar en QA, pero **no se debe marcar RC1 READY operativo**.
