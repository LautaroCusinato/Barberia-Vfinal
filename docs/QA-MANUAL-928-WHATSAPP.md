# QA928 · panel y WhatsApp preparados para prueba manual

Estado al 09/10/2026: implementación verificada y backend actualizado en QA.
**No completa ninguna tarea. Falta la prueba física con teléfono vinculado.**
Worktree `qa-whatsapp-manual-928`, rama `fix/qa-whatsapp-manual-928`, base
`integracion/austral-demo@cc01298`. Revisar como parche; no arrastrar su base.

## Qué está disponible

Frontend actualizado online: `https://barberia-qa.cuchitron.lat/`, con Supabase
QA real `cmsymmszlzikqpvfqjre`. Reserva: `/reservar/austral-prueba-lautaro`.
Cuenta confirmada del dueño `lcusinato@mail.austral.edu.ar`, negocio 928,
«Barbería Austral · Prueba». Sólo URL y clave pública llegan al frontend.
Se publicó el build de `933b281` directamente con Wrangler en el proyecto
Pages `barberia-qa-pages`, rama de publicación `qa-release-candidate`, sin push
ni merge. Deployment `a7a1237b-b7e6-4ad6-a9b1-24e642228f7b`; release público
`/qa-release.json`. El proyecto Pages de producción conserva su deployment
`cad0347a-43a6-47de-aaed-b3b2b6409371`. No incorpora 46/47 ni parches fuera
de la base `cc01298`. El código del panel se mantiene igual en esta entrega;
las mejoras posteriores de recepción/desconexión son del backend.

El panel permite regenerar un QR vencido y ocultarlo al vencer sus 45 segundos.
Las capacidades públicas permanecen apagadas hasta una conexión confirmada.
Generar el QR no vincula el teléfono: el dueño debe escanearlo y actualizar
el estado desde la interfaz. No se fuerza `CONNECTED` en la base.

## Backend y frontera de seguridad

- Habilitación manual exclusiva de QA928, instancia `austral-qa-tenant-928`,
  entorno shadow y ref exacto QA. Hosts por prefijo, producción y otros
  negocios se rechazan. Por autorización explícita del dueño el 09/10, QA928
  admite cualquier cliente que le escriba por texto directo con un celular
  argentino válido; no requiere lista por cliente. Los pilotos anteriores
  mantienen sus restricciones. El teléfono se persiste desde el webhook
  autenticado y debe coincidir con su hash antes de responder o reservar;
  nunca se toma un destino arbitrario del body de n8n.
- El envío del panel vuelve a validar el teléfono bajo lock de la ficha,
  antes de insertar/pausar/enviar. Falta de RPC nueva falla sin fallback.
  En modo abierto usa como lista de un elemento el teléfono que leyó de la
  ficha autorizada. Rechaza un cambio concurrente y conserva la defensa
  posterior a la reserva; no habilita enviar a un teléfono pasado por el cliente.
- El receptor persiste texto entrante antes de evaluar la pausa del bot.
  Un contacto nuevo tiene una ficha provisional; no sirve como nombre para
  reservar. Se completa con el nombre del chat o de una reserva web, en la
  misma ficha, conservando nombres reales y ediciones del equipo.
- Las respuestas aparecen como `aceptado` sólo con ID real de Evolution;
  no se inventa entrega al teléfono. Se conserva un recibo durable antes de
  guardar Mensajes. Su reparación no vuelve a enviar, aun si el evento quedó
  viejo o el canal se desconectó/apagó. Sin recibo, siguen los gates de envío.
  Cambiar ID del proveedor, autor, teléfono o texto de un replay es conflicto.
- Los pilotos previos conservan sus caminos. No se modifican RLS, planes,
  precios ni contratos generales de reserva/cobro/envío del panel.

## Migraciones aplicadas en QA, en orden

1. `20261009120000_qa_manual_panel_recipient_lock.sql`: RPC manual acotada;
   requiere la migración de envío atómico `20261005120000` ya aplicada en QA.
