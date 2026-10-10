# Conversación con nombre, opciones y consultas · 09/10/2026

Estado: publicada y activada exclusivamente en QA928. Pendientes revisión
independiente y recorrido físico del dueño; los contratos simulados no cierran
la tarea. No modifica frontend, esquema, RLS, permisos ni contratos de RPC.

La captura del dueño mostró que el bot agendaba sin confirmar el nombre y
respondía «¡Hola! ¿En qué te puedo ayudar?» incluso a «Como me llamo?» y
«Decime vos». El cliente ya existía por una reserva web; eso explicaba la
ausencia del paso de nombre, pero no justificaba la respuesta genérica.

Nuevo modo, sólo con WHATSAPP_QA_MANUAL_CONCIERGE_ENABLED=1 y el control
manualQaEnabled del negocio 928/instancia austral-qa-tenant-928:

- Antes de agendar confirma el nombre. Si hay ficha, ofrece «soy yo» o un
  nombre para esa reserva. El nombre de la reserva puede diferir de la ficha;
  no cambia el nombre de un contacto existente ni duplica su registro.
- Servicios con precio/duración, horarios consultados por la RPC y barberos
  disponibles se muestran como opciones numeradas. También admite texto.
- «Cualquiera» usa los candidatos reales y vuelve a validar antes de agendar.
- Resume nombre, servicio, importe, duración, fecha, hora y profesional.
  La confirmación explícita es obligatoria. Si cambió precio/duración, reabre
  la propuesta con el resumen actualizado y exige una confirmación nueva.
- La respuesta de éxito se construye desde el turno guardado, no desde el
  modelo. «Mi turno» consulta próximos turnos confirmados del propio cliente
  y negocio; «Como me llamo?» consulta la ficha del teléfono verificado.
- Las consultas informativas no crean reservas ni convierten la pregunta en
  el nombre del cliente. Conservan un pedido de reserva que esté en curso.

Interpretación adicional: el workflow nuevo australQa928Language recibe en
la ruta autenticada /webhook/austral-qa-language-928 sólo mensajes que necesitan
interpretación. Usa la clave DeepSeek ya existente en el servidor y
deepseek-flash, salida JSON y pensamiento desactivado. No copia la clave a
Supabase ni al frontend. Referencias oficiales:
https://api-docs.deepseek.com/guides/json_mode/
https://api-docs.deepseek.com/guides/thinking_mode/

El servidor verifica tenant, catálogo, fechas, horas y confianza; ignora nombre,
teléfono, respuesta libre y confirmación propuestos por el modelo. El modelo
no envía mensajes ni escribe reservas. El contexto excluye nombre/ID/teléfono
del cliente; se enmascaran en el texto teléfonos, emails, enlaces, credenciales
y el nombre completo conocido. Esto no constituye una detección universal de
datos personales que alguien escriba espontáneamente. Los nombres públicos de
servicios/profesionales se envían como catálogo. Timeout del proveedor: 8 s;
del cliente: 9 s. Error o timeout conserva la respuesta determinista.

El template del repo queda inactivo para evitar activaciones accidentales.
El workflow runtime se publica sólo en el proyecto QA del workflow padre,
con autenticación por cabecera existente y sin guardar payloads de ejecuciones
exitosas, fallidas o manuales. No modifica workflows ni credenciales ajenas.

Controles: lint, npm test (incluye verify-whatsapp-concierge.mjs), 58 archivos/
719 tests unitarios y build PASS. El contrato nuevo recorre nombre, opciones,
precio, hora, profesional, reserva, replay, ficha única, nombre distinto para
reserva, consulta propia, cambios de precio, error de modelo y campos maliciosos.
Se comprobó por lectura de la función SQL QA que la RPC conserva el nombre del
contacto existente. La prueba real del intérprete n8n respondió HTTP 200 en
1453 ms, 595 tokens, para un pedido sintético con catálogo QA. Ese tiempo mide
sólo interpretación, no latencia de un WhatsApp real. No se enviaron mensajes
físicos, se creó un turno ni se desconectó Evolution para probar esta entrega.

Reversión: establecer WHATSAPP_QA_MANUAL_CONCIERGE_ENABLED=0 en QA recupera el
modo anterior sin desconectar el número ni borrar historial. Después se puede
despublicar únicamente australQa928Language. El respaldo de las tres funciones
previas está en whatsapp-before-concierge/ y coincide con 0332df5. No revertir
la publicación Realtime ni el frontend: pertenecen a la entrega anterior.

Publicación: código 267627e; webhook 98, booking-mutation 49 y outbound 71
ACTIVE, manteniendo verify_jwt false/false/true. Las fuentes descargadas tras
el despliegue coinciden con ese commit. Flag de QA habilitado y conexión 6
CONNECTED con bot, outbound y booking activos. El turno 47 del dueño sigue
confirmado. n8n muestra Published; versión activa de australQa928Language:
464a02eb-1398-4460-b07a-35b97a908b90. Workflows padre/panel conservan sus
versiones, autenticación y privacidad; Evolution permanece open.

Validación física pendiente: empezar con «Hola», pedir otro turno, confirmar
nombre, elegir opciones o escribir una frase libre, revisar resumen y confirmar.
Luego preguntar «Cómo me llamo» y «Mi turno». Verificar una sola ficha y turno,
mensaje único y actualización de Agenda/Mensajes sin reload. No se afirma aún
una latencia completa ni funcionamiento de audio o modificaciones/cancelaciones
automáticas: pedir cambios/cancelación deriva a ayuda del negocio.
