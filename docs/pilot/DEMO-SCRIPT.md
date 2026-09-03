# Guion de demo comercial de 5 minutos

**Estado:** `DEMO_5_MIN_READY`

La demo está pensada para un dueño o responsable que ya respondió al outreach. Dura como máximo cinco minutos, usa datos ficticios y muestra el flujo de valor de Austral sin abrir checkout, crear una cuenta real ni confirmar una reserva real. La demo pública autorizada es <https://barberia-qa.cuchitron.lat/> cuando el entorno esté disponible y aprobado.

## Flujo recomendado

| Tiempo | Pantalla que abrir | Qué mostrar | Beneficio a explicar | Frase sugerida |
|---|---|---|---|---|
| 00:00–00:35 | Landing / propuesta | La propuesta de Austral y el recorrido de reservas, agenda, clientes, servicios y equipo. | Tener la operación principal en un mismo lugar y reducir el ida y vuelta manual. | “La idea es que la barbería tenga un flujo más claro para recibir y ordenar turnos.” |
| 00:35–01:20 | Reserva pública | Elegir servicio, barbero, fecha y horario disponibles en la demo. No completar datos reales ni confirmar un turno real. | El cliente puede ver opciones reales de disponibilidad y dejar sus datos en el flujo acordado. | “Acá la persona elige qué quiere, con quién y cuándo, sin tener que coordinar todo por mensaje.” |
| 01:20–02:00 | Agenda | Mostrar un turno ficticio en el día elegido, con servicio, profesional y estado. | El equipo comparte una vista de trabajo y puede detectar qué está reservado. | “Lo que entra por la reserva queda visible en la agenda del equipo.” |
| 02:00–02:35 | Clientes | Abrir un cliente ficticio y mostrar sus datos mínimos e historial de prueba. | La información útil queda ordenada para no depender de conversaciones sueltas. | “Así pueden encontrar al cliente y el contexto del turno desde el mismo lugar.” |
| 02:35–03:05 | Servicios | Mostrar nombre, precio y duración de un servicio ficticio. | La disponibilidad y la expectativa del cliente parten de un catálogo claro. | “Cada servicio tiene su precio y duración, y eso ordena lo que se ofrece.” |
| 03:05–03:35 | Barberos / equipo | Mostrar profesionales, servicios que realizan y horarios ficticios. | La agenda respeta quién trabaja, qué hace y cuándo está disponible. | “El equipo y sus horarios quedan relacionados con los servicios que realmente hacen.” |
| 03:35–04:20 | Configuración | Mostrar horarios, breaks, días cerrados, bloqueos y branding de ejemplo. | El negocio define sus reglas antes de publicar disponibilidad. | “Antes de abrir reservas, dejamos cargadas las reglas reales de la barbería.” |
| 04:20–05:00 | Facturación / trial | Mostrar únicamente el catálogo informativo: Austral, ARS 50.000 por mes y 15 días gratis. No abrir checkout ni pedir tarjeta. | Pueden probar con su operación y decidir la continuidad manualmente. | “La prueba dura 15 días; después vemos juntos si aporta valor. Si tienen más de una sucursal, lo vemos según el caso.” |

## Cierre y WhatsApp

Cerrar con una sola pregunta: “¿Qué parte de este flujo te serviría probar primero en tu barbería?”.

Si preguntan por WhatsApp, decir únicamente:

> “También estamos preparando la integración de WhatsApp para automatizar parte de la gestión de turnos. Todavía no la presento como una función live ni como disponibilidad general.”

WhatsApp no es requisito para validar el primer MVP comercial: primero se valida reserva web, agenda, clientes, servicios y equipo.

## Guardas de la demo

- No usar datos reales de otra barbería, credenciales, QR, pagos ni links de pago.
- No crear un tenant, trial o reserva real durante la demo.
- No afirmar que WhatsApp responde automáticamente ni que los pagos están automatizados.
- No mencionar Supabase, Evolution, n8n, tenant, RLS, API ni otros detalles técnicos al prospecto.
- Si una pantalla falla, describir el estado real y continuar sólo con una lectura segura; nunca convertir un error en una promesa.
- Registrar las preguntas y el próximo paso en el CRM después de la revisión humana, sin responder automáticamente.

## Checklist previa

- [ ] Entorno de demo y URL autorizada verificados.
- [ ] Fixture ficticio con agenda, cliente, servicios, equipo y configuración coherentes.
- [ ] Landing, reserva pública, agenda, clientes, servicios, equipo, configuración y facturación accesibles.
- [ ] Demo ensayada en menos de cinco minutos.
- [ ] Precio, trial y alcance de WhatsApp preparados con la respuesta vigente.
