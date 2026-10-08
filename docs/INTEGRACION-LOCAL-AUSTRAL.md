# Integración local de mejoras de Austral — actualizada el 08/10/2026

**Sólo para revisar las mejoras juntas. No es un candidato de release y no se
publicó.** Ninguna tarea queda completada por estar acá. Sin push, merge a main,
despliegues ni cambios remotos. Las ramas originales de cada tarea no se
modificaron, salvo las dos ramas de revisión de 41 creadas a pedido (ver abajo).

- Worktrees: `integracion-austral` (rama demo) e `integracion-austral-revisadas`
  (rama revisada), dentro de `C:/Users/lauti/OneDrive/Escritorio/Codex barberia/`.
  Checkout con `core.autocrlf=false`: todos los archivos quedan en LF, así
  `verify-invited-roles-access` pasa sin re-extraer nada.
- Base: `c082d3c` (`feat/whatsapp-enlace-web-clientes`), que ya contiene
  `fix/review-hardening@1aa2fe4`.
- Integración con `cherry-pick -x`: cada commit lleva la línea
  `(cherry picked from commit …)`. Se comparó cada parche con su original:
  - idénticos, salvo las líneas de los conflictos resueltos;
  - 41 y su revisión: el script `test` de `package.json` y la firma
    `App` → `PanelNegocio`;
  - 38 (`48c3b76`/`7fba130`/`dc80b5b`): sólo el orden de imports.

## Dos ramas, en capas

| Rama | Punta | Contenido |
|---|---|---|
| `integracion/austral-revisadas` | `3b1298c` | Base + tareas con revisión independiente: 06, 07, 38 completa, 41, 42, 43, 44 y 45 (cada una con su revisión) |
| `integracion/austral-demo` | (esta, ver `git log`) | Además 08, 37, 09, 39 y 40 (revisión pendiente), 20 (postergada) y este documento con el mock de la demo |

## Inventario: commits originales → integrados

**Ya en la base (no se cherry-pickean):**

| Tarea | Commits | Estado |
|---|---|---|
| 05 cobro atómico | `e1a2f97`, `1aa2fe4` | en `fix/review-hardening` (origin); migración sin aplicar |
| 21 avisos de éxito | `4f66c90` | en `fix/review-hardening` |
| 35/36 WhatsApp | `9a19818`, `7def700`, `1ea25ed`, `c082d3c` | 36 validada en QA real el 04/10 |

**Con revisión independiente (en ambas ramas):**

| Tarea | Original | Revisadas | Demo | Revisión |
|---|---|---|---|---|
| 07 arrastre | `a8294bf` + `c269254` | `c2ee6d9`, `4115f04` | idem | Claude 05/10 |
| 06 deshacer borrado | `277d8f7` + `85e0e22` | `7990d6d`, `6596e54` | idem | Claude 05/10 |
| 38 iniciar chat | `48c3b76` + `7fba130` + `dc80b5b` + `d2a09ba` + `f62fde5` | `ece5f67`, `2e28be4`, `04e0f42`, `3502268`, `0814aad` | `ece5f67`, `2e28be4`, `54f5d19`, `c644ed8`, `29e4556` | revisión independiente cerrada 06/10 (sesión terminada; carpeta limpia en `f62fde5`) |
| 41 bloquear fechas | `ccd5be0` + `299f984` + `36caf56` | `c139aa6`, `a46959d`, `981daf1` | `a3c702c`, `eebf6e2`, `3297d6f` | revisión 07/10, ver abajo |
| 44 CSV multilínea | `c4e2338` (Codex) + `94b0f13` | `cf998a2`, `92e920d` | `8263fbf`, `761e5af` | revisión 07/10: vuelve a aceptar comas finales / columnas sobrantes vacías |
| 42 sin días laborales | `e2d9d61` (Codex) + `f1dd489` | `fed83c0`, `9de88ea` | `7d0e881`, `67eca14` | revisión 07/10: la pausa ya no se pierde al pasar por cero días |
| 43 notas por cliente | `ac8c171` (Codex) + `d46e890` + `0baa10e` | `719e8e8`, `a2dd086`, `6a35ac0` | `9844008`, `d96c3bb`, `8b0fdc5` | revisión 07–08/10: **asociación sólo por `cliente_id`**. `d46e890` agregó un vínculo por nombre y `0baa10e` lo retiró (con `on delete set null`, un homónimo nuevo heredaba notas de una ficha borrada); regresión borrar → crear homónimo |
| 45 cobros reales | `354a216` (Codex) + `a3128e7` | `330f55a`, `3b1298c` | `5743992`, `97b9a1b` | revisión 08/10 (worktree `revision-45`): una recarga de pagos por Realtime ya no borra los totales confirmados |

