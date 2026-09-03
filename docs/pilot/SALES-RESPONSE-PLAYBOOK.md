# Sales response playbook

**Estado:** `HOT_LEAD_RESPONSES_READY`

La revisión humana de Lautaro es obligatoria. Ante cualquier respuesta, detener follow-ups, clasificar el mensaje, preparar una única respuesta propuesta y esperar aprobación. Nunca responder, crear cuenta, tenant, trial, reunión o acceso automáticamente.

## Fase actual

Axel, BMA Barber, Marcelli, Pikaros, Pelizzari y Firulete ya fueron contactados por sus canales aprobados. No iniciar nuevos contactos ni follow-ups en esta tarea. El siguiente paso válido es revisar una respuesta y, si corresponde, hacer una demo de cinco minutos.

## Respuestas para leads interesados

Estas plantillas son para aprobación humana. Adaptar sólo una frase al texto recibido.

### “Me interesa”

“Dale, gracias por responder. Si querés, te muestro el flujo completo en una demo de 5 minutos y vemos si encaja con cómo trabajan hoy.”

Clasificar como `POSITIVE`. Si acepta la demo, actualizar a `INTERESTED_FOR_DEMO`.

### “Quiero verlo”

“Dale. Podés recorrer la demo acá: https://barberia-qa.cuchitron.lat/. Si después querés, te acompaño en un recorrido de 5 minutos con el flujo de reservas y agenda.”

Clasificar como `INTERESTED_FOR_DEMO`. No enviar credenciales ni prometer integraciones activas sin verificar.

### “Quiero probarlo”

“Genial. Antes de abrir el piloto, necesito confirmar nombre de la barbería, responsable, email, WhatsApp, servicios, precios, duraciones, barberos y horarios. Con eso revisamos juntos el onboarding y te confirmo el próximo paso.”

Clasificar como `HOT_PILOT_LEAD`. No crear cuenta, tenant ni trial automáticamente.

### “¿Cuánto sale?”

“Sale ARS 50.000 por mes. Antes tenés 15 días gratis para probarlo y ver si realmente te sirve. Si tienen más de una sucursal, lo vemos según el caso.”

### “¿Cómo funciona?”

“Austral reúne reservas web, agenda, clientes, servicios y equipo en un mismo lugar. La persona puede elegir servicio, barbero y horario; el negocio ve el turno en la agenda y administra su operación desde ahí.”

### “¿Funciona con WhatsApp?”

“También estamos preparando la integración de WhatsApp para automatizar parte de la gestión de turnos. Está en validación con pilotos y no la presento como una función live ni como disponibilidad general todavía.”

### “Ya uso otro sistema”

“Perfecto. No buscamos reemplazar algo que ya funciona sin entenderlo. Podemos mirar el flujo que hoy les cuesta más y ver si Austral aporta algo, sin cambiar nada de entrada.”

## Otras respuestas frecuentes

### “Sí, contame”

“Dale. Austral busca ordenar reservas, agenda, clientes, servicios y equipo de una barbería. Si querés, te muestro el flujo en una demo breve y después vemos si tiene sentido para ustedes.”

### “Mandame info”

“Dale. Te paso la demo pública para que la recorras: https://barberia-qa.cuchitron.lat/. Si te sirve, después vemos juntos el flujo que más usan.”

### “Tenemos varias sucursales”

“Si tienen más de una sucursal, lo vemos según el caso. Primero entendemos cómo trabajan y qué necesitan probar.”

### “Ahora no”

“Entiendo, gracias por responder. Pauso el seguimiento y no te escribo de nuevo por esto.”

### “No me interesa”

“Entendido, gracias por avisar. Lo marco como no contactar por esta propuesta.”

### “¿De dónde sacaste mi contacto?”

“Lo vi publicado como contacto comercial de [NEGOCIO]. Si no corresponde o preferís que no vuelva a escribir, lo marco ahora y cierro el contacto.”

## Clasificación y escalamiento

Clasificar toda respuesta como una de estas opciones:

`POSITIVE` · `QUESTION` · `PRICE` · `DEMO` · `TRIAL` · `CALL` · `NOT_NOW` · `NOT_INTERESTED` · `DNC` · `OTHER`

Además, usar `INTERESTED_FOR_DEMO` cuando la persona acepta ver la demo y `HOT_PILOT_LEAD` cuando quiere probar. Negociación, descuentos, reuniones, trial, dudas técnicas, quejas, identidad o DNC requieren propuesta explícita para Lautaro antes de contestar.

## Reglas de alcance

- Compartir sólo la demo autorizada: `https://barberia-qa.cuchitron.lat/`.
- WhatsApp se describe como integración en validación; no prometer automatización live.
- El único plan es Austral ARS 50.000/mes con 15 días gratis; multi-sucursal se evalúa según el caso.
- No enviar credenciales, QR, links de pago, pagos, Mercado Pago ni trial iniciado automáticamente.
- Registrar respuesta, clasificación, propuesta y próxima acción en el CRM; no usar Gmail o WhatsApp como source of truth.
