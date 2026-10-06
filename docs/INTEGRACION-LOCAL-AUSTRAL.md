# Integración local de mejoras de Austral — 05/10/2026

**Sólo para ver las mejoras juntas. No es un candidato de release.** Ninguna
tarea queda completada por estar acá. Sin push, merge a main, despliegues ni
cambios remotos. Las ramas originales no se modificaron.

- Worktree: `C:/Users/lauti/OneDrive/Escritorio/Codex barberia/integracion-austral`
  (checkout con `core.autocrlf=false`: todos los archivos en LF, así
  `verify-invited-roles-access` pasa sin re-extraer nada).
- Base: `c082d3c` (`feat/whatsapp-enlace-web-clientes`), que ya contiene
  `fix/review-hardening@1aa2fe4`.
- Integración con `cherry-pick -x`: cada commit lleva la línea
  `(cherry picked from commit …)`. Se comprobó que el parche de cada uno es
  idéntico al original (comparación de líneas +/−).

## Dos ramas, en capas

| Rama | Punta | Contenido |
|---|---|---|
| `integracion/austral-revisadas` | `2e28be4` | Base + commits que ya tuvieron una revisión independiente |
| `integracion/austral-demo` | (esta) | Lo anterior + commits con revisión pendiente + este documento y el mock de demo |

## Inventario por tarea

| Tarea | Commits originales | Estado de revisión | Dónde quedó |
|---|---|---|---|
| 05 cobro atómico | `e1a2f97`, `1aa2fe4` | Ya incluidos en `fix/review-hardening` (en origin) | Base |
| 21 avisos de éxito | `4f66c90` | Ya incluido en `fix/review-hardening` | Base |
| 35/36 WhatsApp (contexto) | `9a19818`, `7def700`, `1ea25ed`, `c082d3c` | 36 validada en QA real el 04/10 | Base (es ancestro de 07/08/37/38) |
| 07 arrastre | `a8294bf` + revisión `c269254` | Revisado (Claude, 05/10) | Revisadas: `c2ee6d9`, `4115f04` |
| 06 deshacer borrado | `277d8f7` + revisión `85e0e22` | Revisado (Claude, 05/10) | Revisadas: `7990d6d`, `6596e54` |
| 38 iniciar chat | `48c3b76` + revisión `7fba130` | Revisado (Claude, 05/10) | Revisadas: `ece5f67`, `2e28be4` |
| 08 redirects QA | `2d65bc5` | **Pendiente** (lista de orígenes) | Demo: `4cec0d7` |
| 37 reserva pública | `6e559fd` | **Pendiente** de revisión independiente; QA real (13) | Demo: `8cd155c` |
| 09 catálogo reserva | `5298537` | **Pendiente** | Demo: `62633cf` |
| 20 moneda | `fcb00e8` | **Postergada por decisión del dueño (05/10): sólo ARS.** Se conserva el commit sin más trabajo; no es requisito para publicar | Demo: `91090eb` |
| 39 facturación | `7321b42` | **Pendiente** | Demo: `0d85a08` |
| 40 recorte listas | `00575e8` | **Pendiente** | Demo: `d38c5a6` |

**No incorporado:**

- 38 `dc80b5b` (P1–P4: RPC atómica, plantilla n8n por instancia) y los cambios
  sin commit de `chat-cliente-38`: hay una sesión activa "Revisión
  independiente tarea 38" modificando esos archivos. Durante esta integración
  esa sesión agregó `d2a09ba` (revisión independiente, sobre `dc80b5b`): tampoco
  se incorporó; integrar 38 completa cuando esa revisión cierre.
- 41 bloquear fechas: sesión activa; su rama sigue en `1aa2fe4` sin commits.
- Nada sin commitear de ningún worktree.

07 depende de 08 en su rama original (`a8294bf` está encima de `2d65bc5`). Acá
se aplicó 07 sin 08 (archivos disjuntos) para que la capa revisada no arrastre
08; 08 entra en la capa demo.

## Conflictos

Sólo dos, ambos en los imports de `src/App.jsx` (07 vs 38, y 38 consigo misma
tras 07). Se conservaron todos los imports. El resto aplicó sin conflictos.