**Con revisión pendiente (sólo en la demo):**

| Tarea | Original | Demo | Pendiente |
|---|---|---|---|
| 08 redirects QA | `2d65bc5` | `4cec0d7` | revisar lista de orígenes; Auth real (12) |
| 37 reserva pública | `6e559fd` | `8cd155c` | revisión independiente; QA real (13) |
| 09 catálogo reserva | `5298537` | `62633cf` | revisión; precio atómico e idempotencia en backend |
| 39 facturación | `7321b42` | `0d85a08` | revisión; billing-api QA |
| 40 recorte listas | `00575e8` | `d38c5a6` | revisión; touch/Safari reales |

**Postergada (sólo en la demo, sin trabajo adicional):** 20 moneda, `fcb00e8` →
`91090eb`. **Decisión del dueño del 05/10: sólo ARS.** No es requisito para
publicar; la migración `20261005220000` no se aplica.

**No incorporado:**

- 46: tiene una propuesta local de Codex que no se pidió revisar ni integrar.
- **47, siguiente frente** (registrada el 07/10, sin implementar): el panel carga `turnos`,
  `bloqueos_agenda` y `mensajes` sin rango y en orden ascendente. Con más de
  1000 filas (el límite por defecto de PostgREST) faltan los futuros o los más
  recientes, sin error visible. La consulta en la base de la advertencia de
  «Bloquear» (41) **no** demuestra que la Agenda cargue todos los turnos
  futuros. Ver `tareas/47-cargas-panel-limite-1000.md`.
- 15, 18, 31, 32 y 27 (entrega de Codex): fuera del pedido de esta integración.
- Ningún cambio sin commitear de ninguna carpeta.

## Revisión de 41 (07/10) — resumen

Detalle completo en `tareas/41-bloquear-fechas-desde-agenda.md`. Dos commits
locales:

- `299f984` en `feat/bloquear-fechas-agenda-41`:
  - «Bloquear» sólo para owner/admin, con los permisos del servidor sin cambios;
  - la advertencia de turnos afectados consulta la base (la lista del panel
    puede venir cortada a 1000 filas);
  - Deshacer un desbloqueo avisa de las reservas que entraron mientras la fecha
    estuvo libre;
  - Calendar ya no cierra el día de todos por el bloqueo de un profesional;
  - pruebas y SQL de carreras.
- `36caf56` en `fix/whatsapp-horario-bloqueado-41`, una rama nueva desde
  `c082d3c`, porque la ruta de chat sólo existe ahí:
  - si el horario confirmado quedó bloqueado u ocupado, no se crea turno;
  - la conversación vuelve a «elegir horario» y el cliente recibe un mensaje
    con alternativas;
  - antes no recibía nada.

**Garantía de un bloqueo:** desde su COMMIT, toda sentencia de reserva que
empiece después se rechaza en cualquier canal, aunque su transacción ya
estuviera abierta. No cubre un INSERT que ya se ejecutó en una transacción que
confirma después: ese turno se conserva. La exclusión estricta requiere una
migración y no se hizo.

## Conflictos resueltos

Todos se resolvieron conservando lo de ambas partes:

- **Imports de `src/App.jsx`:**
  - 07 vs 38;
  - 38 consigo misma tras 07;
  - `dc80b5b` sobre la integración.
- **`.gitattributes`:** reglas LF de 35, 38 y 41.
- **Script `test` de `package.json`:** 38, 41 y la revisión de 41; están todos
  los verificadores.
- **Firma de `App`:** la revisión de 41 sobre 38 `f62fde5`, que convirtió `App`
  en un envoltorio con `key` por negocio. `rol` se agrega a `PanelNegocio`.
- **`turnos` en `App`:** sobre 06, que separa `turnosBase` de la lista visible.
  `turnosRef` sigue la lista visible.

## Controles sobre la combinación final (Node 24.18.0 / npm 11.16.0; CI usa Node 22)

| Control | `austral-revisadas` (`3b1298c`) | `austral-demo` (`97b9a1b` + docs) |
|---|---|---|
| `npm run lint` | PASS | PASS |
| `npm test` (contratos) | PASS | PASS |
| `npm run test:unit -- --maxWorkers=2` | PASS 53 archivos / 622 tests | PASS 57 archivos / 711 tests |
| `npm run build` | PASS | PASS |
| SQL local `bloqueos-agenda` (41) | PASS | PASS |
| SQL local `whatsapp-panel-send` (38) | PASS | PASS |
| SQL local `cobro-atomico` (05) | PASS | PASS |
| SQL local `whatsapp-cliente-unico` (35) | PASS | PASS |

