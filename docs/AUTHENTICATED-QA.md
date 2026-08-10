# Validación autenticada final — QA/E2E

Fecha de ejecución: 2026-08-10
Proyecto: `Austral SaaS QA` · `cmsymmszlzikqpvfqjre` · South America (São Paulo)
Proyecto productivo prohibido: `ssagttjdgtypxjcgdnrw`

La validación aplicó **Austral SaaS Architecture** (ref QA explícito, RLS vigente, credenciales sólo locales, proveedores externos desactivados) y **Austral Design System** (recorridos responsive, light/dark, foco visual y estados de carga sin cambiar contratos funcionales).

## Guards y preparación

- `npm run e2e:preflight`: **OK**.
- Ref QA y URL coincidentes; `E2E_REAL_SUPABASE=1`; entorno `qa`; prefijo `E2E_QA_`.
- El guard rechaza explícitamente `ssagttjdgtypxjcgdnrw` y no detectó secretos de Mercado Pago, PayPal, Evolution, DeepSeek o n8n.
- Fixtures sembrados/reutilizados de forma idempotente: 2 tenants, 11 usuarios y datos sintéticos por tenant.
- Proveedores externos: desactivados; no se generaron pagos, mensajes ni reservas nuevas.
- `npm run e2e:cleanup` (dry-run): **OK**, 2 tenants y 11 usuarios candidatos; no se borró nada.

## Roles y módulos recorridos

### Owner de negocio — Tenant A

Usuario QA sintético `e2e_qa_owner_a@e2e-qa.invalid`.

- Login y resolución de tenant: OK.
- Dashboard/Resumen: OK.
- Agenda: OK.
- Clientes: OK.
- Equipo: OK.
- Operación (servicios, empleados, horarios/breaks): OK.
- Configuración: OK.
- Facturación: la pantalla carga, pero su consulta a `billing-api/status` no puede completarse porque esa Edge Function todavía no está desplegada en QA (ver bloqueos).

### Owner de plataforma

Usuario QA sintético `e2e_qa_platform_owner@e2e-qa.invalid`.

- `/plataforma`: OK.
- CRM comercial / Negocios: OK.
- Navegación `Negocios y leads`: OK.
- No se ejecutaron acciones de escritura comercial ni billing.

### Reserva pública

- `/reservar/e2e-qa-barberia-a`: catálogo visible en 390×844, sin confirmar ni insertar reservas.
- Sin llamadas a proveedores externos.

## Aislamiento multi-tenant

Se autenticaron owners A y B con la clave pública QA y se consultaron tablas operativas. Ambos vieron su propio tenant y una fila propia de clientes/servicios/turnos; ninguno vio el otro tenant ni filas extranjeras.

Resultado: **aislamiento OK**, sin errores RLS en las consultas verificadas.

## Responsive y temas

- Desktop: 1366×768.
- Mobile: 390×844.
- Light: dashboard del owner.
- Dark: dashboard y gestión del owner.
- No se observó contacto con el host Supabase productivo.

Capturas en [`docs/authenticated-qa/`](authenticated-qa/):

- `owner-a-dashboard-1366-light.png`
- `owner-a-dashboard-390-dark.png`
- `owner-a-settings-390-dark.png`
- `platform-owner-1366.png`
- `booking-qa-390.png`

## Consola y red (sanitizado)

- Plataforma owner: sin errores de consola ni requests fallidos.
- Tenant owner: dos errores 400/CORS al consultar `functions/v1/billing-api/status`; corresponden a la Edge Function ausente en QA.
- Reserva pública: sin errores de consola ni requests fallidos después de reemplazar el logo externo del fixture por un `data:` local.
- No se imprimieron tokens, cookies, headers ni valores de `.env.e2e.local`.
- Host productivo contactado: **no**.

## Clasificación

- **P0:** ninguno.
- **P1:** infraestructura QA incompleta: falta desplegar una `billing-api` de prueba (o mock controlado) para validar la pantalla de facturación sin proveedor. No afecta producción ni habilita cobros.
- **P1 de cobertura:** los 144 casos autenticados definidos en `e2e/public.spec.mjs` siguen siendo stubs `test.fail(...)`; Playwright los recorrió como expectativas, pero no constituyen validación end-to-end real. Deben implementarse antes de declarar completa la matriz autenticada.
- **P2/P3:** no se evaluaron cambios de producto; la tarea se limitó a QA e infraestructura aislada.

## Playwright

La ejecución completa lanzó 192 casos en 6 proyectos. Resultado reportado por Playwright: 48 escenarios públicos reales pasaron; los 144 escenarios sandbox definidos como expectativas aún no contienen pasos de negocio reales. Además, el smoke autenticado específico recorrió owner A desktop/mobile, plataforma owner y reserva pública sobre QA.

## Correcciones realizadas

- Fixture de teléfonos ajustado al contrato canónico argentino `54911XXXXXXXX` exigido por la migración de normalización.
- Fecha del turno/break QA ajustada a un lunes compatible con el horario ficticio.
- CRM QA persiste `environment='sandbox'` (el guard de ejecución sigue siendo `qa`).
- Logo de fixture convertido a `data:` local para evitar requests externas.
- No se modificó lógica de negocio, backend, RLS, RPC, billing productivo, Mercado Pago, n8n, Evolution ni datos productivos.

## Bloqueos y siguiente paso

No es seguro iniciar Sprint 8 todavía. Primero hay que desplegar una Edge Function billing mock/sandbox en `cmsymmszlzikqpvfqjre` (sin secretos ni proveedores) y reemplazar los 144 stubs por escenarios autenticados reales con cleanup por prefijo. Después repetir la matriz completa y revisar billing sin errores de red.
