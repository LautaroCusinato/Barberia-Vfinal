# Especificación del tenant demo

Esta ficha describe un negocio ficticio para mostrar el producto sin datos reales. No es una instrucción para insertar filas en Supabase ni para crear un tenant externo. La demo vigente usa un adapter local con snapshot por navegador; cualquier carga futura debe seguir ese mecanismo.

## Identidad

- **Nombre comercial:** Austral Barber Demo.
- **Descripción:** barbería de barrio con tres profesionales, agenda de lunes a sábado y reservas online.
- **Zona horaria:** `America/Argentina/Buenos_Aires`.
- **Moneda:** ARS.
- **Dirección demo:** Av. Austral 1234, CABA (ubicación ficticia).
- **Contacto demo:** `demo@austral.invalid` (no es un canal operativo).
- **Slug sugerido si la demo necesita uno:** `austral-barber-demo`.

## Horario general

Lunes a sábado, 09:00–20:00, con pausa general de 13:00–14:00. La agenda calcula disponibilidad con los horarios del profesional, duración del servicio, breaks, bloqueos y turnos existentes. Los domingos quedan cerrados.

## Equipo ficticio

| Profesional | Horario | Break | Servicios habilitados |
|---|---|---|---|
| Mateo | Lun–Sáb 09:00–18:00 | 13:00–14:00 | Corte clásico, Corte + barba, Barba, Perfilado, Corte infantil |
| Lucas | Mar–Sáb 10:00–19:00 | 14:00–15:00 | Corte clásico, Degradé, Corte + barba, Perfilado |
| Tomás | Lun–Vie 12:00–20:00 | 16:00–16:30 | Degradé, Corte + barba, Barba, Perfilado |

Los nombres, colores y roles son datos de demostración. No representan personas contratadas.

## Catálogo de servicios

| Servicio | Precio QA/demo | Duración | Profesionales |
|---|---:|---:|---|
| Corte clásico | ARS 8.500 | 35 min | Mateo, Lucas |
| Degradé | ARS 10.500 | 45 min | Lucas, Tomás |
| Corte + barba | ARS 14.500 | 60 min | Mateo, Lucas, Tomás |
| Barba | ARS 7.000 | 30 min | Mateo, Tomás |
| Perfilado | ARS 5.500 | 20 min | Mateo, Lucas, Tomás |
| Corte infantil | ARS 7.500 | 30 min | Mateo |

Los precios son valores explícitos del fixture demo y no son precios de los planes SaaS. No confundirlos con Starter/Pro/Premium.

## Clientes y turnos ficticios

Usar nombres demostrativos y datos sintéticos; por ejemplo `Cliente Demo 01` a `Cliente Demo 12`, email `cliente-demo-01@e2e-qa.invalid` y teléfonos sintéticos. Mantener algunos con próxima visita y otros con historial para que Clientes y Agenda no aparezcan vacíos.

Seed sugerida (fechas relativas al día de la demo):

- próximos: Corte clásico lunes 09:00 con Mateo; Degradé martes 10:30 con Lucas; Barba miércoles 15:00 con Tomás; Corte + barba jueves 14:30 con Mateo;
- más próximos: Corte infantil viernes 09:30 con Mateo; Perfilado sábado 11:00 con Lucas;
- históricos: Corte clásico y Degradé en estado atendido; uno en estado no asistió para mostrar estados sin dramatizar.

Los turnos deben respetar la relación profesional–servicio y las horas de trabajo. No fijar una fecha absoluta que pueda quedar obsoleta; la implementación local existente ya calcula fechas relativas.

## Lo que se puede mostrar

Dashboard con actividad; Agenda con próximos/históricos; Clientes con datos sintéticos; Servicios y Equipo con relaciones; Configuración con branding/zona horaria; reserva pública con catálogo y disponibilidad; Billing con trial/catálogo informativo; WhatsApp sólo como estado y alcance aprobado. No agregar funciones ni prometer automatización o cobro.
