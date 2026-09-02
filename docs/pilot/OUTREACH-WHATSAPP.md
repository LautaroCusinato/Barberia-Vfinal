# First-contact WhatsApp

This document prepares copy for manual use only. `HUMAN_REVIEW_REQUIRED` is mandatory: Lautaro reviews the business, recipient identity, DNC, duplicate status and final wording before every message. Never use Evolution `miwsp`, Reply Only, n8n, product bots or an automatic queue.

## Gate before copying a message

- Business is active through a public source.
- Number belongs directly to the business or a verified employee.
- `contact_owner_type` is `BUSINESS_DIRECT` or `EMPLOYEE_BUSINESS`.
- DNC, prior negative contact and duplicate checks are clear.
- One business, one message, one CTA.
- No price, meeting request, registration or payment request in the first message.

If identity is `UNKNOWN`, `AGENCY` or `SOFTWARE_PROVIDER`, stop with `CONTACT_IDENTITY_REVIEW`.

## Variants

### A — Ultracorto

> Hola, ¿cómo va? Soy Lautaro, de Austral. ¿Les interesa que les pase una demo breve para ordenar turnos?

### B — Natural

> Buenas, ¿cómo están? Estoy preparando Austral para ayudar a barberías a ordenar agenda y reservas. Vi su negocio y pensé que podía servirles. ¿Les interesa que les pase una demo?

### C — Personalizado

> Hola, [NOMBRE]. Vi que [DATO PÚBLICO: toman turnos por WhatsApp / trabajan varios barberos / tienen reservas online]. Austral ayuda a ordenar ese flujo. ¿Les interesa que les pase una demo?

### D — Ahorro de tiempo

> Hola, ¿cómo va? Austral busca reducir el ida y vuelta de mensajes sobre horarios y servicios. ¿Les interesa que les pase una demo?

### E — Reservas

> Buenas. Estamos probando una forma de que los clientes encuentren servicio, profesional y horario con más claridad. ¿Les interesa que les pase una demo?

### F — WhatsApp

> Hola. Vi que reciben consultas por WhatsApp. Austral ordena la agenda detrás de ese canal; la integración automática todavía está en validación con pilotos. ¿Les interesa que les pase una demo?

### G — Hablar con el dueño

> Hola, ¿está el dueño o la persona que coordina los turnos? Estoy preparando una demo breve de Austral para barberías. ¿Me indicás con quién verlo?

This is the only variant whose CTA is a routing question. Do not use it to pressure an employee.

### H — Responde un empleado

> Gracias. ¿La persona que coordina la agenda suele ver estos temas? Si te parece, le podés pasar mi contacto y quedo disponible para mostrarle Austral.

The employee is not treated as the owner unless their role is confirmed. Do not request private details.

## If they show interest

> Dale, te puedo pasar la demo y responderte cualquier duda puntual. ¿Querés que te la comparta?

Only include the demo link after the technical owner confirms `DEMO COMMERCIAL READY`.

## If they ask price

> Sale ARS 50.000 por mes. Antes tenés 15 días gratis para probarlo y ver si realmente te sirve. Si tienen más de una sucursal, lo vemos según el caso.

## If they mention multiple branches

> Si tienen más de una sucursal, lo vemos según el caso. Primero entendemos cómo trabajan y qué necesitan probar.

## Stop rules

Any reply stops the follow-up sequence. “No gracias”, “ahora no”, a complaint, an identity concern or `DNC` closes the contact respectfully and prevents new messages.