Las suites SQL corren en un PostgreSQL 18 efímero local; no tocan ninguna base
remota. La de moneda (20) no se corrió: está postergada. Los logs están en
`../integracion-logs/` (`demo-97b9a1b/`, `revisadas-3b1298c/`; las tandas anteriores siguen en `demo-d96c3bb/`, `revisadas-a2dd086/`, `demo-final-3297d6f/` y `revisadas-final/`).

## Probado en el navegador, sólo con datos de demo

- **42/43 (segunda tanda):** en Operación, quitar los 7 días de un profesional y reactivar el martes deja sólo el martes; en Clientes, «Ver notas» abre Notas filtradas por la ficha («Notas de Agustín Molina»). 44 vive en el CRM de plataforma, que no está en `/demo`: cubierto sólo por pruebas.
- **45:** Estadísticas muestra «Cobrado registrado $ 0» separado de «Valor estimado de atendidos sin cobro registrado $ 17.000», con la aclaración de que es una estimación.
- **Reserva pública en pesos (37/09):** mock local de las 3 RPC
  (`scripts/demo-local/mock-reserva-publica.mjs`, `127.0.0.1:54399`):
  - 3 pasos completos hasta «¡Turno reservado!»;
  - validación de campos vacíos;
  - error recuperable para un slug inexistente;
  - 375 px sin scroll horizontal;
  - sin errores de consola.
- **Panel `/demo`:**
  - cobro al marcar Atendido (05) con aviso (21); un doble clic real da un solo
    cobro;
  - eliminar turno con Deshacer (06);
  - «Iniciar chat» desde la ficha, sin enviar nada (38);
  - padding de las listas (40);
  - Facturación demo (39);
  - **41:** «Bloquear» en la cabecera; advertencia con los 5 turnos del día y
    foco en «Bloquear igual»; aviso sólo después de guardar; bloqueo parcial
    visible como «Parcial»; Desbloquear → Deshacer → «Bloqueo restaurado»;
    sin errores de consola.
- **No probado en el navegador:**
  - arrastre semanal (07): sólo unitarios;
  - redirects de Auth (08);
  - botón oculto por rol: en `/demo` siempre se muestra;
  - capturas: el panel del navegador estaba oculto.

**Observación menor, preexistente en 05:** en `/demo`, dos `click()` sintéticos
en el mismo tick registran dos cobros. Un doble clic real no lo reproduce; con
Supabase lo evitan el `await` y la clave idempotente.

## Qué necesita backend real (nada de esto se demostró acá)

- **Reserva (13):** RPC reales de reserva, RLS, cliente único web/WhatsApp y el
  turno visible en la agenda.
- **Migraciones sin aplicar en QA/producción:** cobro `20261004090000` (05) y
  envío del panel `20261005120000` (38).
- **Panel (14):** permisos por rol, operadores simultáneos, Realtime y
  movimientos/Deshacer (06/07). Botón «Bloquear» oculto con roles reales, un
  negocio con más de 1000 turnos y Deshacer con una reserva real en el hueco (41).
- **WhatsApp real:** función `whatsapp-panel-send` y plantilla n8n por instancia
  (38). Para 41: desplegar `whatsapp-booking-mutation` y
  `whatsapp-agent-outbound-pilot` antes que la plantilla QA 36 actualizada, y
  probar el rechazo con los números QA.
- **Facturación (39):** billing-api QA.
- **Auth (08 → 12):** flujos con orígenes QA reales.

## Cómo levantar la demo

```bash
node scripts/demo-local/mock-reserva-publica.mjs
```

```bash
npm run dev -- --host 127.0.0.1 --port 5195 --strictPort
```

Con `.env.local` (ignorado por Git) apuntando sólo al mock:
`VITE_SUPABASE_URL=http://127.0.0.1:54399` y una clave de marcador. **No usar
`barberia/.env`: apunta a producción.**

- Panel: `http://127.0.0.1:5195/demo`
- Reserva (recorrido en pesos): `http://127.0.0.1:5195/reservar/austral-demo`.
  El mock conserva un slug en USD sólo por la tarea 20 postergada; no forma
  parte de la revisión.

Con `.env.local` presente, `/ingresar` y el resto de rutas autenticadas intentan
hablar con el mock y fallan: para el panel usar `/demo`.
