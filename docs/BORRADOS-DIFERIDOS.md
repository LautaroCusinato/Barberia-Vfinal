# Borrado con Deshacer — propuesta local de tarea 06

Pendiente de revisión y QA. La lista cargada se mantiene separada de las marcas
de borrado para turnos, notas y bloqueos. Realtime puede actualizarla mientras
la fila está oculta. Deshacer retira la marca: no reinserta un snapshot viejo.
En demo se guarda la lista base mientras el borrado está pendiente.

La espera dura cinco segundos. Deshacer cancela; el cierre tiene el nombre
accesible «Eliminar ahora» y confirma. Con más de dos avisos salen primero
los informativos; si todos ofrecen Deshacer, el más viejo se confirma como si
hubiera vencido (revisión 05/10: cancelarlo hacía reaparecer en silencio la
primera de tres filas borradas seguidas). «Eliminado» se muestra sólo después
de confirmar. El DELETE filtra tabla permitida, negocio e id y requiere
devolver exactamente el id borrado. RLS conserva la autoridad. No se
modificaron RPC, políticas ni migraciones.

Al cambiar de negocio o desmontar se cancelan los pendientes sin enviar.
pagehide descarta los que todavía no comenzaron: no dispara peticiones.
beforeunload solicita la advertencia nativa durante la espera o el envío,
pero el navegador puede omitirla. Una petición ya iniciada puede persistir
aunque se cierre la página: no hay garantía de cancelación ni de entrega.
Tras un error se muestra la última fila cargada y se pide actualizar; no se
reintenta automáticamente. Una respuesta de otro contexto no modifica el actual.

Las marcas de borrados confirmados remotos permanecen durante el contexto del
panel para filtrar consultas antiguas que lleguen tarde. Se liberan al cambiar
de contexto/desmontar. En demo no se retienen, porque los ids pueden reutilizarse.
Este mecanismo no reemplaza una garantía transaccional o de persistencia.
La lista filtrada conserva su identidad mientras no cambien la base ni las
marcas, para no recalcular memos y efectos de la agenda en cada render.

Sin control de versión (revisión 05/10): cambiar estado, editar, cobrar o
editar una nota actualiza la fila local pero no trae el updated_at nuevo que
pone el trigger, así que filtrar por esa columna rechazaba borrados válidos
hasta la próxima recarga (siempre para notas si Realtime está caído). Una
edición de otra sesión durante los cinco segundos no impide el borrado, igual
que antes de esta tarea. Para recuperar esa protección, las escrituras locales
deben devolver updated_at; la misma limitación afecta el arrastre de 07.
Si el borrado no se programa (p. ej. hay un movimiento guardándose), la fila
de turno o la nota dejan de colapsarse en vez de quedar ocultas.

Pruebas locales: deferredDeletes.test.js, useDeferredDeletes.test.jsx y
Notes.test.jsx, 34 casos con reloj y adaptador simulados. Pendiente en QA:
RLS real de DELETE/SELECT, Realtime, cierre/reapertura, varios avisos, teclado,
movimiento reducido y concurrencia.

Base de esta rama: a8294bf (avances 07/08). No incluye 09 ni rediseño 37.
Revisar el commit de 06 por separado y repetir controles al integrar.
