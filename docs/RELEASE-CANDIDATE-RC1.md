# Release Candidate RC1

Fecha de auditoría: 2026-08-11
Aplicación de referencia: **Austral SaaS Architecture** y **Austral Design System**
Proyecto QA autorizado: `cmsymmszlzikqpvfqjre`
Producción prohibida: `ssagttjdgtypxjcgdnrw`

## Decisión

**NOT READY para el primer piloto comercial real.**

No hay defectos P0 ni P1 de software abiertos. El bloqueo es operativo y deliberado: billing productivo, WhatsApp/Evolution productivo, backups, monitoring y revisión legal/comercial todavía requieren configuración y aprobación manual. RC1 no activa ninguno de esos servicios.

## Evidencia ejecutada

- Playwright: **192/192 passed** en Chromium (48 públicos + 144 autenticados QA).
- Viewports: 390×844, 360×800, 768×1024, 1366×768 y 1920×1080.
- `npm run lint`: OK.
- `npm test`: OK.
- `npm run build`: OK.
- `git diff --check`: OK.
- Secret scan: OK.
- QA preflight: OK.
- Cleanup QA dry-run: OK; 2 tenants y 12 usuarios ficticios.
- Tenant A/B: aislamiento verificado.
- Firefox/WebKit: no ejecutados; los navegadores no están instalados en este entorno.
- Lighthouse: no ejecutado; CLI/CDP no está disponible.

## Checklist de lanzamiento

| Área | Estado | Evidencia / bloqueo |
| --- | --- | --- |
| Producto y UX | READY | Flujos públicos y autenticados QA completos; sin P0/P1 de software. |
| Frontend | READY | Lint, build y matriz Chromium completos; sin overflow en la matriz. |
| Backend/RPC | READY en QA | Contratos y RPC cubiertos por la suite; falta verificación manual de producción. |
| Auth y recuperación | READY en QA | Registro, login, recuperación, logout, rutas protegidas y sesión cubiertos. |
| Multi-tenant/RLS | READY en QA | Aislamiento Tenant A/B y roles verificados; no se cambió RLS. |
| Billing | **CHECKOUT OFFLINE VALIDATED · PRODUCTION BLOCKED** | Flujo asociado con `card_token_id`, guards, idempotencia, webhook y mocks A-L implementados. No hay checkout ni cobro productivo; faltan secretos, plan, tenant piloto y autorización explícita. |
| WhatsApp/Evolution | **SHADOW READY · PENDING MANUAL CONFIG** | La plantilla shadow es fail-closed, no envía ni muta; faltan variables privadas de n8n y una prueba controlada sin tráfico real. El workflow legacy permanece intacto. |
| Backups | **PENDING MANUAL** | Confirmar backup/PITR y una restauración verificable antes del primer cliente. |
| Monitoring | **PREPARED · PENDING EXTERNAL DESTINATION** | Checks no destructivos, severidades y guard QA/producción versionados. Falta crear manualmente el monitor HTTP/email, confirmar retención de logs y validar backups/PITR. |
| Seguridad | READY en QA | Secret scan OK; `service_role` no aparece en `dist`; producción no fue operada. |
| Legal/comercial | **PENDING MANUAL** | Revisar términos, privacidad, cancelación, trial, precios y soporte antes de cobrar. |
| Deployment/Cloudflare | READY observado | Dominio respondió HTTP 200 y sirvió el bundle publicado; verificar cada release con el runbook. |
| Rollback | **PENDING MANUAL** | Ejecutar una prueba controlada de rollback en un preview antes de producción. |

## Severidad

- **P0:** 0.
- **P1 de software:** 0.
- **P1 operativos:** billing real, WhatsApp real, backups, monitoring y legal/comercial; quedan explícitamente bloqueados para revisión manual.
- **P2:** instalar Firefox/WebKit, automatizar Lighthouse/axe en CI y agregar una matriz explícita de red lenta/caída y RPC 500/401/403. La suite actual sí cubre errores controlados, acceso denegado, suspensión, trial vencido y billing mock.
- **P3:** mejoras futuras de contenido, onboarding guiado y observabilidad de performance.

## Product review RC1

Esta revisión fue documental y no modificó producto ni datos.

| Perfil | Lo que entiende | Confusión / demora | Confianza | Riesgo de baja |
| --- | --- | --- | --- | --- |
| Dueño de barbería | Puede configurar negocio, equipo, servicios, horarios y reservas. | Workspace, breaks y conexión de WhatsApp requieren explicación inicial. | Agenda visible, trial y estados claros. | No saber qué falta para quedar operativo o no tener soporte durante la configuración. |
| Recepcionista | Agenda, clientes y nuevo turno son las acciones principales. | En mobile, encontrar secciones secundarias puede requerir “Más”. | Estados de turno y disponibilidad explícitos. | Permisos poco claros o demasiados pasos para la operación diaria. |
| Barbero / empleado | Puede revisar su agenda, horarios y breaks según su rol. | Debe recibir una orientación breve sobre alcance de su rol. | No puede ver datos de otros tenants; la agenda diferencia bloqueos. | No entender rápidamente qué turnos debe atender. |
| Cliente que reserva | Selecciona servicio, profesional, fecha, hora y datos de contacto. | Sin disponibilidad o errores de ocupación necesitan un mensaje contextual. | Confirmación, formato telefónico y resumen del turno. | Error de red, poca claridad sobre cancelación o falta de horarios. |
| Administrador de Austral SaaS | Ve CRM, leads, negocios, billing y estados de tenants. | Debe distinguir con claridad QA/sandbox de producción. | RLS, roles, auditoría e idempotencia verificadas en QA. | Billing, backups, monitoring o soporte operativo sin completar. |

### Acciones antes del primer cliente

- Publicar una guía de primer día para owner y empleados.
- Confirmar estado visible de WhatsApp sin prometer automatización no activada.
- Completar backups/PITR, monitoring, legal/comercial y rollback manual.
- Ejecutar la validación sandbox del proveedor de billing antes de habilitar cobros.

## Performance

El build RC mantiene los valores de Sprint 8:

- Entry JS: 217.00 kB; gzip 56.76 kB.
- CSS inicial: 117.25 kB; gzip 20.74 kB.
- Referencias Web Vitals: Landing 636 ms / CLS 0; Reserva 508 ms / CLS 0.00001; Login 268 ms / CLS 0; Dashboard 260 ms / CLS 0.0021.

La captura adicional está en [`performance-sprint8/rc1.json`](./performance-sprint8/rc1.json). Sus tiempos de preview local no se usan como métrica de producción: el primer route load tuvo warm-up del servidor. No se observó regresión de bundle.

## Criterio de salida de RC1

RC1 podrá pasar a READY cuando se completen manualmente los bloqueos operativos de la tabla, se pruebe rollback, se confirme monitoring y se aprueben los textos legales/comerciales. No iniciar prospección ni activar integraciones productivas antes de esa aprobación.
