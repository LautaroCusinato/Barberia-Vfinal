# Guion de video demo Austral — 60 a 90 segundos

**Estado:** `VIDEO_60S_READY`

Video para grabar manualmente la pantalla de Austral con datos ficticios. Mostrar únicamente el flujo comercial verificado y detener la grabación antes de cualquier acción sensible. Demo autorizada: <https://barberia-qa.cuchitron.lat/>.

## VIDEO_TIMELINE

| Tiempo | Pantalla exacta | Navegación / click | Qué debe verse | Voz sugerida |
|---|---|---|---|---|
| 00–10 s | Reserva pública | Abrir la URL de demo y entrar al flujo de reserva. | Selector de servicio, barbero, fecha y horario disponibles. | “Con Austral, el cliente puede elegir el servicio, el barbero y el horario desde una reserva pública.” |
| 10–25 s | Agenda | Volver al workspace de demo y abrir **Agenda**. | La agenda con un turno ficticio, mostrando fecha, hora, servicio, profesional y estado. | “Ese turno queda ordenado en la agenda para que el equipo tenga una misma vista de trabajo.” |
| 25–40 s | Clientes | Abrir **Clientes** y seleccionar un registro ficticio. | Nombre de ejemplo y datos mínimos del cliente; no mostrar datos reales. | “También podés tener los clientes ordenados y encontrar el contexto de cada turno sin buscar en conversaciones sueltas.” |
| 40–52 s | Servicios | Abrir **Servicios** y mostrar un servicio de ejemplo. | Nombre, precio y duración configurados. | “Cada servicio tiene su precio y duración, para que la disponibilidad y lo que se ofrece estén claros.” |
| 52–64 s | Equipo / barberos | Abrir **Equipo** y mostrar los profesionales de ejemplo. | Barberos, servicios que realizan y horarios ficticios. | “El equipo queda relacionado con los servicios y horarios que realmente trabaja cada barbero.” |
| 64–80 s | Trial / comercial | Abrir **Facturación** o la vista comercial informativa, sin checkout. | Austral, ARS 50.000 por mes y 15 días gratis. | “Austral tiene un único plan de ARS 50.000 por mes y 15 días gratis para probarlo con la operación real.” |
| 80–90 s | Cierre | Volver a una pantalla limpia de la demo; no hacer más clicks. | Vista general o landing, sin datos sensibles. | “La idea es tener reservas, agenda, clientes, servicios y equipo en un solo lugar. Si querés verlo con tu barbería, lo recorremos juntos.” |

## EXACT_VOICE_SCRIPT

“Con Austral, el cliente puede elegir el servicio, el barbero y el horario desde una reserva pública.

Ese turno queda ordenado en la agenda para que el equipo tenga una misma vista de trabajo.

También podés tener los clientes ordenados y encontrar el contexto de cada turno sin buscar en conversaciones sueltas.

Cada servicio tiene su precio y duración, para que la disponibilidad y lo que se ofrece estén claros.

El equipo queda relacionado con los servicios y horarios que realmente trabaja cada barbero.

Austral tiene un único plan de ARS 50.000 por mes y 15 días gratis para probarlo con la operación real.

La idea es tener reservas, agenda, clientes, servicios y equipo en un solo lugar. Si querés verlo con tu barbería, lo recorremos juntos.”

Duración objetivo: 75–90 segundos, hablando con pausas breves y sin agregar una explicación técnica.

## SCREEN_ACTIONS

1. Preparar el navegador en <https://barberia-qa.cuchitron.lat/> con el fixture ficticio listo.
2. En **Reserva pública**, seleccionar un servicio, un barbero, una fecha y un horario disponibles. No completar datos reales ni confirmar una reserva real.
3. Volver al workspace y abrir **Agenda**. Mostrar un turno de ejemplo ya preparado; no crear actividad para simular uso.
4. Abrir **Clientes** y seleccionar un cliente ficticio. Mantener visibles sólo datos sintéticos.
5. Abrir **Servicios** y mostrar precio y duración de un servicio de ejemplo.
6. Abrir **Equipo** y mostrar barberos, servicios y horarios ficticios.
7. Abrir **Facturación** o la vista comercial informativa. Mostrar precio y trial sin abrir checkout ni iniciar el trial.
8. Volver a una pantalla limpia y finalizar la grabación.

Si una pantalla no carga, no improvisar ni afirmar que funciona: cortar esa toma y registrar el problema para revisión.

## WHAT_NOT_TO_SHOW

- Supabase, Cloudflare, QA/internal tooling, logs, consola, URLs internas o datos técnicos.
- Configuración sensible, credenciales, tokens, QR, números privados o datos reales de clientes.
- Mercado Pago, PayPal, checkout, billing automático, tarjetas, cobros o links de pago.
- Evolution, n8n, webhooks, APIs, tenant, RLS u otra infraestructura.
- WhatsApp automático como disponible actualmente.
- Pantallas de error, datos de otra barbería o una reserva real creada durante la grabación.

Si se menciona WhatsApp, usar solamente: “También estamos trabajando la integración con WhatsApp.” No describir respuestas automáticas ni disponibilidad general.

## WHATSAPP_SEND_COPY

Plantilla para revisión humana; no enviar automáticamente.

> Hola, ¿cómo va? Te comparto un video corto de Austral, un sistema pensado para barberías para ordenar reservas, agenda, clientes, servicios y equipo en un solo lugar. También podés recorrer la demo acá: https://barberia-qa.cuchitron.lat/ . Si te interesa, lo vemos juntos en 5 minutos.

## EMAIL_SEND_COPY

Plantilla para revisión humana; no enviar automáticamente.

**Asunto:** Video corto de Austral para [BARBERÍA]

Hola, ¿cómo va? Soy Lautaro.

Te comparto un video corto de Austral, un sistema pensado para barberías para tener reservas, agenda, clientes, servicios y equipo en un solo lugar.

También podés recorrer la demo acá:
https://barberia-qa.cuchitron.lat/

Austral tiene un único plan de ARS 50.000 por mes y 15 días gratis para probarlo.

Si te interesa, respondeme por acá y lo vemos juntos.

Saludos,
Lautaro
Austral

No enviar este texto, el video ni el enlace sin revisión humana del negocio, destinatario, DNC, duplicados y estado real de la demo.
