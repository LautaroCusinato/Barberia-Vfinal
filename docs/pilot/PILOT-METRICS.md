# Métricas del piloto

Medir para aprender, no para maquillar resultados. Separar datos de producto, feedback comercial y operaciones de soporte. No inventar eventos ni presentar estimaciones como datos reales.

## Producto

- Altas iniciadas y onboarding completado.
- Tiempo desde alta hasta primer servicio/profesional/horario configurado.
- Uso de agenda y clientes durante el trial.
- Reservas públicas iniciadas, confirmadas, canceladas o con error técnico.
- Tickets/incidentes por severidad y tiempo hasta primera respuesta.
- Errores observados de login, permisos, disponibilidad o rutas.
- Estado real del trial según servidor (`trialing`, `expired` u otro estado válido).

## Comercial

- Prospectos por etapa del pipeline.
- Tasa de respuesta, demos realizadas, trials iniciados y continuidad solicitada.
- Tiempo entre etapas.
- Objeciones y motivos de `LOST`.
- Intención de continuar y oferta consultada, sin asumir compra.

## Manual vs automático

El producto ya ofrece datos operativos en sus superficies y el PlatformCRM mantiene etapas/actividades; no existe un colector externo de analítica de producto. Por eso:

- **Automático si ya está disponible:** estado de trial, registros del CRM, reservas/turnos del workspace y errores técnicos visibles en logs autorizados.
- **Manual:** satisfacción del dueño, minutos ahorrados, claridad del onboarding, motivo de baja, calidad de la demo y decisión de continuidad.

Registrar la fuente de cada número y el período. No unir tenants ni prospectos sin una clave definida.

## Clasificación

- Para el primer cliente, usar además los mínimos verificables de [FIRST-PILOT-SUCCESS-CRITERIA.md](./FIRST-PILOT-SUCCESS-CRITERIA.md): negocio configurado, reserva pública, primer turno real, agenda visible, cliente registrado, trial activo y cero errores críticos.

- **PILOT SUCCESS:** onboarding completado, operación básica usada, sin P0/P1 abiertos, feedback positivo verificable y al menos una decisión informada de continuidad; el número exacto de cuentas se define al aprobar la cohorte.
- **PILOT PARTIAL:** producto usable con bloqueos P2 o feedback mixto; hay aprendizajes claros y una lista priorizada antes de ampliar.
- **PILOT FAILED:** P0/P1, pérdida de aislamiento/datos, errores que impiden la operación básica o señales de contacto no consentido. Frenar la cohorte y seguir soporte/rollback.

No convertir una métrica de actividad en garantía comercial. Los criterios deben revisarse con la persona responsable antes de etiquetar el resultado.
