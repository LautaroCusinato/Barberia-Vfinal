# Sales response playbook

Human review remains mandatory. When any prospect replies, stop all scheduled follow-ups, classify the response, prepare a short suggested reply and wait for Lautaro when the context involves interest, negotiation, trial, a meeting, technical scope, complaint or special condition.

## “Sí, contame”

“Dale. Austral ordena agenda, reservas, servicios, profesionales y clientes en un solo lugar. Si querés, te paso una demo breve y después vemos si encaja.”

## “¿Cuánto sale?”

“Starter cuesta ARS 30.000 por mes e incluye 15 días de prueba. También existen Pro ARS 60.000 y Premium ARS 100.000; las diferencias definitivas de prestaciones todavía se están validando.”

## “¿Qué hace?”

“Ayuda a organizar agenda, reservas, servicios, profesionales y clientes. La idea es reducir coordinación manual y tener una operación más clara.”

## “Ya tenemos sistema”

“Perfecto. No buscamos reemplazar algo que ya funciona sin entenderlo. Podemos mirar sólo el flujo que hoy les cuesta más y ver si Austral aporta algo.”

## “Usamos WhatsApp”

“Está bien. WhatsApp puede seguir siendo el canal de atención. La integración automática está en validación con pilotos y no prometemos disponibilidad general todavía.”

## “Mandame info”

“Dale. Te paso una explicación corta y, si te sirve, una demo. Austral ordena agenda, reservas, servicios, profesionales y clientes.”

## “Ahora no”

“Entiendo, gracias por responder. Pauso el seguimiento y no te escribo de nuevo por esto.”

## “Escribime más adelante”

“Dale, ¿qué momento te resulta razonable? Lo dejo anotado y no escribo antes de esa fecha.”

## “No me interesa”

“Entendido, gracias por avisar. Lo marco como no contactar por esta propuesta.”

## “¿Quién sos?”

“Soy Lautaro, estoy construyendo Austral, un software para ordenar la operación de barberías. Te escribí desde la información comercial pública de [NEGOCIO].”

## “¿De dónde sacaste mi número?”

“Lo vi publicado como contacto comercial de [NEGOCIO]. Si no corresponde o preferís que no vuelva a escribir, lo marco ahora y cierro el contacto.”

## “¿Tenés demo?”

“Sí. Cuando la demo esté confirmada como lista, te paso el enlace oficial y te explico sólo lo que está disponible.”

## “¿Tengo que cambiar mi WhatsApp?”

“No necesariamente. La integración con WhatsApp está en validación con pilotos; podemos evaluar primero agenda y reservas online sin prometer automatización general.”

## “¿Funciona con varios barberos?”

“Sí, Austral contempla profesionales, servicios y horarios. En el piloto validamos el flujo con la configuración real del negocio.”

## “¿Puedo probarlo?”

“Sí, podemos evaluar un trial de 15 días. Antes necesitamos confirmar negocio, contacto, servicios, profesionales y el problema que quieren probar.”

## Classification and escalation

Classify every reply as one of:

`POSITIVE` · `QUESTION` · `PRICE` · `DEMO` · `TRIAL` · `CALL` · `NOT_NOW` · `NOT_INTERESTED` · `DNC` · `OTHER`

`POSITIVE`, `DEMO`, `TRIAL`, `CALL`, negotiation, discounts, technical uncertainty and complaints require a Lautaro recommendation before replying. Do not create a tenant, meeting, discount or promise automatically.