Interacción revisada a mano: 06 se escribió sobre `a8294bf` sin conocer
`c269254`. La revisión de 07 sólo agrega en `App.jsx` el aviso de falta de
permiso; su lógica está en `turnoMoves.js`/`useTurnoMoves.js`, que 06 no toca.

## Controles ejecutados (Node 24.18.0 / npm 11.16.0; CI usa Node 22)

| Control | `austral-revisadas` (`2e28be4`) | `austral-demo` (`d38c5a6`) |
|---|---|---|
| `npm run lint` | PASS | PASS |
| `npm test` (contratos) | PASS | PASS |
| `npm run test:unit -- --maxWorkers=2` | PASS 36 archivos / 493 tests | PASS 40 archivos / 582 tests |
| `npm run build` | PASS | PASS |

`npm test` incluye los contratos de cobro atómico, WhatsApp (35/36), envío del
panel (38) y avisos (21). Logs en `../integracion-logs/`.

## Prueba en navegador (demo local, sin backend)

Probado **sólo con datos de demo**:

- Reserva pública (37/09/20) contra `scripts/demo-local/mock-reserva-publica.mjs`
  (simula las 3 RPC públicas en `127.0.0.1:54399`): 3 pasos completos hasta
  "¡Turno reservado!"; validación de campos vacíos; (un slug en USD también renderiza, pero la tarea 20 está postergada y no se evaluó); slug inexistente muestra el error recuperable; 375 px sin scroll
  horizontal; sin errores de consola.
- Panel `/demo`: cobro al marcar Atendido (05) con aviso "Cobro registrado" (21);
  doble clic con eventos separados → un solo cobro; eliminar turno muestra
  "eliminación pendiente" con Deshacer y lo restaura (06); "Iniciar chat" desde
  la ficha abre el hilo vacío en Mensajes sin enviar (38); listas de Equipo y
  Mensajes con `padding`/`scroll-padding` de 8 px (40); Facturación en modo demo
  con plan Austral $50.000 / 15 días / pago manual (39).

**No probado en el navegador en esta integración:** arrastre semanal (07) —
cubierto sólo por unitarios —, redirects de Auth (08), capturas visuales (el
panel del navegador estaba oculto: verificación por DOM/texto).

**Observación menor (preexistente en 05, no de la integración):** en `/demo`,
dos `click()` sintéticos en el mismo tick registran dos cobros, porque la rama
sin backend de `confirmarCobro` termina síncrona. Un doble clic real no lo
reproduce. Con Supabase el `await` y la clave idempotente lo evitan.

## Qué necesita backend real (no demostrado acá)

- RPC reales de reserva, RLS, cliente único web/WhatsApp y que el turno aparezca
  en la agenda (13). El mock no valida nada del servidor.
- Migración de cobro `20261004090000` (05); la de moneda `20261005220000` (20) está postergada:
  sin aplicar en QA/producción.
- Concurrencia real de movimientos/Deshacer entre operadores, permisos por rol,
  Realtime (06/07, tarea 14).
- Envío de WhatsApp desde el panel, función `whatsapp-panel-send` (38).
- billing-api QA y estados reales de suscripción (39).
- Flujos de Auth con orígenes QA reales (08 → 12).

## Cómo levantar la demo

```bash
node scripts/demo-local/mock-reserva-publica.mjs
```

```bash
npm run dev -- --host 127.0.0.1 --port 5195 --strictPort
```

Con `.env.local` (ignorado por Git) que apunta sólo al mock:
`VITE_SUPABASE_URL=http://127.0.0.1:54399` y una clave de marcador. **No usar
`barberia/.env`: apunta a producción.**

- Panel: `http://127.0.0.1:5195/demo`
- Reserva (recorrido en pesos): `http://127.0.0.1:5195/reservar/austral-demo`
  (el mock conserva un slug en USD sólo por la tarea 20 postergada; no forma parte de la revisión)

Con `.env.local` presente, `/ingresar` y el resto de rutas autenticadas intentan
hablar con el mock y fallan: para el panel usar `/demo`.
