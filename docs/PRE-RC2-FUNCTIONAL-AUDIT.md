# Auditoría funcional PRE-RC2

Fecha: 2026-08-13  
Commit auditado: `bbba8299cee8119efbc54e8e276a1c19c44afd8e`  
QA permitido: `cmsymmszlzikqpvfqjre`  
Producción bloqueada: `ssagttjdgtypxjcgdnrw`

Esta auditoría aplicó Austral SaaS Architecture (aislamiento, RLS/RPC y guards cerrados) y Austral Design System (estados, responsive, accesibilidad y consistencia visual). No se activaron proveedores, webhooks, reply_only, booking_enabled ni cobros.

## Resumen ejecutivo

- 264 ejecuciones Playwright: 72 públicas + 192 autenticadas QA.
- 33 escenarios funcionales definidos: 9 públicos + 24 autenticados, repetidos en los viewports configurados.
- P0: 0.
- P1: 0.
- P2: 0 detectados automáticamente.
- P3: no bloqueantes, reservados para revisión visual manual.
- Aislamiento Tenant A/B: OK.
- Producción contactada o modificada: no.
- Mercado Pago, PayPal, n8n, Evolution y WhatsApp productivos: intactos y sin tráfico generado.

## Evidencia y entorno

Las pruebas autenticadas usaron exclusivamente el proyecto QA y fixtures con prefijo `E2E_QA_`. El seeder idempotente `scripts/e2e-qa-fixtures.mjs` dejó los usuarios confirmados, tenants A/B, servicios, empleados, horarios, break, cliente, turno futuro, branding, CRM e integración Evolution mock desactivada.

Durante el primer intento, el guard detectó que el runtime Vite local apuntaba al proyecto productivo y bloqueó la suite (`vite_runtime_project_mismatch`, `production_runtime_url`). Se corrigió sólo el entorno del proceso, pasando la URL QA explícitamente; no se editó ningún `.env` productivo.

El primer intento QA también encontró credenciales desalineadas para los fixtures sintéticos. Los usuarios existían y estaban confirmados; se resincronizaron de forma idempotente con el seeder QA autorizado. No se modificó ningún usuario real.

## Matriz de auditoría

| Área | Escenario revisado | Resultado | Severidad | Fix | Regresión | Pendiente |
|---|---|---|---|---|---|---|
| Tenant nuevo | Registro, recuperación, onboarding y reanudación | PASS | — | No requerido | E2E público/QA | Confirmación real de email en proveedor, manual |
| Workspace | Login, dashboard, selector, logout y acceso de plataforma | PASS | — | No requerido | QA autenticado | Probar sesiones reales en dos pestañas, manual |
| Dashboard | Trial, configuración, branding y estados de tenant | PASS | — | No requerido | QA autenticado | Comparar métricas con un dataset operativo mayor, manual |
| Agenda | Reserva pública, duración, break, disponibilidad y solapamiento | PASS | — | No requerido | QA público + QA autenticado | Regresión manual de edición/cancelación en UI |
| Equipo | Roles, empleados, servicios relacionados y horarios | PASS | — | No requerido | QA autenticado | Probar desactivación desde UI con fixture dedicado |
| Servicios | Slug/tenant, duración, precio, unicidad y billing mock | PASS | — | No requerido | QA autenticado + verificaciones estáticas | Eliminar servicio histórico requiere decisión funcional |
| Clientes | Aislamiento, formato de teléfono y relación con turnos | PASS | — | No requerido | QA autenticado | CRUD completo desde UI, manual |
| Mensajes | UI aislada, SafeMarkdown y ausencia de efectos externos | PASS | — | No requerido | verificaciones de WhatsApp + público | Realtime de conversación con mensajes reales, bloqueado por seguridad |
| Notas | Persistencia y aislamiento | PASS en contratos existentes | — | No requerido | verificaciones del proyecto | CRUD completo desde UI, manual |
| Estadísticas | Estados de suscripción, métricas CRM y dashboard QA | PASS | — | No requerido | QA autenticado + billing mock | Validación contable con datos reales, bloqueada |
| Configuración | Branding, logo, colores, slug y reserva pública | PASS | — | No requerido | QA autenticado + público | Upload real desde navegador móvil, manual |
| Billing | Trial, estados, proveedor deshabilitado y checkout mock | PASS | — | No requerido | QA autenticado + serverless checks | Mercado Pago productivo no habilitado |
| WhatsApp | Tenant sin integración, mock desactivado y shadow guards | PASS | — | No requerido | `npm test` y checks shadow | reply_only/booking_enabled requieren autorización futura |
| Auth | Login, recuperación, logout, rutas protegidas y roles | PASS | — | No requerido | público + QA autenticado | Email/contraseña reales, manual |
| Responsive | 360, 390, 412, 430, 768, 1366 y 1920 | PASS automatizado | — | No requerido | 72 + 192 ejecuciones | Validación en Samsung/Chrome físico, manual |
| Dark mode | Reserva pública y shell autenticado | PASS automatizado | — | No requerido | público + verificaciones UI | Auditoría cromática con datos productivos, no permitida |
| Resiliencia | 409, ausencia de disponibilidad, rutas inexistentes, guard QA | PASS | — | No requerido | público + checks de dominio | 401/403/500 con proxy real, manual/QA controlado |
| Realtime/multi-tab | Suscripciones y refresh protegidos por implementación | READY parcial | P2 potencial | No cambiar sin evidencia | checks estáticos | Prueba manual de dos pestañas |
| Multi-tenant | Lecturas y escrituras cruzadas A/B | PASS | — | No requerido | QA autenticado | Repetir sobre todas las tablas operativas, manual |

