# CRM comercial y piloto asistido

Esta etapa agrega la base operativa para prospectar con aprobación humana. No hace scraping, no llama proveedores externos y no envía email, WhatsApp ni mensajes.

## Datos y permisos

- `crm_negocios` y `crm_leads` conservan las columnas existentes y agregan `pipeline_stage`, `environment`, prioridad, score, razones, responsable, etiquetas y seguimiento.
- `crm_investigaciones` guarda el contrato estructurado de investigación (web, redes, Maps, servicios, horarios, WhatsApp, problemas, oportunidades y fuente).
- `crm_actividades`, `crm_notas`, `crm_adjuntos` y `crm_acciones` conservan historial, notas, adjuntos futuros y recordatorios internos.
- `crm_importaciones`, `crm_importacion_filas` y `crm_merge_log` permiten trazabilidad de CSV y combinaciones.
- `owner`, `admin`, `sales` y `automation` pueden operar el CRM; `support` y `readonly` sólo leen. La exportación masiva está limitada a owner/admin/sales.
- Los registros del CRM global sólo se exponen a `platform_members`; un miembro de un tenant no puede importar ni leer este CRM.

## Contratos seguros

- `import_crm_leads` valida máximo 500 filas, normaliza email/teléfono, rechaza fórmulas, usa una clave idempotente y registra errores/duplicados.
- `merge_crm_leads` mueve interacciones, notas, adjuntos, acciones y borradores antes de eliminar duplicados, y registra la operación.
- `calculate_crm_lead_score` calcula hasta 100 puntos desde señales declaradas y devuelve razones y recomendación. Cada cambio queda en `crm_actividades`.
- `set_crm_lead_stage` y `set_crm_lead_do_not_contact` centralizan las transiciones. DNC bloquea borradores y aprobaciones mediante RLS, RPC y trigger.
- `export_crm_leads` devuelve sólo campos comerciales necesarios y registra la exportación en `saas_audit_log`.
- `get_crm_pipeline_metrics` separa `sandbox`, `demo`, `production` e `internal`.

## Borradores y proveedores

`src/lib/commercialDraftProvider.js` define el contrato de proveedor y el modo `mock`. DeepSeek y proveedores futuros sólo se podrán conectar detrás de un endpoint privado con secretos fuera del navegador. La aprobación actual es interna y no dispara ningún webhook.

## CSV

La interfaz muestra columnas detectadas, vista previa y errores por fila. Los encabezados aceptan alias comunes en español e inglés. El teléfono permite formatos con `+` y se normaliza en la RPC; email se guarda en minúsculas. El límite es 2 MB/500 filas.

## Piloto futuro con cinco leads

Antes de usar datos reales hay que: aplicar la migración en un entorno controlado, crear cinco leads con consentimiento/base legal, completar investigación manual, revisar scores, probar exportación y DNC, preparar borradores y aprobarlos uno por uno. Recién después se podrá definir un canal sandbox y un endpoint de envío con autorización explícita; esta etapa no lo activa.
