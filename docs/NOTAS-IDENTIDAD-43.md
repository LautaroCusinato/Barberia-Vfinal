# Tarea 43 · Notas vinculadas a una ficha

Propuesta local para revisión, base `integracion/austral-demo@3297d6f`.

## Decisiones y compatibilidad

Una asociación se basa exclusivamente en `cliente_id`, nunca en igualdad o
coincidencia parcial de nombres. Dos fichas homónimas cuentan y muestran sus
propias notas; renombrar una ficha conserva el vínculo y muestra el nombre
actual. La selección de cliente usa valores de ID y distingue homónimos con
el final del teléfono o una referencia de ficha cuando no hay teléfono.

Las notas sin ID siguen en Todas las notas y en la búsqueda libre, con su
texto de referencia. No aparecen como propias de una ficha sólo por nombre,
aunque haya un único cliente coincidente hoy: después de una eliminación y
alta de otra persona, esa inferencia podría atribuir notas a alguien distinto.
Cuando la referencia no es General, el listado avisa «Sin vínculo a una ficha».
La vinculación manual se hace al editar la nota, con selección explícita de
cliente. No hay backfill, reasignación automática ni borrado de históricos.

General y Sin ficha son selecciones separadas de un cliente que se llame
General. Una elección de ficha desaparecida bloquea el guardado y conserva
el borrador; no se transforma en una nota general por defecto.

## Recorrido completo

- Clientes: contador y Ver notas por ID; ficha detallada utiliza el mismo
  criterio para notas. El comportamiento del historial de turnos no se cambia.
- App: filtro de ficha separado de búsqueda textual. Notes permite Ver todas
  las notas y precarga la selección del cliente al entrar desde su ficha.
- Crear/editar: nombre de presentación se obtiene de la ficha actual, no de
  un nombre arbitrario suministrado junto con un ID. Payload de alta acotado;
  actualización filtrada por nota y negocio, con fila devuelta para confirmar.
- Borrado y Deshacer de 06 se conservan. Si falla editar, se conserva la
  selección y el texto. Se mantiene la edición antigua sólo de texto cuando
  no se pide cambiar la asociación.

## Seguridad y esquema existente

No hay migración. `notas.cliente_id` existe en
`20260810171324_qa_base_schema.sql`, con FK a clientes y ON DELETE SET NULL.
`20261002091000_tenant_write_boundaries.sql` instala
`trg_notas_cliente_same_tenant`: verifica ID y negocio del cliente al insertar
o actualizar. La política staff de notas se define en
`20261003090000_invited_roles_agenda_access.sql` y comprueba rol y acceso
operativo para USING/WITH CHECK. No se modifica RLS, grants, roles o RPC.

La lista del navegador no es una frontera de autorización: RLS y la guarda
del servidor deben estar aplicadas en el entorno remoto. No se comprobaron
remotamente en esta propuesta. El helper también evita vincular notas con un
negocio explícitamente diferente si ambos objetos traen barberia_id.

## Evidencia local

La primera prueba de componentes produjo cinco fallos y un PASS, antes de
corregir. Después pasan escenarios de homónimos, renombrado, legado, vínculo
manual, General como nombre, cliente desaparecido y errores con borrador.
Una prueba de App completo en demo recorre Clientes→Notas→Ver todas→crear.
Resultados del 07/10/2026: lint, npm test y build PASS; suite completa con
threads/un worker/cache desactivado **50 archivos / 663 tests PASS**.
No equiparar estos resultados a una validación de backend. Node 24.18.0;
no se repitió Node 22 de CI. Logs externos `work/notas-43-red.log`,
`notas-43-focused.log`, `notas-43-contracts.log` y `notas-43-unit.log` en
`C:/Users/lauti/Documents/Codex/2026-10-03/quiero-que-armes-la-lista-completa`.

Navegador local propio (5198), sin .env: se renombró Bruno Acosta a Agustín
Molina, se abrió su nota por ID, se agregó una nota exclusiva y se recargó.
Los dos contadores terminaron en 1 y 2, sin mezclar las fichas homónimas.
Captura externa: `work/43-notas-por-ficha-demo.jpg` en la carpeta de este chat
de Codex. Esto sólo acredita el store de demo, no PostgreSQL.

## Revisión pendiente

Revisar los cambios compartidos de App/Clientes con 38/41 y no duplicar la
base al integrar. Comprobar legado sin vincular, renombrado, edición y
persistencia/permisos en un backend autorizado. Revisar móvil/dark mode,
foco y selector de asociación. No se corrió e2e ni se importó o mutó dato
remoto. No añadir un índice, migración o regla de billing por inferencia.

Los límites previos de concurrencia de edición o incertidumbre de una
respuesta de alta no quedan resueltos por esta tarea: no prometer idempotencia
de notas ni reemplazo atómico de toda la ficha. La tarea queda sin tildar.

## Revisión independiente — 07/10/2026 (Claude), corregida

**Se retira el vínculo por nombre que agregó `d46e890`.** Esa revisión mostraba en la ficha las notas sin `cliente_id` cuando un único cliente tenía ese nombre, y es incorrecto. `notas.cliente_id` usa `on delete set null` (`20260810171324_qa_base_schema.sql`): al borrar una ficha, sus notas quedan sin vínculo y con el nombre como texto. Si después se creaba otro cliente con el mismo nombre, heredaba las notas del cliente borrado. Codex lo reprodujo también con una nota antigua `paciente = "Juan"` y un cliente nuevo llamado Juan.

Se vuelve al comportamiento de `ac8c171`:

- **Asociación sólo por ID:** una nota pertenece a una ficha únicamente por `cliente_id`.
- **Notas sin vínculo:** las que no tienen `cliente_id` (antiguas o de fichas borradas) siguen en «Todas las notas», marcadas «Sin vínculo a una ficha». No se atribuyen a ninguna ficha por nombre.
- **Vinculación manual:** desde Editar se elige la ficha por ID. Se guarda filtrando por negocio y exigiendo la fila devuelta.

**Consecuencia para el dueño:** las notas creadas antes de 43 nunca tuvieron `cliente_id`. Desde ahora dejan de verse en las fichas y en los contadores hasta que se vinculen a mano. Un backfill automático tendría que ser una decisión explícita, revisada por una persona, sólo con candidatos únicos **y** sin fichas borradas con ese nombre. No se hizo.

**Regresión:** `src/components/Notes.borrado-homonimo.test.jsx` simula el borrado con la semántica de `ON DELETE SET NULL` y crea otro «Juan». Comprueba:

- el contador, la ficha y Notas filtradas por esa ficha quedan vacíos;
- las notas siguen en «Todas las notas»;
- se pueden asociar a mano por ID.

Tres de las cuatro pruebas fallan con `d46e890`. `/demo` no aplica `SET NULL` porque no hay base, así que la regresión trabaja sobre los datos que deja la base tras el borrado.

**Revisado sin cambios:**

- alta por ID con fila devuelta;
- edición filtrada por negocio;
- homónimos distinguidos por el final del teléfono;
- «General» como nombre de cliente;
- un cliente que desaparece no hace perder el borrador;
- Deshacer de 06 y los accesos de 38.

**Pendiente:** roles, persistencia y frontera entre negocios con backend real.
