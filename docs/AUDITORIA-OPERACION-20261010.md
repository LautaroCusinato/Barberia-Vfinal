# Ediciones de Operación y recuperación por campo · 10/10/2026

Implementación local para revisión independiente; no completa la tarea.
Rama fix/auditoria-app-qa-20261009, base eaa1d14, carpeta
C:/Users/lauti/Documents/Codex/work/auditoria-app-qa-20261009.

## Evidencia y cambios

Tres regresiones de App + Operación con Supabase en memoria fallaron antes:

1. Nombre de servicio pendiente, precio 100→300 guardado, nombre rechazado:
   la base simulada conservaba 300 pero el rollback del objeto entero dejaba
   100 en el panel. Ahora restaura sólo el campo rechazado y conserva los otros.
2. En una misma cola, A se guardaba y B fallaba: el panel volvía al nombre
   anterior a A, distinto del confirmado. Cada trabajador de la cola conserva
   el último valor que logró guardar y lo usa al recuperar el campo.
3. Error de API al cambiar el nombre de un profesional: quedaba el nombre
   optimista aunque la base no lo hubiera guardado. Ahora recupera el campo y
   propaga false al formulario, también ante una excepción.

Pruebas adicionales descubrieron tres fallos en la primera corrección:
respuestas de cero filas en servicios/profesionales se aceptaban como éxito,
y una excepción vieja de profesional descartaba la edición siguiente. Ahora
las actualizaciones filtran ID + barberia_id y piden select('id'); sin la fila
esperada no confirman. Una excepción en la escritura principal deja avanzar
la última intención pendiente, que es una asignación al mismo campo/registro.

La cola compartida devuelve el resultado de la última escritura. Se mantienen
serialización por clave, descarte de valores intermedios y promesa compartida.
Errores de una escritura ya superada no anuncian fracaso de la más reciente.

## Verificación

App.operacion.audit.test.jsx tiene 8 casos del panel real y Operación real con
API simulada: otros campos guardados, último valor confirmado, error de API,
excepción conservando color, cero filas en las dos tablas y excepción vieja
con nueva intención. latestIntentQueue.test.js suma 1 caso de retorno false
de la última petición. Tests de horario de la tarea 42 siguen pasando.

Lint sin advertencias, npm test, 62 archivos/755 tests unitarios y build PASS.
Logs privados de este chat: work/auditoria-operacion-before.log (3 fallos),
auditoria-operacion-sin-confirmar-before.log (3 fallos adicionales),
auditoria-operacion-after.log y auditoria-operacion-{lint,contracts,unit,build}.log.
El build queda fuera del repo; no se publica. Vitest no carga .env.

No hubo e2e, pruebas visuales nuevas, escrituras remotas, cobros, reservas ni
mensajes. No se tocó el trabajo de los chats que revisan 48, 49 y 50/51.

## Límites importantes

- El rollback restaura el último valor confirmado conocido por esta cola,
  sólo si el campo sigue mostrando el intento rechazado. No pisa un valor
  distinto que ya haya llegado por una recarga externa.
- Un timeout/excepción no prueba que el servidor no escribió. Se muestra error
  y se requiere recarga para conocer el estado vigente; no hay snapshot ni
  control de versión nuevo. La UI no garantiza resolver conflictos entre dos
  operadores que editan el mismo campo.
- El SELECT del registro actualizado exige permisos de lectura además de los
  de escritura, ya necesarios para cargar el catálogo. Confirmar RLS/roles en
  QA antes de publicar; un backend que no devuelva filas falla cerrado.
- Horarios y habilidades tienen escrituras auxiliares separadas (texto,
  borrado e inserción de relaciones). Este parche no las vuelve atómicas ni
  garantiza disponibilidad coherente ante un fallo intermedio. Ese camino
  necesita una tarea propia; no se promete corregir todo el guardado del equipo.
- No cambia roles, RLS, contratos RPC, Edge Functions ni billing.

## Revisión e integración

Revisar el parche contra eaa1d14, buscando regresiones en cola, rollback por
campo, errores/no filas y cambios externos mientras guarda. Comprobar ambas
tablas con los roles reales autorizados cuando se apruebe QA. Integrar sólo
el commit de esta entrega después de resolver sus dependencias y conflictos
con App.jsx de otros chats; no publicar la rama completa automáticamente.
