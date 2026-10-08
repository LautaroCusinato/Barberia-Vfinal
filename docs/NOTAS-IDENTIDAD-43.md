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
