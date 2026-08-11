# Monitoring y alertas

Estado: preparado para RC1, sin activar cuentas externas ni cambiar produccion.

## Alcance y limites

Esta etapa cubre disponibilidad HTTP, Supabase/Auth, Edge Functions, reservas, billing/webhooks, realtime, errores frontend, latencia y backups. Las consultas de produccion realizadas para la auditoria fueron exclusivamente de lectura sobre `ssagttjdgtypxjcgdnrw`; QA/E2E usa unicamente `cmsymmszlzikqpvfqjre`. No se enviaron reservas, pagos, webhooks ni mensajes.

## Auditoria actual

Ya existe:

- Logs administrados de Supabase para Edge, PostgREST, Auth, Postgres, Realtime, Storage y auditoria.
- `request_id`/`trace_id` y `x-correlation-id` en las funciones serverless compartidas.
- Eventos internos y auditoria (`saas_product_events` y `saas_audit_log`) para operaciones de producto; no deben confundirse con un sistema de alertas.
- Instrumentacion frontend en `src/lib/observability.js`: ruta, version, tenant sanitizado, correlation id, error y timestamp; actualmente es memoria local del navegador y consola solo en desarrollo.
- Error boundary y listeners globales para errores no capturados.

No existe aun un colector persistente de errores frontend, un dashboard operativo de monitoring, ni una cuenta externa de HTTP monitoring/alertas conectada al repositorio. Cloudflare Pages se verifica manualmente porque no hay un conector autorizado en este entorno.

### Evidencia de logs (ultimas 24 horas)

Los agregados sanitizados de Supabase muestran actividad y permiten construir alertas sin leer contenido privado:

- Produccion: 3.142 edge logs, 414 PostgREST, 115 Realtime, 103 Postgres, 36 Auth y 30 logs de funciones. En edge hubo 3.063 respuestas 200 y no se observaron respuestas 5xx en la muestra; p95 de origen para 200: 592,9 ms.
- QA: 27.311 edge logs, 2.699 Auth, 815 Postgres y 790 PostgREST. Hubo 2 respuestas 429 y 43 respuestas 409 esperables en escenarios E2E; no se interpretan automaticamente como incidentes de produccion.
- Los logs contienen claves de correlacion y tiempos de origen. Nunca se copian tokens, cookies, telefonos, nombres de clientes o bodies a la documentacion.

## SLOs V1 (provisionales y medibles)

Son objetivos iniciales, no garantias comerciales. Se revisan despues de 30 dias de trafico real y se excluyen mantenimientos anunciados.

| Senal | Objetivo V1 | Motivo y ventana |
| --- | --- | --- |
| Disponibilidad HTTP publica | >= 99,5% mensual (presupuesto aproximado: 3 h 39 min) | Un negocio necesita que reserva y acceso esten disponibles; el presupuesto evita alertar por un unico fallo transitorio. |
| 5xx frontend/Edge | < 1% durante 15 min y sin endpoint critico caido | Separa un incidente sostenido de errores aislados del proveedor. |
| Latencia publica | p95 < 1.000 ms durante 15 min | Umbral operativo razonable para calendario y reserva; se ajustara con medicion real. |
| Reserva tecnica | < 1% de errores tecnicos en 15 min, excluyendo sin disponibilidad, validacion y conflictos esperables | Distingue fallos de RPC/red de una decision legitima del usuario. |
| Billing/webhooks | 0 eventos firmados pendientes por mas de 5 min; 0 errores de firma/5xx sostenidos | Un evento no procesado puede dejar una suscripcion en estado incorrecto. Nunca activar por URL de retorno. |
| Realtime | reconexion automatica y sin desconexion general > 5 min | La agenda tiene fallback, pero una caida general debe investigarse. |
| Backups | ultima ejecucion verificada dentro de la ventana operativa acordada | Supabase Free no permite asumir PITR/backups diarios; el responsable debe confirmarlo. |

## Health checks no destructivos

`scripts/monitoring-health.mjs` solo hace GET/OPTIONS y exige variables explicitas; nunca carga `.env` como fallback:

- landing `/`;
- login `/ingresar`;
- reserva publica (slug explicito: en QA `e2e-qa-barberia-a`, en produccion `barberia-central`);
- `auth/v1/settings` de Supabase;
- OPTIONS de las Edge Functions criticas configuradas.

Ejemplo QA (valores publicos, sin secretos):

```powershell
$env:MONITOR_ENVIRONMENT='qa'
$env:MONITOR_SUPABASE_PROJECT_REF='cmsymmszlzikqpvfqjre'
$env:MONITOR_SUPABASE_URL='https://cmsymmszlzikqpvfqjre.supabase.co'
$env:MONITOR_BASE_URL='https://qa.example.invalid'
npm run monitor:health
```

Para produccion se requiere ademas `MONITOR_ALLOW_PRODUCTION_READONLY=1`, el ref productivo exacto y el dominio canonico `https://barberia.cuchitron.lat`. No ejecutar probes de produccion desde CI ni con fallback de `.env`; requieren aprobacion operativa explicita.

