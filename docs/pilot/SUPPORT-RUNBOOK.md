# Runbook de soporte

Responder primero con diagnóstico y contención. No pedir secretos ni ejecutar cambios irreversibles desde soporte.

## Primer chequeo común

1. Confirmar negocio, usuario, ruta, hora aproximada, dispositivo y navegador.
2. Pedir el mensaje visible y pasos para reproducir; nunca pedir contraseña, token, cookie o captura con datos sensibles.
3. Revisar estado conocido del servicio y logs sanitizados autorizados.
4. Separar error de Auth, permisos/tenant, datos de agenda, frontend, proveedor externo o facturación.
5. Registrar correlación y próximos pasos en el canal interno acordado.

## Casos frecuentes

| Caso | Primer chequeo | No tocar |
|---|---|---|
| No puede ingresar | Email verificado, mensaje de Auth, hora y navegador. | Contraseña o usuarios de otro tenant. |
| No ve agenda/datos | Tenant y rol visibles para la cuenta; filtros/fecha. | RLS, SQL directo o datos de otro negocio. |
| No hay horarios | Servicio activo, profesional, horario, break, bloqueo y fecha. | Inventar slots o insertar turnos para “probar”. |
| Reserva con error | Mensaje, fecha/hora, estado de disponibilidad y si hubo confirmación. | Reintentos ciegos o doble envío. |
| WhatsApp | Estado técnico real y alcance aprobado. | Evolution, webhooks, QR, mensajes o automatizaciones sin ventana aprobada. |
| Billing | Estado del trial, catálogo y mensaje de UI. | Checkout, pagos, tarjetas, tokens o secretos. |
| Carga lenta/error frontend | Ruta, navegador, consola sanitizada y deployment. | Cambios en producción desde soporte. |

## Severidades

- **P0:** cruce de tenants, mutación no autorizada, pago/cargo inesperado, secreto expuesto o envío no aprobado. Contener, congelar la cohorte y escalar de inmediato.
- **P1:** login general caído, reserva inutilizable, webhook/servicio crítico en error sostenido o pérdida de datos. Confirmar por segunda fuente y escalar.
- **P2:** error aislado, disponibilidad vacía, validación o degradación sin pérdida de datos. Registrar y priorizar en horario normal.
- **P3:** copy, visual o mejora menor. Planificar sin bloquear la operación.

## Escalación y cierre

Escalar con timestamp, tenant sanitizado, ruta, severidad, correlation/request id y efecto observable. No adjuntar bodies, teléfonos completos, Authorization ni secretos. Cerrar sólo cuando se reprodujo el comportamiento esperado, se comunicó al dueño y quedó registrada cualquier tarea pendiente.
