# Borrado con Deshacer — propuesta local de tarea 06

Pendiente de revisión y QA. La lista cargada se mantiene separada de las marcas
de borrado para turnos, notas y bloqueos. Realtime puede actualizarla mientras
la fila está oculta. Deshacer retira la marca: no reinserta un snapshot viejo.
En demo se guarda la lista base mientras el borrado está pendiente.

La espera dura cinco segundos. Deshacer cancela; el cierre tiene el nombre
accesible «Eliminar ahora» y confirma. Si otro aviso desplaza al pendiente,
se cancela ese borrado, no se confirma anticipadamente. «Eliminado» se muestra
sólo después de confirmar. El DELETE filtra tabla permitida, negocio, id y
updated_at cuando la fila lo tiene; requiere devolver exactamente el id borrado.
RLS conserva la autoridad. No se modificaron RPC, políticas ni migraciones.

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

Pruebas locales: deferredDeletes.test.js y useDeferredDeletes.test.jsx,
30 casos con reloj y adaptador simulados. Pendiente: revisar integración de App,
RLS real de DELETE/SELECT, Realtime, cierre/reapertura, varios avisos, teclado,
movimiento reducido y concurrencia en QA. La fila sin updated_at no tiene
protección de versión: revisar ese límite antes de ampliar el contrato.

Base de esta rama: a8294bf (avances 07/08). No incluye 09 ni rediseño 37.
Revisar el commit de 06 por separado y repetir controles al integrar.
