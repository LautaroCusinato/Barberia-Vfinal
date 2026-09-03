# Criterios de éxito del primer piloto

**Estado:** `FIRST_PILOT_SUCCESS_CRITERIA_READY`

El primer piloto se considera exitoso sólo si el negocio puede operar una reserva web real con sus propios datos, sin errores críticos y con una decisión informada sobre la continuidad. WhatsApp automation no es requisito del primer MVP comercial.

## Requisitos mínimos

- [ ] Negocio configurado con responsable identificado y acceso verificado.
- [ ] Servicios, precios, duraciones, barberos, horarios, breaks y días cerrados correctos.
- [ ] Reserva pública accesible para el negocio correcto.
- [ ] Primer turno real creado por el flujo aprobado.
- [ ] La barbería puede ver ese turno en Agenda con servicio, profesional, fecha y estado correctos.
- [ ] El cliente queda registrado correctamente, con consentimiento y sólo datos necesarios.
- [ ] Trial de 15 días activo según el estado server-side.
- [ ] No hay errores críticos P0/P1 abiertos que impidan operar, ni problemas de aislamiento o datos.

## Evidencia a registrar

Registrar en el CRM, sin secretos ni conversaciones innecesarias:

- fecha y negocio;
- responsable que validó el flujo;
- enlace público probado;
- identificador sanitizado del primer turno;
- cliente registrado y consentimiento confirmado;
- estado del trial;
- errores o bloqueos pendientes;
- feedback textual breve y decisión de continuidad.

## Clasificación

- `PILOT_SUCCESS`: todos los requisitos mínimos cumplidos, sin P0/P1 y el responsable confirma que puede operar el flujo.
- `PILOT_PARTIAL`: el flujo principal funciona, pero queda un bloqueo P2/P3 o feedback mixto con plan de resolución.
- `PILOT_FAILED`: falta una reserva pública funcional, el turno no aparece en Agenda, el cliente no se registra, el trial no está activo, hay un P0/P1 o existe riesgo de datos/aislamiento.

## Qué no cuenta como éxito

- Un mensaje enviado, una respuesta positiva o una demo solicitada.
- Un trial creado sin onboarding y consentimiento.
- Un enlace mostrado sin una reserva real validada.
- Una conexión de WhatsApp, una respuesta automática, un pago o una promesa de disponibilidad.

## Gate de continuidad

Al cierre de los 15 días, revisar uso, incidencias, feedback y disposición a continuar. La continuidad se conversa manualmente a ARS 50.000 por mes; si hay más de una sucursal, se evalúa según el caso. No iniciar cobros ni cambiar el alcance automáticamente.
