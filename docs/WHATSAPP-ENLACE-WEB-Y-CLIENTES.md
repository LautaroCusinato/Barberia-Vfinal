# WhatsApp: enlace de reserva web o reserva por chat, y ficha única de cliente

Tarea 35. Estado: **implementada localmente; pendiente de la prueba integral real
de la tarea 36.** Nada de esto está desplegado en QA ni en producción.

## Qué circuito cambia

El circuito que recibe los mensajes de las instancias QA es
`Evolution → whatsapp-evolution-webhook (Supabase QA) → propuesta persistida`.
La respuesta se envía con `whatsapp-agent-outbound-pilot` y la reserva por chat
se guarda con `whatsapp-booking-mutation`; ambas las invoca un operador con el
`event_id` persistido. Sólo el tenant QA 1 (`austral-qa-tenant-1`) puede agendar
por chat. El workflow n8n QA (tenant 819) no agenda ni ofrece el enlace: no es
parte de este cambio. Las plantillas de producción no se tocaron.

## Conversación

1. Saludo o consulta general, o intención de reservar sin datos concretos:
   > ¡Hola! Gracias por escribir a {negocio}. Podés reservar online acá: {enlace}. Si preferís, también podemos coordinar tu turno por este chat. ¿Cómo te queda más cómodo?

   Si el negocio no puede agendar por chat (otro tenant o piloto apagado), el
   saludo ofrece sólo el enlace y no promete reservar por chat.
2. Si el primer mensaje ya pide un turno concreto (servicio, día u hora), se
   sigue con la reserva sin obligar a elegir.
3. El saludo no se repite durante 12 h por conversación (negocio, integración,
   instancia y remitente), ni ante webhooks duplicados (deduplicación por
   `event_id` ya existente) ni durante una confirmación. La marca
   `channel_offer_at` se guarda en el estado persistido de la conversación, así
   que sobrevive a reintentos y reinicios.
4. "Por la web" (después del saludo): respuesta sin repetir el enlace; no
   agenda y descarta una reserva por chat en curso. "Pasame el link": reenvía
   el enlace (o dice que no hay uno, sin cortar la reserva por chat).
5. "Por acá": `Dale, seguimos por acá.` y continúa la reserva por chat.
6. Cliente nuevo por chat: antes de consultar disponibilidad se pide
   `¿A nombre de quién dejo el turno?`. El teléfono no se pide: es la identidad
   verificada del proveedor. El resumen incluye el nombre y requiere
   confirmación explícita. Cliente existente: no se pide nombre ni se revela su
   ficha.
7. La respuesta a "Sí" no afirma que el turno quedó reservado. La función de
   reserva devuelve `confirmation_reply` (por ejemplo `¡Listo! Tu turno de …
   quedó reservado para el …`) **sólo** después de guardar el turno. Enviarlo
   por WhatsApp no está cableado: el outbound actual sólo envía propuestas
   persistidas y su guarda rechaza afirmaciones de reserva. Ver tarea 36.
8. Pausa por atención humana (`config.bot_activo` distinto de `true`): el
   webhook no genera propuesta (`bot_paused`), el outbound vuelve a leer la
   pausa antes de enviar y la reserva por chat se rechaza. Error al leer la
   pausa: no responde.

## Enlace

`https://<origen>/reservar/<slug>`, con:

- `slug` del negocio resuelto en el servidor desde la instancia; formato
  `[a-z0-9-]`, sin datos personales ni tokens en la URL.
- `WHATSAPP_PUBLIC_BOOKING_ORIGIN`: origen https público (sin ruta, query,
  credenciales, localhost, `.local/.test` ni IP).
- `WHATSAPP_PUBLIC_BOOKING_ENVIRONMENT`: debe ser `qa` en el proyecto QA. Si no
  coincide con el entorno del runtime no hay enlace. QA nunca enlaza a
  `https://barberia-177.pages.dev` (frontend productivo).
- `barberias.reservas_publicas = true`.

