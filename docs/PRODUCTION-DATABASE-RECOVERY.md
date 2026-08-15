# Production database backup / restore validation

Estado: **backup cifrado y restore temporal validados; migración CRM pendiente de aprobación**.

Este procedimiento aplica Austral SaaS Architecture: ref explícito, separación estricta de entornos, restauración reversible y ningún secreto en Git. No modifica el producto ni activa proveedores.

## Alcance y guardas

- Proyecto auditado: producción `ssagttjdgtypxjcgdnrw`.
- Proyecto QA: `cmsymmszlzikqpvfqjre` (no utilizado para esta operación).
- Migración `20260815090000_crm_sales_infrastructure.sql`: **no aplicada**.
- No se escribieron datos en producción ni QA.
- El restore se ejecutó en PostgreSQL 17 temporal, con red Docker `internal`, sin puertos publicados, sin integraciones externas y con límites de 1 CPU / 2 GiB.
- El stack original `/home/lautaro/mati-bot` no se reinició ni modificó.

## Backup

Directorio privado (fuera del repositorio):

`/home/lautaro/backups/supabase/prod-pre-crm-sales-20260815-172708Z/`

El archivo cifrado conservado es:

`prod-pre-crm-sales-20260815-172708Z.tar.gz.gpg` (permisos `600`)

SHA-256 del archivo cifrado:

`61b466b85b20f1942de6338e7f0aa65dbd9faf65faed382ab6ad36fc5a1085f4`

Los dumps intermedios fueron verificados y se conservaron con permisos `600` durante la validación. Tras confirmar el descifrado y el restore, deben eliminarse del servidor para que quede como copia operativa únicamente el archivo GPG y el manifest.

| Artefacto | SHA-256 |
| --- | --- |
| `roles.sql` | `2622d2d0d69f3406311b4b8e9322937a15f74dd3b9e32614b34c9bf76d922221` |
| `schema.sql` | `808d583dd12bf8d91228c62db9dd59ad2f4f473eedbe0f3aa40b8700b7549a7e` |
| `data.sql` | `ff266ab1c6e2996c965e64e851782db2e3cc6e9c1230271c96089d22dbfc6715` |
| `history_schema.sql` | `662f46d70b1aa04486f1dbd18ae17612737f68e6f1b747c131aaad530e35ab60` |
| `history_data.sql` | `94553d0b46f70c7e53ce5475d7288b844d500031b0793ca5892f659906e272d8` |

El manifest no contiene connection strings, contraseñas, tokens ni claves.

## Restore temporal

Stack: `austral-recovery-test`.

- Imagen: `postgres:17`.
- Contenedor: `austral-recovery-test-postgres`.
- Red: `austral-recovery-test-network`, `internal=true`.
- Puertos: ninguno publicado.
- Volumen: independiente del stack de producción.
- Integraciones: ninguna.

La imagen estándar no incluye la extensión administrada `supabase_vault`. Por eso se excluyeron del **copy de restore** únicamente la extensión/ACLs del esquema `vault`; los dumps originales no se alteraron. No había FKs públicas hacia `vault`. En un DR real de Supabase, Vault debe restaurarse mediante el mecanismo administrado correspondiente.

El dump de roles requirió omitir, sólo en la copia temporal, el `CREATE ROLE postgres` y las cláusulas `GRANTED BY supabase_admin`, incompatibles con un PostgreSQL aislado. El dump original permanece intacto.

## Validaciones

### Counts

Los counts de producción y restore coincidieron:

| Tabla | Producción | Restore |
| --- | ---: | ---: |
| `barberias` | 4 | 4 |
| `clientes` | 28 | 28 |
| `turnos` | 153 | 153 |
| `crm_negocios` | 11 | 11 |
| `crm_leads` | 8 | 8 |
| `crm_investigaciones` | 5 | 5 |
| `crm_actividades` | 8 | 8 |
| `crm_importaciones` | 2 | 2 |
| `crm_importacion_filas` | 7 | 7 |
| `crm_acciones` | 2 | 2 |
| `saas_suscripciones` | 4 | 4 |
| `saas_billing_events` | 3 | 3 |
| `saas_billing_webhook_events` | 0 | 0 |
| `platform_members` | 1 | 1 |

### Estructura y seguridad

Coincidieron producción y restore:

- 51 tablas públicas.
- 150 índices públicos.
- 80 policies RLS públicas.
- 42 triggers públicos.
- 264 funciones públicas.
- 23 tablas Auth y 8 tablas Storage.
- 1 trigger Auth y 4 triggers Storage.
- 17 funciones Storage.
- 30 roles restaurados.
- 44 filas de historial de migraciones.
- grants de tablas y rutinas.
- definiciones de policies, triggers, funciones y constraints (excepto Vault, explicado arriba).

Fingerprint no-Vault de constraints: `2cfdb7c293ecec0b3ec029574c6b9842` en ambos entornos. Las FKs no validadas son `0`. El único constraint `NOT VALID` restante es `realtime.messages.messages_payload_exclusive`, igual que producción; los constraints equivalentes de las particiones quedaron validados.

La lista de migraciones de producción no contiene `20260815090000_crm_sales_infrastructure`.

## RPO / RTO observado

- Fin del backup lógico: `2026-08-15T17:31:58Z`.
- Cifrado y prueba de descifrado confirmados por el responsable: `2026-08-15T17:41:16Z` (archivo `600`).
- Creación del contenedor temporal: `2026-08-15T17:46:00Z`.
- Validación final: `2026-08-15T17:57:04Z`.
- Ventana observada de restore + validación: **11m04s** desde la creación del contenedor hasta la validación final. Es una medición de esta prueba, no un SLO garantizado.
- RPO: el dump representa el estado leído durante la ventana `17:27:08Z–17:31:58Z`; no se debe presentar como RPO continuo. PITR/retención administrada siguen pendientes de confirmación en el plan de Supabase.

## Limpieza y rollback

Al finalizar la validación se detiene y elimina únicamente el proyecto Compose `austral-recovery-test`, su red y volumen temporales. No se toca ningún recurso de `/home/lautaro/mati-bot`.

Rollback de una futura migración CRM: conservar este backup cifrado, verificar el manifest/checksum, restaurar en un proyecto aislado y seguir el runbook de migraciones; nunca restaurar sobre producción ni borrar filas manualmente.

## Pendientes antes de CRM productivo

1. Confirmar en Supabase el plan, retención y/o PITR de producción.
2. Conservar el archivo GPG y el manifest en almacenamiento privado fuera del servidor, con una segunda copia cifrada.
3. Programar dumps cifrados y alertas de fallo.
4. Aprobar explícitamente la migración CRM y ejecutar su preflight contra el ref productivo.
5. Rotar la contraseña de la base productiva usada para esta prueba, ya que fue compartida fuera del entorno privado durante la preparación.

Hasta completar esos puntos, el estado es **CRM PRODUCTION MIGRATION READY FOR APPROVAL**, no aplicado.
