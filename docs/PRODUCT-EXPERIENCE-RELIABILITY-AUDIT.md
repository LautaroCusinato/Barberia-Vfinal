# Austral Product Experience & Reliability Audit

Fecha: 2026-08-26
Alcance: frontend público, demo y navegación del workspace. WhatsApp backend, Evolution, n8n, billing y Supabase quedaron fuera de cambios y operaciones.

## Método

- Austral Design System: revisión de jerarquía, estados, responsive, dark mode, foco, targets táctiles, safe-area y reduced motion.
- Austral SaaS Architecture: se mantuvieron los límites tenant/backend; no se hicieron escrituras remotas ni cambios de contratos.
- Rutas auditadas en código: landing (`/`, `/para/:vertical`), auth (`/ingresar`, `/registro`, `/recuperar`, `/auth/confirm`, `/cuenta`, `/invitacion/:token`), onboarding, reserva pública (`/reservar/:slug`), demo (`/demo`), workspace (`/`) y plataforma (`/plataforma`).
- Vistas del workspace: resumen, agenda, equipo, mensajes, clientes, notas, estadísticas, operación, configuración y facturación. Plataforma: CRM, leads, agente, piloto, cola, seguimientos y billing sólo owner/admin.

## Hallazgos y correcciones

### P1 — runner E2E y arranque visual

CI ejecutaba Vite dev bajo paralelismo. Bajo carga se perdían chunks lazy (`Failed to fetch dynamically imported module`) y quedaba visible el fallback de carga. En CI Playwright ahora construye una vez y sirve `vite preview`, aislando el artefacto estático del ciclo de vida HMR/dev.

La carga de Google Fonts dejó de bloquear `DOMContentLoaded`: es progresiva (`media=print` + `onload`) con fallback local. La interfaz conserva Inter/Fraunces cuando están disponibles y no queda bloqueada si el tercero no responde.

### P1 — navegación interna no durable

Las vistas se mantenían únicamente en React state. Ahora el workspace usa `?view=` y plataforma `?section=`; refrescar conserva la vista, Back/Forward la recupera y los guards de rol siguen bloqueando billing para roles no autorizados. No se acepta tenant, entorno ni permiso desde esos parámetros.

### P1 — resolución autenticada duplicada y lectura fuera del límite de plataforma

La auditoría QA autenticada detectó dos lecturas repetidas de `barberia_members` y `platform_members`, además de un `401` para usuarios tenant-only. La causa era una lectura directa de `platform_members` (bloqueada correctamente por RLS) y una carrera entre `getSession()` y `onAuthStateChange`.

La corrección mínima en `src/main.jsx` usa el RPC autorizado `platform_role()` (SECURITY DEFINER, sin exponer la tabla de plataforma) y deduplica la resolución inicial de sesión. No cambia RLS, RPC, datos ni contratos backend.

Resultado posterior en build real servido por `vite preview`: 0 requests duplicadas, 0 errores de consola, 0 respuestas 4xx/5xx y 0 requests fallidas en Dashboard autenticado QA.

## Evidencia visual

- [390px light](../artifacts/ui-audit/after-390-light.png)
- [390px dark](../artifacts/ui-audit/after-390-dark.png)

La auditoría local verificó sin overflow horizontal y sin errores de consola en landing/demo en 320, 360, 375, 390, 412, 430, 768, 1024, 1366, 1440 y 1920 px. Demo y landing mantuvieron targets y navegación visibles; el bottom navigation conserva `safe-area-inset-bottom` y padding inferior del contenido.

## Baseline de performance local

Medición sobre el build estático (`vite preview`), Chromium headless, viewport 390×844 y red local sin throttling:

| Ruta | TTFB | DOMContentLoaded | Load | LCP | CLS | Requests | Duplicadas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | 16 ms | 63 ms | 833 ms | 1.672 s | 0 | 10 | 0 |
| `/demo` | 5 ms | 42 ms | 257 ms | 168 ms | 0,006 | 16 | 0 |

### Baseline autenticado QA posterior a la corrección

Proyecto validado exclusivamente: `cmsymmszlzikqpvfqjre`, viewport 390×844, build real servido por `vite preview`, sesión `E2E_QA_`.

