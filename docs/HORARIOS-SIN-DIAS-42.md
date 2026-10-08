# Tarea 42 · Un profesional sin días no se reactiva al editar horas

Propuesta local para revisión independiente, sobre `integracion/austral-demo@a3c702c`.

## Evidencia y cambio

El serializer de Operación guarda `Sin dias asignados 09:00-18:00` cuando
se quita el último día. El parser del editor no reconocía ese estado y mostraba
Lun–Vie; una edición de la hora serializaba esos cinco días como activos.

La agenda normalizada ya reconoce ese marcador: `parseHorarioTexto` devuelve
`[]`. La corrección se limita al parser de `Operations.jsx`, que ahora
interpreta el mismo estado como conjunto vacío y conserva las horas elegidas.
Reutiliza `normalizar` para las variantes con tilde y mayúsculas. Un marcador
sin horas sigue sin días y conserva las horas iniciales del formulario.

No se cambia App, la sincronización SQL, roles, restricciones, datos remotos,
el serializer ni los formatos activos de jornadas/pausas. Tampoco se reemplaza
el parser general: el comportamiento previo de otros textos no reconocidos
sigue siendo una deuda a evaluar, sin mezclar una migración de horarios con
esta corrección concreta. No promete atomicidad del reemplazo de agenda.

## Pruebas y reproducción

`Operations.schedule.test.jsx` monta el componente y simula la devolución de
los props guardados, como ocurre en App. Seis casos:

- Reabrir sin días, con y sin tilde.
- Quitar el último día, cambiar la hora, desmontar y volver a abrir; la salida
  sigue convirtiéndose a agenda vacía y no ofrece slots para ese profesional.
- Agregar Sáb explícitamente reactiva sólo sábado.
- Error al guardar mantiene la jornada original y avisa.
- Editar una jornada activa conserva la pausa.

Antes del cambio: cuatro fallos y dos PASS. Después: seis PASS, junto con las
55 pruebas existentes de horarios (61 en total). Lint, npm test y build PASS.
Suite completa con threads/un worker/cache desactivado: **44 archivos / 637
tests PASS** (07/10/2026, Node 24.18.0). No se probó Node 22 de CI.
Log: `C:/Users/lauti/Documents/Codex/2026-10-03/quiero-que-armes-la-lista-completa/work/horarios-42-unit.log`.

## Navegador local, sólo demo

Servidor propio en 5198 durante la prueba; sin .env o conexión Supabase.
Se quitaron los siete días de Mateo, se cambió Desde a 10:00 y se recargó.
Los siete botones permanecieron con aria-pressed=false y Desde en 10:00.
No se alteró la demo integrada de 5195. Evidencia:
`C:/Users/lauti/Documents/Codex/2026-10-03/quiero-que-armes-la-lista-completa/work/42-sin-dias-demo.jpg`.

No se verificó base real, RPC pública/WhatsApp, móvil, dark mode, touch,
contraste nuevo (no hubo cambios CSS) o suite e2e. La otra IA debe revisar
el comportamiento en esos entornos y la combinación final al integrar.

## Entrega

Revisar el diff sobre a3c702c y repetir controles al integrarlo. La revisión
posterior de 41 y la propuesta 44 no forman parte de esta base; no copiar
los commits de la base por duplicado. La tarea sigue sin tildar.