Si falta cualquiera de esas condiciones no se ofrece ni se inventa un enlace.

## Clientes

- Clave: `(barberia_id, telefono canónico)`; canónico = `549` + área + número
  (13 dígitos), igual que la reserva web. Un JID `54` + 10 dígitos se completa
  con el 9. Un `@lid` sólo se usa con `remoteJidAlt` de teléfono (misma regla
  que el workflow QA de n8n); sin alternativa no se trata como teléfono.
- Mismo teléfono en otro negocio: otra ficha. No se fusionan fichas históricas
  ni se unen personas por nombre o email.
- Saludar o abrir el enlace no crea fichas. La ficha se crea o reutiliza al
  guardar la reserva (`crear_reserva_publica` o `crear_reserva_whatsapp`).
- Ficha existente: ni la web ni el chat reemplazan nombre o email; sólo
  completan datos vacíos. El nombre informado queda en el turno.
- Se eliminó el nombre de relleno `E2E_QA_A_CLIENTE`: un cliente nuevo sin
  nombre confirmado no se agenda (`customer_name_required`).

Migración: `supabase/migrations/20261004120000_whatsapp_cliente_unico.sql`
(`create or replace` de `crear_reserva_whatsapp`, misma firma y grants;
rollback = volver a aplicar la definición de `20260806150000`).

## Pruebas locales

- `node scripts/verify-whatsapp-link-and-customer.mjs` (en `npm test`): módulos
  puros y los handlers reales de las tres funciones contra un Supabase en
  memoria. Es simulación: no hay WhatsApp, Evolution, n8n ni base real.
- `bash scripts/sql/whatsapp-cliente-unico/run.sh`: Postgres 18 efímero con las
  RPC web y WhatsApp reales; línea de base con la definición anterior (que
  sobrescribía el nombre), migración dos veces, 24 comprobaciones y rollback.

## Para desplegar y probar en QA (tarea 36)

Antes de desplegar, confirmar en QA (`cmsymmszlzikqpvfqjre`), sin tocar producción:

1. Que `barberias` tiene `reservas_publicas` y que el tenant 1 tiene `slug`,
   servicios, profesional y jornada; que `crear_reserva_publica` es la versión
   de `20261002092000` (si no, la web podría sobrescribir fichas).
2. El origen web QA que abre `/reservar/<slug>` contra la base QA desde un
   teléfono. `barberia-qa.cuchitron.lat` es candidato (Pages
   `barberia-qa-pages`, rama `qa-release-candidate`), pero **no está verificado
   que use la base QA ni que tenga este código**.
3. Las identidades: Negocio QA = `austral-qa-tenant-1`; Cliente QA = la otra
   instancia, cuyo número debe coincidir con `WHATSAPP_OUTBOUND_QA_RECIPIENT` y
   su hash con `WHATSAPP_OUTBOUND_QA_RECIPIENT_HASH` (hash del JID con
   `@s.whatsapp.net`).

Despliegue acotado a QA, con copia previa de configuración:

1. Aplicar sólo `20261004120000_whatsapp_cliente_unico.sql`.
2. Desplegar `whatsapp-evolution-webhook`, `whatsapp-booking-mutation` y
   `whatsapp-agent-outbound-pilot` (comparten `_shared/`).
3. Secretos QA: `WHATSAPP_PUBLIC_BOOKING_ORIGIN=<origen QA verificado>`,
   `WHATSAPP_PUBLIC_BOOKING_ENVIRONMENT=qa`. Para la reserva por chat,
   `WHATSAPP_BOOKING_MUTATION_PILOT_ENABLED=1` sólo durante la prueba.
4. Cablear el envío de `confirmation_reply` después de una reserva guardada
   (no existe todavía) o registrar que la confirmación por WhatsApp queda
   pendiente.

Rollback: redeploy de las tres funciones desde el commit anterior, quitar los
dos secretos nuevos y reaplicar la definición anterior de la RPC.