2. `20261009121000_qa928_whatsapp_messages.sql`: marcador provisional y RPC
   de mensajes sólo service_role, identificadores e índice por operación.
3. `20261009140000_qa928_promote_web_customer.sql`: trigger invoker únicamente
   para el placeholder exacto de QA928 tras una reserva web confirmada.

Se aplicaron en una transacción con guardas de proyecto/cuenta/metadata y
registro de versiones/fuentes; se recargó PostgREST. Rollbacks en
`scripts/sql/qa-manual-panel`, `qa928-whatsapp-messages`, `qa928-web-customer`.
Apagar primero el modo manual y revertir funciones. Conservar fichas,
mensajes, turnos e identificadores; no hay limpieza destructiva de historial.

## Funciones y n8n

Actualizadas en QA: `whatsapp-provision`, `whatsapp-evolution-webhook`,
`whatsapp-agent-outbound-pilot`, `whatsapp-booking-mutation`,
`whatsapp-panel-send`. Se conservó el valor previo de `verify_jwt` de cada
función y su autenticación interna. No se amplían los privilegios de los usuarios.
Se preservaron módulos y trabajo previo de QA; backups antes de actualizar.

Workflows activos: `5xwy7owfGgReEUat` (10 nodos, ruta
`austral-qa-manual-928`) y `australQa928Panel` (11 nodos, ruta
`austral-qa-panel-send-928`). Ambos autentican el webhook con la credencial
QA928 existente antes de aceptar el pedido. La ruta conserva además su guard
de secreto/negocio/evento; las funciones resuelven de nuevo el origen persistido.
No guardan ejecuciones exitosas, fallidas o manuales con headers/textos.
Las plantillas versionadas se importan inactivas y sólo referencian credenciales.

Se cerraron las conexiones antiguas `miwsp`, `austral-qa-tenant-819` y
`austral-qa-tenant-927`, por autorización del dueño sobre sus dos teléfonos.
No se borraron esas instancias ni mensajes. `miwsp` devolvió 500, pero una consulta
posterior confirmó `close`; no se interpretó el error como ausencia de efecto.
Backup privado del servidor: `/home/lautaro/austral-qa928-backup-20261009/`.
Volver a vincular una conexión cerrada requiere escanear su QR; un backup
de configuración no restablece por sí solo una sesión de WhatsApp.

Al desconectar desde el panel online se reprodujo un HTTP 502 con código
`evolution_http_400`: Evolution no permite logout de un QR que nunca se vinculó.
Se corrigió y probó el caso. Únicamente puede cancelar/eliminar la instancia
nueva QA928 si no tiene dueño ni número y los tres conteos (Message, Chat,
Contact) son exactamente cero, con señales cerradas/en conexión; confirma
su ausencia antes de guardar DISCONNECTED. No elimina instancias con historial,
otro tenant ni señales abiertas/desconocidas. Un fallo de logout con cierre
real se acepta sólo tras verificarlo; una respuesta 200 sin cierre no se acepta.
La nueva instancia vacía 928 se respaldó y canceló. La acción online devolvió
HTTP 200 y DISCONNECTED. «Volver a conectar» la recrea con su webhook desde
el panel cuando el dueño lo decida; esta entrega no genera ni escanea el QR.

## Evidencia y controles

En el directorio privado de este chat `work/qa-manual-runtime/`:

- `check-lint-final-ready.log`, `check-contracts-final-ready.log`: PASS;
  se ampliaron controles del webhook al añadir autenticación previa.
- `check-unit-resumed.log`: 58 archivos, 715 tests PASS; sin e2e.
- `check-build-resumed.log`: PASS, salida fuera del repo.
- `check-panel-sql-lock.log`: dos sesiones reales, rechazo del teléfono
  cambiado concurrentemente, cero mensajes/pausas; rollback PASS.
- `check-messages-sql-final.log`: grants, replay, conflicto de ID proveedor,
  ráfagas/eventos concurrentes, ficha única, rollback/reaplicación PASS.
