# QA928 · panel y WhatsApp preparados para prueba manual

Estado al 09/10/2026: implementación verificada y backend actualizado en QA.
**No completa ninguna tarea. Falta la prueba física con teléfono vinculado.**
Worktree `qa-whatsapp-manual-928`, rama `fix/qa-whatsapp-manual-928`, base
`integracion/austral-demo@cc01298`. Revisar como parche; no arrastrar su base.

## Qué está disponible

Frontend actualizado local: `http://127.0.0.1:5196/`, con Supabase QA real
`cmsymmszlzikqpvfqjre`. Reserva: `/reservar/austral-prueba-lautaro`.
Cuenta confirmada del dueño `lcusinato@mail.austral.edu.ar`, negocio 928,
«Barbería Austral · Prueba». Sólo URL y clave pública llegan al frontend.
El dominio QA publicado conserva el código previo: este avance no publica
la rama de frontend ni incorpora 46/47 u otros parches fuera de `cc01298`.

El panel permite regenerar un QR vencido y ocultarlo al vencer sus 45 segundos.
Las capacidades públicas permanecen apagadas hasta una conexión confirmada.
Generar el QR no vincula el teléfono: el dueño debe escanearlo y actualizar
el estado desde la interfaz. No se fuerza `CONNECTED` en la base.

## Backend y frontera de seguridad

- Habilitación manual exclusiva de QA928, instancia `austral-qa-tenant-928`,
  entorno shadow y ref exacto QA. Hosts por prefijo, producción y otros
  negocios se rechazan. Sólo los dos teléfonos propios autorizados responden.
- El envío del panel vuelve a validar el teléfono bajo lock de la ficha,
  antes de insertar/pausar/enviar. Falta de RPC nueva falla sin fallback.
  La defensa posterior a la reserva también rechaza un destino fuera de lista.
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

Actualizadas en QA: `whatsapp-evolution-webhook`,
`whatsapp-agent-outbound-pilot`, `whatsapp-booking-mutation`,
`whatsapp-panel-send`. `whatsapp-provision` ya desplegada coincide con el repo.
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
No se borraron instancias ni mensajes. `miwsp` devolvió 500, pero una consulta
posterior confirmó `close`; no se interpretó el error como ausencia de efecto.
Backup privado del servidor: `/home/lautaro/austral-qa928-backup-20261009/`.
Volver a vincular una conexión cerrada requiere escanear su QR; un backup
de configuración no restablece por sí solo una sesión de WhatsApp.

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

Escanear uno de los dos teléfonos en Configuración; usar el otro como cliente.
Comprobar CONNECTED, mensaje visible, respuesta única, enlace web/chat,
reserva por ambos canales con una ficha, agenda y confirmación en WhatsApp.
Luego pausar/reanudar bot, iniciar chat desde Clientes, error de proveedor,
horario ocupado/bloqueado y permisos. No tildar tareas por simulación o por QR.

No hay un drenaje periódico de recibos: la reparación ocurre al reintentar
el evento. Medios/audio y LID sin teléfono alternativo conservan límites previos.
Siguen pendientes Realtime y volumen reales, integración de otras ramas,
billing QA heredado y la diferencia entre intervalo configurado y RPC de slots.
No se publicó frontend, no hubo push/merge ni escrituras en Supabase producción.
