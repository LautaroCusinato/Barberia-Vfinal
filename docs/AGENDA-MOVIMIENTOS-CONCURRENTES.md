# Movimientos de turnos y Deshacer — tarea 07

## Cambio preparado localmente

El calendario mantiene la tarjeta en el destino provisional mientras se guarda. `App` conserva la posición confirmada; ya no hace un segundo cambio optimista ni restaura snapshots viejos al fallar. Una cola por turno envía cada movimiento después de resolver el anterior. Turnos distintos pueden guardarse en paralelo.

Si se piden A→B→C rápidamente, primero se intenta B. Si B falla, C se intenta desde A; si B se confirma, C se intenta desde B con la versión que devolvió el servidor. El aviso con Deshacer sólo se ofrece para el último movimiento confirmado cuando no hay otro movimiento posterior pedido. Un Deshacer viejo, repetido, invalidado por editar/eliminar o perteneciente a otro contexto no escribe.

Mientras hay un movimiento pendiente, guardar una edición o eliminar ese turno muestra una indicación de esperar. El formulario conserva su borrador. Cambiar de semana, modo de calendario o profesional cancela un arrastre aún no soltado; Escape, pointercancel y desmontaje también lo cancelan. El destino se revalida al soltar.

## Persistencia y permisos

`persistirMovimiento` actualiza únicamente fecha y hora, filtrando por negocio, turno, versión `updated_at` y posición anterior. Solicita la fila modificada para conservar su nueva versión. Una respuesta sin filas nunca se presenta como éxito. No reintenta un UPDATE sin filtros ni modifica políticas, triggers, RPC, migraciones o funciones remotas.

La columna `updated_at` y su trigger están declarados en `supabase/migrations/20260810171324_qa_base_schema.sql`. Las políticas de staff están declaradas en `20261003090000_invited_roles_agenda_access.sql`, y las reglas de agenda en `20260801030000_turno_business_rules.sql`. El filtro cliente evita sobrescribir versiones anteriores; la autorización sigue perteneciendo a RLS y los triggers siguen validando el horario.

Si falta la versión, se rechaza el movimiento y se solicita actualizar la agenda. Si la conexión se corta, la respuesta puede ser incierta: se conserva el último estado confirmado localmente y se pide actualizar para comprobar la base. No se promete que un timeout signifique que el servidor no guardó. Las siguientes escrituras conservan el control de versión.

Cambiar de negocio/demo o desmontar el panel cierra la cola: no inicia operaciones pendientes ni aplica respuestas o avisos al nuevo contexto. Una petición ya enviada puede terminar en el servidor; cerrar la pantalla no la cancela retroactivamente.

## Pruebas locales

- `src/lib/turnoMoves.test.js`: serialización, fallos, respuestas invertidas entre turnos, Deshacer viejo/repetido, versión posterior, cierre de contexto y contrato de persistencia con Supabase simulado.
- `src/lib/useTurnoMoves.test.jsx`: estado React y ciclo de vida en StrictMode, respuestas atrasadas, aislamiento al cambiar de negocio y desmontaje.
- `src/components/Calendar.test.jsx`: posición provisional frente a respuestas viejas, mouse/touch, scroll antes de la pulsación larga, Escape, pointercancel, cambio de semana, desmontaje y destino que se ocupa antes de soltar.

Las pruebas de geometría usan jsdom con medidas controladas. No sustituyen una revisión del CSS, accesibilidad o funcionamiento táctil en dispositivos reales. El cliente simulado no demuestra las políticas RLS desplegadas.

## Pendiente para revisión y QA

1. Revisar el diff y repetir lint, `npm test`, `npm run test:unit` y build sobre la rama donde se integren los cambios.
2. Confirmar en QA que `updated_at` cambia en cada UPDATE, que las políticas permiten devolver la fila al operador autorizado y que una cuenta ajena o sin permiso no puede moverla. No cambiar producción.
3. Probar con dos operadores QA: uno modifica el turno mientras el otro conserva la versión anterior. El segundo movimiento/Deshacer debe ser rechazado sin pisar el primero. Actualizar la agenda y repetir con la nueva versión.
4. Revisar mouse y touch reales, edición por teclado, navegación, aviso de éxito y error, con ancho móvil/escritorio. Probar horario ocupado, bloqueado y fuera de jornada con las reglas reales de QA.
5. Comprobar pérdida de conexión antes y después de enviar: la actualización de la agenda debe reconciliar el resultado incierto. Este cambio no rediseña la carga general de snapshots de Realtime ni el Deshacer de eliminaciones (tarea 06).

No desplegar, hacer push, merge, modificar configuración remota ni probar con datos productivos sin aprobación del usuario. Las verificaciones E2E requieren autorización específica.