| Ruta | TTFB | DOMContentLoaded | Load | LCP | CLS | Requests | Duplicadas |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/para/barberia` | 11 ms | 55 ms | 163 ms | n/d | 0 | 10 | 0 |
| `/reservar/e2e-qa-barberia-a` | 11 ms | 72 ms | 151 ms | 280 ms | 0,001 | 11 | 0 |
| `/ingresar` | 13 ms | 145 ms | 303 ms | 340 ms | 0 | 10 | 0 |
| `/` autenticado | 39 ms | 178 ms | 555 ms | 280 ms | n/d | 16 | 0 |

La suite autenticada QA completa pasó `200/200` después de refrescar únicamente los fixtures QA del próximo lunes; la primera corrida falló en ocho viewport por fixture de fecha obsoleto, no por lógica de producto. El refresh creó/reutilizó sólo datos con prefijo `E2E_QA_` y no contactó proveedores externos.

No hubo errores de consola ni requests fallidas. La carga de fuentes externas quedó fuera del camino crítico mediante carga progresiva y fallback local.

## Fuera de alcance / pendientes

- No se inició pairing, outbound, migración WhatsApp ni operación financiera.
- La validación autenticada QA se ejecutó localmente contra el proyecto permitido `cmsymmszlzikqpvfqjre`: `200/200`, con aislamiento Tenant A/B y sin efectos productivos.
- El smoke remoto autenticado aún requiere una sesión QA en el navegador; la sesión pública disponible no permite demostrar ese último paso.
- No se modificó el Worker antiguo ni ningún deploy productivo.

## Final UI hardening pass — 2026-08-27

Rama auditada: `qa-whatsapp-hardening`. Se aplicaron únicamente correcciones de frontend, tests y documentación; no hubo deploy, migración ni escritura remota.

### Hallazgos y correcciones

- **P1 — estado WhatsApp ambiguo:** un fallo de lectura podía representarse como “no configurado”. `whatsappDisplay` ahora separa estado técnico y entitlement: un último `CONNECTED` se conserva con aviso de verificación pendiente, y `STATUS_UNAVAILABLE` nunca habilita preparar/reconectar/desconectar.
- **P1 — degradación engañosa ante red:** las colecciones remotas ya no arrancan con datos demo ni se vacían ante un error parcial; se conserva el último estado y se ofrece `Reintentar` explícito.
- **P1 — acciones duplicables:** provisioning, guardado de CRM y acciones de outreach tienen guardas síncronas, feedback de busy y `try/finally`; no hay doble submit por doble click.
- **P2 — Agenda estrecha:** la grilla usa columnas `minmax(0, …)` y un breakpoint intermedio para evitar cortes de nombres/servicios a 1440px y tablet.
- **P3 — claridad y semántica:** se corrigieron acentos, títulos de página, marca semántica del login y copys técnicos/comerciales; los estados de facturación y WhatsApp no exponen detalles internos.

### Auditoría visual y de interacción

Se revisaron landing, auth, registro, recuperación, reserva pública, demo, workspace (Resumen, Agenda, Clientes, Operación, Equipo, Mensajes, Configuración, Facturación, Notas, Estadísticas), plataforma CRM, modales, navegación desktop/mobile, estados vacíos, error y carga. En 390px y 1440px todos los views conservaron encabezado y no presentaron overflow horizontal; la revisión incluyó light/dark y safe-area del bottom navigation. Las capturas de referencia siguen en [390px light](../artifacts/ui-audit/after-390-light.png) y [390px dark](../artifacts/ui-audit/after-390-dark.png).

### Validación automatizada

- `npm test`: PASS (todas las verificaciones estáticas, billing/WhatsApp fail-closed y regresiones UI).
- `npm run lint`: PASS.
- `npm run build`: PASS (`vite 8.2.0`).
- `git diff --check`: PASS.
- `node scripts/scan-secrets.mjs`: PASS (395 archivos, sin secretos detectados).
- Playwright público: **72/72 PASS**.
- Playwright demo: **168 PASS, 8 SKIPPED esperados** (176 escenarios, 8 perfiles). No quedó el estado “Cargando pantalla…” de forma permanente.

La corrida autenticada local se detuvo de forma segura en el guard: el `.env.e2e.local` tiene `E2E_QA_PASSWORD` no operativo y el checkout contiene una URL Vite productiva, por lo que no se usó ninguna credencial ni se contactó producción. Al inyectar únicamente la URL QA en el proceso, el guard permitió la suite pero el fixture `unassigned` no autenticó; el error fue `Email o contraseña incorrectos` y no un fallo de UI. La validación autenticada requiere una contraseña QA real en el entorno de ejecución (GitHub Secret/CI o archivo local QA), sin imprimirla.

### Runtime y límites de seguridad

La inspección SSH fue sólo de lectura: n8n respondió `200` en healthz, Evolution respondió `200`, y las dos instancias `austral-qa-tenant-1` y `miwsp` figuraron `open`. No se enviaron mensajes ni se modificaron reservas/clientes, billing o producción. El webhook de `austral-qa-tenant-1` todavía declara `MESSAGES_UPSERT` además de `QRCODE_UPDATED` y `CONNECTION_UPDATE`; queda documentado como blocker backend separado y no fue modificado durante este hardening.

Pendientes reales: ejecutar la suite autenticada con credenciales QA operativas y revisar, en una tarea backend separada, la suscripción de `MESSAGES_UPSERT` si el contrato de shadow exige sólo eventos de QR/connection. No se alteró main, producción, Evolution, n8n ni ningún deploy.