- `check-web-customer-sql.log`: reproduce primero el placeholder desde RPC
  web real; promoción, otro negocio, autorización apagada y carrera con una
  edición del equipo PASS. Esquema fixture, no QA remoto.
- `qa928-real-sql-rollback.log`: en QA real se verificaron persistencia,
  ficha única y promoción por RPC web; la prueba se revirtió y no deja filas
  sintéticas. RLS sigue habilitada y RPC de mensajes denegada a anon/authenticated.
- `QA-928-new-migrations-sha.json`, `qa928-migrations-applied.log`: fuentes
  SHA256 y registro QA. `qa928-final-probes-authenticated.log`: auth y rechazo
  por instancia sin teléfono; no manda mensajes.

## Pendiente para revisión y prueba física

El dueño hará toda la prueba. Entrar a Configuración online con su cuenta,
«Volver a conectar» y escanear el número del negocio. Su teléfono personal
…2851 será el cliente; el negocio debe usar un número distinto (puede ser
…0107). No usar `/demo`: este panel de la cuenta persiste en QA real.
Comprobar CONNECTED, mensaje visible, respuesta única, enlace web/chat,
reserva por ambos canales con una ficha, agenda y confirmación en WhatsApp.
Luego pausar/reanudar bot, iniciar chat desde Clientes, error de proveedor,
horario ocupado/bloqueado y permisos. No tildar tareas por simulación o por QR.

No hay un drenaje periódico de recibos: la reparación ocurre al reintentar
el evento. Medios/audio y LID sin teléfono alternativo conservan límites previos.
Siguen pendientes Realtime y volumen reales, integración de otras ramas,
billing QA heredado y la diferencia entre intervalo configurado y RPC de slots.
No hubo push/merge ni escrituras en Supabase producción. Se publicó únicamente
el frontend del proyecto QA. Controles adicionales de esta entrega: recepción,
reserva y confirmación simuladas desde un tercer teléfono fuera de la lista
antigua; destino adulterado rechazado; cancelación de QR y protección de historial;
lint, npm test, test:unit y build. Evidencia en `online-qa-before.json`,
`online-qa-after.json`, `online-qa-postflight.json`, `check-*-open-customers.log`
y `whatsapp-before-open/`. El último directorio respalda fuentes desplegadas,
comparadas sin diferencias contra `933b281` antes de actualizar cinco funciones.

## Fallos encontrados por el dueño · 09/10/2026

La prueba física mostró tres problemas. Esta entrega queda para revisión
independiente; no cierra las tareas por pruebas simuladas.

- La reserva pública reemplazaba los botones por esqueletos cada 30 segundos.
  El sondeo del mismo servicio/día ahora conserva los controles, el foco y
  la selección válida. Un cambio de contexto sigue mostrando carga; un horario
  ocupado se invalida. Un error transitorio del catálogo conserva el borrador.
  La confirmación vuelve a consultar catálogo/horarios y la RPC mantiene sus
  validaciones autoritativas.
- El turno web 44 (10/10, 12:00) estaba guardado, pero la publicación
  `supabase_realtime` de QA no tenía ninguna tabla. La migración aditiva
  `20261009233000_panel_realtime_publication.sql` publica las diez tablas
  suscriptas por App, sin cambiar RLS, grants, RPC ni REPLICA IDENTITY.
  No publica las tablas internas del bot. Se probó dos veces dentro de una
  transacción revertida: owner ve 2 turnos propios, 0 ajenos y anon bloqueado.
  Luego se aplicó y registró sólo en QA. Una suscripción autenticada con los
  diez filtros del negocio 928 devolvió SUBSCRIBED.
- «Corte de pelo» coincidía con Corte clásico y Corte + barba. El estado
  mantenía service_id vacío y repetía una pregunta sin opciones. Ahora muestra
  las opciones concretas del catálogo del negocio; elegir «Corte clásico»
  avanza al día. No elige automáticamente un combo ni inventa servicios.
