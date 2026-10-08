# Tarea 45: propuesta local para revisión independiente

Base: `integracion/austral-demo@45b6118`. Rama propia
`fix/ingresos-reales-45-codex`, carpeta `codex-ingresos-45`.
No integrada, no publicada y tarea NO completada.

## Fallo y comportamiento propuesto

Antes, un turno atendido de $10.000 sin fila en `pagos` sumaba $10.000 a
«Ingresos totales». Además, un pago desaparecía de ese indicador si su turno
no estaba cargado o dejaba de estar atendido.

Ahora:

- **Cobrado registrado:** suma `pagos.monto` de la colección leída, sin depender
  del estado del turno ni de que éste esté presente. No crea ni modifica pagos.
- **Promedio por cobro:** suma de montos / cantidad de registros de pago. Un
  cobro de monto cero cuenta; varios pagos del mismo turno cuentan por separado.
  No se presenta como promedio por servicio ni por cliente.
- **Valor estimado de atendidos sin cobro registrado:** suma `turno.precio` sólo
  de los atendidos cargados sin ningún pago vinculado cargado. No confirma deuda
  ni dinero recibido. Un pago de cero también excluye el turno de la estimación.
- **Cobrado por profesional:** agrupa los pagos por `barbero_id` del turno
  cargado. `pagos` no conserva ese dato: los turnos ausentes, eliminados o sin
  profesional quedan en «Sin profesional identificado». No asignar por nombre;
  dos profesionales homónimos tienen claves diferentes.
- **Caja de hoy:** pagos según `created_at` en la zona del negocio. La fecha
  del turno no decide la caja. Una fecha inválida no entra en hoy; el monto
  sigue en el total general y su historial dice «Fecha no disponible».

Los indicadores no tienen un selector de período: cubren los datos cargados;
el filtro del historial no altera las tarjetas. Sólo se trabaja en ARS según
decisión del dueño; la tarea 20 de moneda sigue postergada.

## Lectura segura y alcance

`crearCargaPagos` conserva el filtro por negocio y solicita `count: exact`.
Antes de confirmar los importes exige una respuesta sin error con todas las
filas del conteo. Si faltan filas por el límite de PostgREST, el conteo no llega
o falla la lectura, no publica un cero ni una suma parcial como total.

Estados `cargando`, `listo`, `error`, `incompleto` viajan desde App a Stats. Los
importes y las estimaciones muestran «—» cuando la lectura no está lista.
Un historial previo se conserva con aviso de posible desactualización. La
recarga Realtime/polling vuelve a usar el mismo lector; una respuesta antigua
no pisa una lectura más reciente y las respuestas tras desmontar se ignoran.

**Límite explícito:** no se implementa paginación de pagos; un negocio que
supera el límite ve el aviso en lugar de un total falso. Resolver paginación o
agregados de servidor es un paso separado que debe coordinarse con el chat que
revisa los límites de carga de turnos. Una lectura `listo` confirma únicamente
el conjunto visible por RLS en ese momento, no un cierre contable atómico.
Las estimaciones y la asignación de profesional todavía dependen de los turnos
cargados y pueden cambiar al completar su lectura. Los rótulos lo aclaran.

## Fronteras preservadas

No se cambian `registrar_cobro_turno`, CobroModal, inserts, idempotencia,
Realtime, roles, RLS, esquema, devoluciones, suscripciones, n8n ni WhatsApp.
El helper financiero no convierte nombres, estados ni precios en autoridad.
La lectura sigue siendo con la sesión del usuario, sin service_role. No se
hicieron pruebas ni escrituras en Supabase remoto.

## Pruebas y revisión pendiente

Pruebas locales nuevas: atendido sin pago, monto real diferente, pago huérfano,
turno cancelado con pago, varios cobros y monto cero, homónimos, zona horaria,
fecha inválida, lectura completa vacía, error, respuesta truncada y respuestas
fuera de orden. En componentes: rótulos, estimación separada, caja local, estados
sin cero falso e historial anterior advertido. Las 16 pruebas nuevas pasan.

Demo manual: 375 y 1366 px, ambos en claro y oscuro, sin scroll horizontal;
separación $0 cobrado / $17.000 estimado; filtros por teclado y consola sin
errores. No se probaron pagos reales, los errores de red en navegador, roles,
Realtime real, reduced-motion emulado ni consistencia bajo escrituras
concurrentes. No se ejecutó e2e. Resultados completos y SHA: tarea 45 canónica.

Para revisar: comprobar las definiciones anteriores, auditar el conteo exacto
con Supabase real antes de publicar y decidir si el aviso de colección
incompleta es suficiente para el piloto o requiere paginación previa. Integrar
App con cuidado: la otra IA está revisando las cargas de turnos en otra rama.
La revisión y la integración no habilitan despliegues automáticamente.
