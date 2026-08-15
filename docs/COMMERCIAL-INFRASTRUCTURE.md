# Austral Commercial Infrastructure

## Alcance

Esta etapa deja preparado el CRM para que un Sales Agent opere con una sesión normal de Supabase Auth cuyo `user_id` figure en `platform_members` con rol `sales`, `admin` u `owner`. No hay service role en el navegador, no hay proveedores de envío y no se ejecuta outreach.

La migración `20260815090000_crm_sales_infrastructure.sql` es aditiva e idempotente. Debe aplicarse primero en QA (`cmsymmszlzikqpvfqjre`) y validarse antes de cualquier rollout productivo.

Estado de esta entrega: migración aplicada y validada únicamente en QA (`cmsymmszlzikqpvfqjre`) con TLS verificado. Producción no fue contactada ni modificada.

### Evidencia QA

`node scripts/verify-crm-sales-qa.mjs` ejecutó 30 checks con fixtures eliminables `E2E_QA_SALES_*`: normalizaciones, duplicados exactos, coincidencia probable por nombre+ciudad, `NO_MATCH`, DNC, preview sin writes, importación idempotente, cola `READY_TO_CONTACT`, actividad interna, permisos `sales` y rechazo de un usuario sin `platform_members`. El flujo fue limpiado al finalizar. Efectos externos: emails 0, WhatsApp 0, llamadas a Evolution 0, cambios n8n 0, checkouts 0 y escrituras producción 0.

## Contrato server-side

- `crm_normalize_*`: normalizadores deterministas para email, teléfono, dominio, Instagram, nombre y ciudad. Los valores originales se conservan.
- `crm_find_duplicate_candidates`: preview autoritativo con `EXACT_MATCH`, `LIKELY_MATCH` o `NO_MATCH`. `LIKELY_MATCH` nunca se combina automáticamente.
- `crm_upsert_researched_lead`: flujo `AUTH PLATFORM MEMBER → DNC → DEDUPE → NEGOCIO → LEAD → INVESTIGACIÓN → ACTIVIDAD`. Devuelve `blocked_dnc`, `needs_review`, `exact_match` o `created`.
- `crm_preview_import`: clasifica un lote sin writes y devuelve `new`, `exact_duplicate`, `likely_duplicate`, `dnc` e `invalid`.
- `crm_import_leads_batch`: importa hasta 500 filas con `idempotency_key`, aislamiento por `environment` y auditoría por fila.
- `get_crm_outreach_queue`: expone sólo leads `qualified + ready_to_contact`, verificados, con mensaje preparado y fuera de DNC.
- `record_crm_outreach_activity`: registra contacto, follow-up, respuesta, demo o trial en el historial interno. Nunca envía mensajes. Una respuesta entrante detiene follow-ups posteriores.

## DNC y entornos

`DO_NOT_CONTACT` tiene prioridad sobre deduplicación e importación. Un lead excluido no se reactiva ni genera un paralelo. Los entornos (`sandbox`, `demo`, `production`, `internal`) se mantienen separados; QA debe usar `E2E_QA_` y dominios `.invalid`.

## Flujo de importación

1. El usuario `sales` inicia sesión normalmente.
2. En `Plataforma → Negocios y leads` elige un CSV.
3. El parser local valida formato y el servidor ejecuta `crm_preview_import` sin writes.
4. La UI muestra el resumen y habilita la importación sólo cuando el preview server-side responde.
5. `crm_import_leads_batch` usa una clave idempotente estable; repetir el mismo lote devuelve el resultado anterior.

## Sesión del Sales Agent

El agente debe recibir una sesión autenticada de un usuario QA/producción autorizado por el administrador de plataforma. La sesión se usa únicamente contra el workspace de plataforma y nunca se le entrega `service_role`, claves de proveedor, cookies ni credenciales de otros usuarios. Si el agente no tiene `platform_members.role in ('sales','admin','owner')`, todas las funciones devuelven `42501`.

## Outreach controlado

La cola `Listos para contactar` es una bandeja de revisión. Permite registrar una actividad interna y conserva canal, resultado y notas. No contiene scheduler, webhook, Evolution, n8n ni botones de envío. Cualquier canal externo futuro deberá agregarse detrás de un endpoint server-side separado y una aprobación explícita.

## Rollout y rollback

- Aplicar y probar la migración en QA.
- Ejecutar tests de normalización, duplicados por teléfono/email/dominio/Instagram, nombre+ciudad, DNC, idempotencia y aislamiento.
- En producción, aplicar sólo después de revisar el diff y contar con backup reciente.
- El rollback operativo consiste en retirar el acceso del rol `sales` y volver al commit anterior; no se eliminan datos ni se reactivan leads.

No se contactaron clientes, no se enviaron mensajes y no se modificaron WhatsApp, billing, Mercado Pago, n8n, Evolution ni tenants reales.