## Severidades y alertas

| Severidad | Alertar cuando | Primera accion |
| --- | --- | --- |
| P0 | landing/login/reserva caidos; Supabase inaccesible; Edge critica en 5xx sostenido; timeout general | Confirmar con un segundo check, congelar deploys y aplicar rollback/runbook si se confirma. |
| P1 | Auth anormal; RPC de reserva con error tecnico; firma/webhook invalido o pendiente; reconciliacion stuck; desconexion Realtime general; backup fallido; errores frontend repetidos | Abrir incidente, revisar correlation id y logs sanitizados, aislar componente y escalar. |
| P2 | error frontend aislado; latencia de una muestra; 4xx esperado; sin horarios disponibles; validacion o conflicto de reserva | Registrar tendencia y corregir en horario normal; no reintentar operaciones financieras a ciegas. |

Usar ventanas de 5/15 minutos, minimo tres muestras consecutivas para latencia/caidas, deduplicacion por `alert + project_ref + endpoint` y cooldown de 30 minutos. Asi no hay alert fatigue por un unico 4xx esperado o fixtures QA.

## Reservas, billing y webhooks

### WhatsApp shadow

El piloto debe emitir únicamente señales sanitizadas: `webhook_received`,
`tenant_resolved`, `tenant_resolution_failed`, `ai_success`, `ai_failure`,
`availability_success`, `availability_failure`, `duplicate_event`,
`shadow_completed`, `mutation_blocked` y `latency_ms`. `mutation_blocked` es P0;
resolución/IA/Supabase fallida sostenida es P1; duplicados, ausencia de
disponibilidad y validaciones esperables son P2. No se registran mensajes,
teléfonos completos, tokens, cookies ni payloads privados. La plantilla exige
`WHATSAPP_MODE=shadow` y no contiene envío a Evolution ni RPCs mutantes.

Las metricas deben separar `no_availability`, `validation`, `overlap_conflict` y errores tecnicos de RPC/red. Para billing separar checkout, webhook firmado, idempotencia, reconciliacion y estados stuck. El proveedor externo no se consulta desde el navegador; webhook valido y verificacion backend son la fuente de activacion. No se modifico logica de billing.

## Frontend

Los eventos sanitizados actuales incluyen `route`, `app_version`, `tenant_id` solo en forma permitida por la instrumentacion, `correlation_id`, `error_type` y timestamp. Esta prohibido enviar passwords, tokens, cookies, service_role, headers de autorizacion o contenido privado. Al no existir un sink persistente, la captura fuera del navegador sigue pendiente de una decision de proveedor.

## QA y simulaciones

Los guards centrales de `scripts/e2e-sandbox-guards.mjs` rechazan ref/URL productivo, exigen `E2E_REAL_SUPABASE=1`, prefijo `E2E_QA_`, claves QA y no permiten secretos de proveedores. `playwright.config.mjs`, el smoke autenticado y el preflight usan el guard antes de iniciar pruebas.

```powershell
npm run monitor:self-test
npm run monitor:health -- --mock=http_500
npm run monitor:health -- --mock=timeout
npm run monitor:health -- --mock=function_down
npm run monitor:health -- --mock=webhook_invalid
npm run monitor:health -- --mock=auth_failed
npm run monitor:health -- --mock=frontend_error
npm run monitor:health -- --mock=backup_failure
```

Las simulaciones son señales sinteticas, no trafico contra Supabase. `backup_failure` valida la severidad; el estado real de backups sigue siendo manual.

## Monitor externo recomendado

No se creo ninguna cuenta. Para V1 conviene UptimeRobot, Better Uptime o Better Stack en plan gratuito, con checks HTTP y alertas por email. Configuracion manual: crear cuenta con el responsable, agregar solo `/`, `/ingresar` y una ruta publica, intervalo de 5 minutos, dos contactos, sin query strings ni secretos, y apuntar a la pagina de estado del proveedor. Despues registrar aqui el ID del monitor y probar un incidente desde preview/QA. No configurar URLs de webhooks ni pagos como checks que generen POST.

## Dashboard interno

No se agrego una vista operativa: requeriria persistir señales y alertas, definir retencion/RLS y añadir una superficie que podria confundirse con auditoria de negocio. Para RC1 es mas seguro usar logs administrados + monitor HTTP externo y documentar el runbook; el dashboard queda para una etapa posterior.

## Procedimiento de incidente

1. Identificar entorno y `project_ref`; si no coincide con el permitido, detenerse.
2. Confirmar el alerta con health check y una segunda fuente.
3. Buscar `correlation_id`/`request_id` en logs sanitizados.
4. Clasificar P0/P1/P2 y seguir [PRODUCTION-RUNBOOK.md](./PRODUCTION-RUNBOOK.md).
5. No ejecutar reservas, pagos, reintentos de webhook ni cambios de RLS para probar.
6. Registrar causa, duracion, impacto y rollback; cerrar solo despues de un check verde.

Estado de salida: codigo y guards preparados; alertas externas, retencion de logs y validacion manual de backups/PITR siguen pendientes y mantienen RC1 en revision operativa.
