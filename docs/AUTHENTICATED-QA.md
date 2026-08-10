# Validación autenticada final

## Estado

La preparación versionable del entorno aislado está documentada en [`docs/QA-SANDBOX.md`](QA-SANDBOX.md). Incluye `scripts/e2e-sandbox-preflight.mjs`, `scripts/e2e-qa-fixtures.mjs` y cleanup con dry-run/doble confirmación. Ninguno fue ejecutado contra Supabase porque el proyecto QA todavía no existe y el acceso administrativo estaba desconectado.

**Bloqueada por precondiciones de seguridad.** No se ejecutó ningún login real, no se usaron Barbería Central ni Barbería Nueva para crear o modificar datos, no se generaron reservas/pagos y no se tocó producción.

Se aplicaron los guardrails de **Austral SaaS Architecture** y la revisión visual de **Austral Design System**. Al tratarse de una validación QA, no se modificó lógica ni infraestructura.

## Evidencia del bloqueo

La suite de Playwright contiene un bloque explícitamente gated por `E2E_REAL_SUPABASE=1` y requiere un proyecto Supabase sandbox separado con usuarios de prueba y prefijo único. En el entorno disponible:

- `E2E_REAL_SUPABASE` no está habilitado.
- No existe `E2E_SUPABASE_URL` configurada para un proyecto sandbox.
- No existe una credencial `E2E_SUPABASE_SERVICE_ROLE_KEY` disponible fuera del repositorio para cleanup controlado.
- No existe `E2E_TEST_PREFIX` autorizado para identificar y limpiar fixtures.
- El `.env` local solo expone nombres de variables públicas del frontend (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_BARBERIA_ID`, `VITE_N8N_SEND_WEBHOOK_URL`); no se mostraron valores.
- No hay una sesión autenticada QA ni un tenant demo/sandbox autorizado disponible en este entorno.

No es seguro inferir que `VITE_BARBERIA_ID` sea un tenant de prueba. Por eso no se utilizó.

## Recorridos autenticados

| Área | Estado | Motivo |
| --- | --- | --- |
| Login, selector y logout | No ejecutado | Falta usuario QA y proyecto sandbox aislado |
| Dashboard, Agenda y gestión | No ejecutado | Requiere sesión y tenant QA |
| Clientes, servicios, empleados y horarios | No ejecutado | Requiere fixtures con prefijo y cleanup seguro |
| Configuración y billing | No ejecutado | No corresponde tocar datos/configuración sin entorno aislado |
| `/plataforma`, CRM, leads, negocios y métricas | No ejecutado | Requiere rol platform QA y datos no productivos |
| Reserva pública | Solo mock público existente | Se mantiene cubierta por Playwright sin escritura real |

No se puede responder honestamente que el producto autenticado funciona end-to-end hasta habilitar esas precondiciones.

## Responsive y temas

La matriz pública existente sigue cubriendo 390×844, 360×800, 768×1024, 1366×768 y 1920×1080 con light/dark en los escenarios mock. La matriz autenticada en 390×844, 768×1024 y 1366×768 queda pendiente porque no hay sesión QA segura.

## Consola y red

No se interceptaron requests autenticadas ni se registraron cookies, tokens, headers o secretos. Los escenarios públicos Playwright no deben generar efectos externos; los flujos Supabase reales se mantienen omitidos por diseño.

## Clasificación

- **P0:** ninguno observado; la prueba autenticada no llegó a ejecutarse.
- **P1:** validación pendiente por falta de entorno seguro, no un defecto confirmado del producto.
- **P2/P3:** no evaluados en pantallas autenticadas.

No se aplicaron correcciones porque cualquier cambio fuera de una evidencia reproducible sería especulativo.

## Qué falta para reanudar

1. Proyecto Supabase sandbox separado de producción.
2. Usuario owner/admin de plataforma QA y usuario owner de negocio QA.
3. Tenant demo/sandbox explícito, sin relación con Central/Nueva.
4. Variables fuera del repositorio: `E2E_REAL_SUPABASE=1`, `E2E_SUPABASE_URL`, `E2E_SUPABASE_SERVICE_ROLE_KEY` y `E2E_TEST_PREFIX` único.
5. Fixtures aprobados para clientes, servicios, empleados, horarios, turnos y CRM.
6. Cleanup transaccional permitido solo para ese prefijo.

Con esas precondiciones se podrá repetir la matriz autenticada, registrar consola/red sanitizadas y generar capturas reales en `docs/authenticated-qa/`.

## Verificaciones ejecutadas en esta etapa

Se ejecutan únicamente checks seguros de código y superficies públicas; sus resultados se informan en el cierre de la tarea. No se habilitó Sprint 8.
