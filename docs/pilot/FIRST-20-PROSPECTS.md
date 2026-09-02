# Diseño de los primeros 20 prospectos

Este documento define un proceso, no una lista de negocios reales. Los primeros registros deben crearse sólo después de una aprobación comercial y con información pública o entregada voluntariamente.

## Fuente y criterios

Elegir negocios de servicios que tengan una operación visible de reservas o atención por turnos y que puedan probar el producto con una persona responsable. Priorizar variedad de tamaño y rubro, no contactos masivos. Registrar fuente, fecha, país, idioma, rubro, web/redes, problema observado, canal preferido, base legal/consentimiento y responsable.

No hacer scraping, comprar bases, inferir teléfonos privados ni cargar prospectos sin una base legal. El PlatformCRM existente es la única superficie de seguimiento; no crear otro CRM.

## Pipeline

`LEAD → CONTACTED → REPLIED → DEMO → TRIAL → ACTIVE` y `LOST` cuando la persona no continúa o pide no contacto. Cada transición debe tener fecha, responsable, nota breve y próxima acción; DNC bloquea nuevos contactos.

| Etapa | Entrada | Salida |
|---|---|---|
| LEAD | Negocio identificado y fuente registrada. | Datos mínimos revisados y contacto permitido. |
| CONTACTED | Se envió un único primer contacto manual. | Respuesta, rebote o fecha de seguimiento. |
| REPLIED | Respondió o pidió información. | Necesidad entendida y demo acordada/no acordada. |
| DEMO | Demo realizada o cancelada. | Próximo paso explícito. |
| TRIAL | Cuenta creada con consentimiento y onboarding completo. | Uso y feedback del trial. |
| ACTIVE | Decidió continuar por el canal manual acordado. | Registro de continuidad y soporte. |
| LOST | No encaja, no responde tras cadencia o pide no contacto. | Cierre respetuoso; no nuevos envíos. |

## Cadencia sugerida

- Día 0: primer contacto manual.
- Día 3–5: un seguimiento sólo si no pidió no contacto.
- Día 10–14: cierre respetuoso y sin insistencia.
- Durante trial: revisión acordada en día 1, 3, 7, 12 y 15.

No mandar mensajes automáticos. Si responde, detener la cadencia y conversar. No medir el éxito por la cantidad de contactos enviados.

## Ficha mínima

`nombre_negocio`, `nombre_contacto` si lo entregó, canal, fuente, rubro, país/idioma, web/redes públicas, necesidad observada, base legal, DNC, responsable, etapa, fecha de último contacto, próxima acción, resultado de demo/trial y notas de soporte. Evitar contenido de conversaciones que no sea necesario para la operación.

## Revisión de los 20

Armar cohortes pequeñas (por ejemplo 5 + 5 + 5 + 5), revisar calidad de datos y consentimiento al cierre de cada cohorte y parar si aparece un patrón de spam, confusión de plan o problema de producto. Recién con evidencia del piloto definir segmentación, entitlements de planes y cadencia definitiva.
