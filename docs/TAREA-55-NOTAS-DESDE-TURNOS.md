# 55 · Identidad de las notas desde los turnos

Propuesta local del 10/10/2026, base `0e9067b`. Pendiente de revisión
independiente, integración y QA; no completada. No modifica la base.

## Fallo demostrado

TurnoRow buscaba las notas con `n.paciente === turno.paciente` y enviaba
solamente paciente/texto al guardar. Aunque la tarea 43 corrigió Clientes,
Notes y la ficha, este acceso compartido por Resumen, Agenda y Equipo
conservaba la asociación por nombre.

Una reproducción con dos Juan y fichas 1/2 mostró la nota de la ficha 2 en
el turno de la ficha 1. El componente también mostraba una nota antigua sin
vínculo y otra de un negocio explícitamente distinto cuando coincidía el
nombre. Una nota vinculada a la ficha 1 con nombre antiguo no aparecía.
App.addNota interpreta un payload sin cliente_id como una nota sin vínculo;
por eso una nota creada desde el turno no quedaba en su ficha.

Contra la base: 6/8 pruebas nuevas de TurnoRow fallaron (2 pruebas de
conservación del borrador ya pasaban). La primera prueba de App falló al
mostrar la nota del homónimo. Logs iniciales conservados en tareas/evidencias.
Con las 11 pruebas definitivas y sólo TurnoRow de 0e9067b, fallan 9 y pasan
las 2 de borrador. Se restauró el archivo corregido después del control.

## Corrección

- TurnoRow filtra con el helper existente notaDelCliente, por identificador,
  incluyendo la guarda de negocio cuando ambos datos lo declaran.
- Envía cliente_id al callback. App sigue resolviendo el nombre desde la ficha
  vigente y el backend conserva sus controles; la UI no autoriza una escritura.
- Usa clienteIdDelTurno: cliente_id explícito, incluido null, manda sobre
  paciente_id/clienteId de fixtures viejos. Nunca deduce por nombre.
- Si no hay vínculo, se pueden abrir las notas pero no crear una nota personal;
  se indica vincular la ficha desde Editar turno. No crea una nota general en
  silencio ni reasigna notas antiguas. Las notas sin vínculo siguen en Todas.
- Preserva el borrador ante rechazo o excepción y agrega nombre accesible al
  textarea. No cambia cobros, estados, arrastre, borrado/Deshacer ni origen Web.

El archivo turnoCliente.js coincide con el helper ya revisado en b95b93c de
la tarea 48 (diff sin diferencias). Se reutiliza su implementación, no se
incorpora todo ese commit ni se afirma que su revisión haya cubierto esta UI.
Al integrar 48/55, conservar una sola copia de ese helper y coordinar
TurnoRow con la tarea 54. No publicar la rama completa: contiene también 53.

## Pruebas

TurnoRow.notes.test.jsx: 8 casos, identidad, nombre antiguo, homónimos,
legado sin vínculo, negocio distinto, aliases, null explícito, payload y
borrador después de error. App.notasAgenda.test.jsx: 3 casos con App real y
store demo simulado, creación desde el turno → ficha → Notas, nombre vigente
y ficha desaparecida. No usa una base, servicios remotos ni e2e.

Pruebas focalizadas: 4 archivos/18 tests PASS (incluye pruebas existentes de 43).
Lint sin advertencias, npm test, suite completa 66 archivos/807 tests y build
PASS. Build fuera del repo con entorno local ficticio; no publicar ese artefacto.
Logs y SHA: consultar el registro final en tareas/55 y LEEME.

## Pendientes

Revisión independiente del diff y controles en la combinación integrada;
navegador 375/1366, claro/oscuro y teclado, especialmente el mensaje para
turnos sin ficha; persistencia y permisos/RLS en backend QA autorizado.
No hay backfill, migración ni cambios en RLS. Una colección ya cargada sin
barberia_id no acredita aislamiento remoto: lo mantiene la frontera de la base.
El guardado de notas conserva los límites previos de idempotencia y concurrencia.
