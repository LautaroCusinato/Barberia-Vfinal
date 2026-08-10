# Validación autenticada final — QA/E2E

Fecha de ejecución: 2026-08-10
Proyecto: `Austral SaaS QA` · `cmsymmszlzikqpvfqjre` · South America (São Paulo)
Proyecto productivo prohibido: `ssagttjdgtypxjcgdnrw`

La validación aplicó **Austral SaaS Architecture** (ref QA explícito, RLS vigente, credenciales sólo locales, proveedores externos desactivados) y **Austral Design System** (recorridos responsive, light/dark, foco visual y estados de carga sin cambiar contratos funcionales).

## Guards y preparación

- `npm run e2e:preflight`: **OK**.
- Ref QA y URL coincidentes; `E2E_REAL_SUPABASE=1`; entorno `qa`; prefijo `E2E_QA_`.
- El guard rechaza explícitamente `ssagttjdgtypxjcgdnrw` y no detectó secretos de Mercado Pago, PayPal, Evolution, DeepSeek o n8n.
- Fixtures sembrados/reutilizados de forma idempotente: 2 tenants, 12 usuarios (incluye uno sin tenant) y datos sintéticos por tenant.
- Proveedores externos: desactivados; no se generaron pagos, mensajes ni reservas nuevas.
- `npm run e2e:cleanup` (dry-run): **OK**, 2 tenants y 12 usuarios candidatos; no se borró nada.
- `billing-api` mock QA desplegado con JWT obligatorio; no requiere secretos.

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
- Facturación: status, checkout mock, estados internos y reconciliación QA verificados sin proveedor externo.

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
- Tenant owner: sin errores funcionales tras desplegar el mock QA. El cierre normal de Realtime ya no se registra como error al desmontar la pantalla.
- Reserva pública: sin errores de consola ni requests fallidos después de reemplazar el logo externo del fixture por un `data:` local.
- No se imprimieron tokens, cookies, headers ni valores de `.env.e2e.local`.
- Host productivo contactado: **no**.

## Clasificación

- **P0:** ninguno.
- **P1:** ninguno abierto en el alcance QA. La infraestructura de billing queda explícitamente mock/sandbox y no es apta para producción.
- **P1 de cobertura:** resuelto; los stubs fueron reemplazados por 24 escenarios reales multiplicados por 6 proyectos.
- **P2/P3:** no se evaluaron cambios de producto; la tarea se limitó a QA e infraestructura aislada.

## Playwright

La ejecución completa lanzó 192 casos en 6 proyectos. Resultado final: **192/192 passed** (48 públicos + 144 autenticados), sin skips en el entorno QA habilitado.

## Correcciones realizadas

- Fixture de teléfonos ajustado al contrato canónico argentino `54911XXXXXXXX` exigido por la migración de normalización.
- Fecha del turno/break QA ajustada a un lunes compatible con el horario ficticio.
- CRM QA persiste `environment='sandbox'` (el guard de ejecución sigue siendo `qa`).
- Logo de fixture convertido a `data:` local para evitar requests externas.
- `supabase/functions/billing-api-qa/index.ts`: mock QA desplegado como `billing-api` sólo en `cmsymmszlzikqpvfqjre`, con guardas de ref, Auth, roles, CORS y estados idempotentes.
- `e2e/qa-authenticated.spec.mjs`: 24 flujos reales (sin `test.fail` ni placeholders), con RLS, roles, aislamiento, onboarding, reserva, CRM y billing mock.
- Logout móvil agregado al sheet “Más” reutilizando `onLogout`; limpieza del canal Realtime al desmontar sin ruido de consola.
- Sidebar con scroll interno seguro para mantener acciones inferiores accesibles en viewports cortos; logout con `aria-label` estable.
- Seed QA idempotente: revalida la contraseña sólo de usuarios `E2E_QA_` antes de cada matriz para evitar falsos negativos por Auth throttling.
- No se modificó lógica de negocio, backend, RLS, RPC, billing productivo, Mercado Pago, n8n, Evolution ni datos productivos.

## Bloqueos y siguiente paso

No se inicia Sprint 8 en esta etapa. La validación QA/E2E quedó lista; el siguiente paso requiere autorización explícita para iniciar Sprint 8 y, antes de producción, reemplazar billing mock por una integración sandbox separada con credenciales administradas fuera de los tests.
