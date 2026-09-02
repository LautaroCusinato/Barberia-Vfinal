# Plan de prueba de 15 días

El trial empieza cuando el onboarding server-side lo crea. La fecha del servidor es la autoridad; este calendario sirve para acompañar, no para conceder acceso manualmente.

| Momento | Verificar | Preguntar al dueño | Métricas/registro | Si aparece un problema |
|---|---|---|---|---|
| Día 0 | Acceso, datos básicos, servicio, profesional, horario y enlace público. | ¿Cuál es el primer flujo que querés ordenar? | Alta completa sí/no; bloqueos abiertos. | Pausar la publicación y resolver configuración; no inventar disponibilidad. |
| Día 1 | Login, agenda del día, cliente de prueba acordado y reserva pública de lectura/flujo controlado. | ¿Encontraste rápido lo que necesitabas? | Primer acceso, tiempo hasta primera acción, dudas. | Soporte guiado; registrar ruta y mensaje sanitizado. |
| Día 3 | Servicios/precios, horarios, bloqueos, uso de agenda y clientes. | ¿Qué tarea repetís todavía fuera de Austral? | Acciones principales usadas; errores reportados. | Revisar configuración y permisos antes de tocar datos. |
| Día 7 | Operación de una semana, reservas recibidas, cambios y cancelaciones según flujo disponible. | ¿Qué parte te ahorró tiempo? ¿Qué falta? | Reservas gestionadas, clientes consultados, feedback cualitativo. | Clasificar P0–P3; no habilitar una integración para ocultar el problema. |
| Día 12 | Salud del trial, datos completos y preparación de continuidad. | Si siguiera funcionando, ¿qué justificaría continuar? | Intención de continuar; objeciones; soporte pendiente. | Aclarar alcance y precios conocidos; no prometer funcionalidades no definidas. |
| Día 14 | Fecha de vencimiento, estado de cuenta y recorrido completo con el dueño. | ¿Querés seguir conversando la continuidad? | Trial activo/vencido según servidor; decisión preliminar. | No cambiar estado a mano; derivar continuidad manual. |
| Día 15 | Estado final y conservación de datos. | ¿Continuás, necesitás más información o cerramos? | PILOT SUCCESS/PARTIAL/FAILED; motivo y próxima acción. | Preservar datos, documentar cierre y seguir rollback/soporte. |

## Reglas durante todo el trial

- No automatizar seguimientos: acordar una próxima fecha y hacerlos manualmente.
- No mezclar cuentas, catálogos, clientes ni enlaces de distintos negocios.
- No usar la fecha local del operador para alterar el trial.
- No ejecutar cobros, checkout o cambios de plan sin una aprobación separada.
- Mantener WhatsApp en el modo efectivamente aprobado. Una conexión no equivale a automatización habilitada.
- Registrar feedback textual mínimo, sin guardar secretos ni conversaciones completas innecesarias.

## Cierre

Clasificar el resultado con los criterios de [PILOT-METRICS.md](./PILOT-METRICS.md). Para un cierre manual, explicar cómo continuar, qué queda pendiente y cómo pedir ayuda; no borrar históricos para “limpiar” un resultado.