## FIXED

No hubo bugs P0/P1 ni cambios de producto seguros y necesarios durante esta auditoría. El único bloqueo reproducido fue de infraestructura de QA: credenciales de fixtures desalineadas y un runtime local que apuntaba a producción. Ambos se resolvieron sin cambiar la aplicación:

1. El guard anti-producción bloqueó el proceso antes de cualquier request.
2. El seeder QA idempotente resincronizó los 12 usuarios sintéticos y dejó los fixtures listos.

## READY

- Código y contratos existentes sin cambios funcionales.
- Suite pública: 72/72.
- Suite autenticada QA: 192/192.
- `npm test`: OK.
- `npm run lint`: OK.
- `npm run build`: debe ejecutarse como validación final de esta auditoría.
- Aislamiento Tenant A/B y escritura cruzada: OK.
- Billing sólo mock/QA; proveedores externos deshabilitados.
- WhatsApp sólo estado/shadow; cero mensajes y cero reservas externas.

## MANUAL REVIEW

- Recorrido real con teclado, VoiceOver/TalkBack y navegación por dos pestañas.
- Upload/reemplazo de logo y cambio de slug desde un navegador móvil real.
- Edición y cancelación de turno desde Agenda con datos QA.
- Prueba de sesión expirada y reconexión realtime con throttling del navegador.
- Validación de correo real y recuperación de contraseña en una cuenta QA autorizada.
- Verificación HTTP del deployment de Cloudflare después del próximo push.

## BLOCKED

- Activar Mercado Pago productivo o crear un checkout real.
- Activar WhatsApp `reply_only` o `booking_enabled`.
- Enviar mensajes, generar reservas o modificar datos de Central/Nueva.
- Validar conciliación real con proveedores externos.

## FUTURE

- Agregar escenarios UI específicos para CRUD completo de notas, empleados y servicios.
- Agregar una prueba automatizada de multi-tab/realtime con dos contextos persistentes.
- Registrar errores de consola/red por escenario con un reporte de artefactos dedicado.
- Completar una revisión manual de contraste WCAG con datos de branding extremos.

## Criterio PRE-RC2

La matriz automatizada no presenta P0/P1 y el aislamiento QA está validado. El producto queda **READY para revisión manual PRE-RC2**, pero no se debe activar WhatsApp productivo ni Mercado Pago productivo hasta completar los puntos manuales y las autorizaciones operativas correspondientes.