- App vuelve a leer los datos al recuperar el foco o reconectarse, cubriendo
  cambios guardados entre la lectura inicial y la suscripción. No remonta el
  panel ni borra un borrador de mensaje.

El saludo observado tardó 29,5 s: inbound 22:42:01 UTC, propuesta 22:42:27,7,
mensaje saliente guardado 22:42:30,5. Las cuatro respuestas siguientes tardaron
3,9–5,3 s. Fueron deterministas, sin llamada al modelo. No se pudo obtener el
log de ejecución de Supabase: el conector rechaza la autenticación, y el log
de Evolution no conserva entradas útiles de esa ventana. No se atribuye la
demora a una causa sin evidencia. Se paralelizaron tres lecturas independientes
después de validar la pausa; nuevos eventos guardan processing_started_at y
proposed_latency_ms para distinguir la llegada al proceso de su duración.
Queda pendiente medir el primer mensaje real después de la publicación.

Reversión de QA: el inventario previo era vacío; quitar las diez tablas de
`supabase_realtime` revierte sólo esta entrega, sin perder datos. En otro
entorno, comparar el inventario previo y quitar exclusivamente las tablas
añadidas allí. Conservar el fallback del panel durante la reversión.

Controles: lint, npm test, 58 archivos/719 tests unitarios y build PASS.
Evidencia privada: check-*-defects.log, realtime-migration-dry.sql,
realtime-migration-apply.sql, read-current-defects.mjs y whatsapp-before-defects/.
El respaldo de funciones coincide con 8ed68b7. No se enviaron mensajes ni se
desconectó la sesión del dueño para probar estos arreglos. Publicación del
frontend y webhook QA registrada en tareas al terminar; producción intacta.

## Silencio después de confirmar por chat · 09/10/2026

El dueño envió «Sí» a las 20:14 para Barba, 10/10, 09:00. El evento 4641
se persistió como confirmed, pero sin barber_id. Una invocación autenticada
de la función real devolvió HTTP 409/barber_selection_required, sin turno.
Había dos profesionales disponibles. El flujo activo de n8n tenía la salida
genérica «Reserva no guardada», que marca error sin responder al cliente.

Ahora recordAvailabilityResult pide profesional antes de confirmar cuando
la RPC ofrece varios para el horario solicitado. Las opciones son del negocio
y del horario; nombres duplicados por filas de slots no se repiten. «Cualquiera»
elige sólo entre esos candidatos y vuelve a validar la disponibilidad. Si se
eligió un profesional, un horario de otro no se considera válido para él.

Para propuestas anteriores ya confirmadas y sin profesional, booking-mutation
persiste una pregunta de elección, con un cambio condicionado al estado
confirmed del evento. No crea turno y devuelve booking_follow_up. n8n tiene
un IF nuevo «¿Falta elegir barbero?» que entrega esa respuesta persistida por
el envío normal idempotente. Repetir el evento no duplica el mensaje. Si existe
un reclamo de reserva completado o incierto, se corta la recuperación; tampoco
se rebajan controles de pausa, identidad, actor, entorno o pertenencia.

El respaldo remoto de tres funciones coincide con b97671d; el workflow activo
también fue respaldado antes de cambiarlo. Se conservan credenciales y ajustes
de privacidad de n8n. No se modifica el workflow del panel ni Evolution.
No hay migración ni frontend nuevo en esta entrega.

Controles: lint, npm test, 58 archivos/719 tests unitarios y build PASS.
El harness real de las funciones añade casos de dos profesionales, cualquiera,
elección explícita no disponible, recuperación de una propuesta vieja, replay,
reserva con el profesional elegido y bloqueo frente a reclamo en curso. El
mock ahora ejecuta update.select.maybeSingle y filtros JSON, como la API real.
Queda para revisión independiente; registrar despliegue y resultado de la
recuperación real en tareas. No se marca WhatsApp integral como completado.
