# Kit de primer piloto Austral

Este kit organiza una primera prueba comercial controlada sobre el release candidate aprobado. Es documentación operativa: no activa cuentas, no envía mensajes y no cambia la aplicación.

## Objetivo

Validar con pocos negocios si Austral ayuda a ordenar reservas, clientes, servicios, equipo y horarios durante una prueba gratuita de 15 días. Cada paso debe ser reversible, trazable y aprobado por una persona responsable.

## Alcance

Incluye onboarding asistido, configuración inicial, uso diario de agenda y reservas, acompañamiento, seguimiento comercial y medición manual de resultados. La continuidad se coordina manualmente por WhatsApp. La verdad comercial vigente es un único plan Austral a ARS 50.000/mes, con 15 días gratis para probarlo.

No se inventan prestaciones adicionales: el alcance se valida durante el piloto. Si una barbería tiene más de una sucursal, se responde “Si tienen más de una sucursal, lo vemos según el caso”; no hay precio por sucursal, descuento ni precio enterprise definido. Las automatizaciones de WhatsApp, billing automático, Mercado Pago productivo y cualquier cobro real siguen fuera del piloto hasta contar con aprobación y controles separados.

El contacto comercial por WhatsApp del sitio debe resolver su destino desde `VITE_SALES_WHATSAPP_NUMBER`. No hardcodear números personales en archivos públicos.

## Cómo usar este kit

1. Preparar el negocio con [CLIENT-ONBOARDING.md](./CLIENT-ONBOARDING.md).
2. Ejecutar la demo de [DEMO-SCRIPT.md](./DEMO-SCRIPT.md).
3. Usar el escenario ficticio de [DEMO-TENANT.md](./DEMO-TENANT.md) y el relato de [DEMO-STORY.md](./DEMO-STORY.md).
4. Acompañar los 15 días con [15-DAY-PILOT-PLAN.md](./15-DAY-PILOT-PLAN.md) y [FIRST-24-HOURS.md](./FIRST-24-HOURS.md).
5. Registrar prospectos en el PlatformCRM existente según [FIRST-20-PROSPECTS.md](./FIRST-20-PROSPECTS.md).
6. Usar textos breves de [SALES-OUTREACH.md](./SALES-OUTREACH.md) y responder objeciones con [SALES-OBJECTIONS.md](./SALES-OBJECTIONS.md).
7. Medir con [PILOT-METRICS.md](./PILOT-METRICS.md) y atender incidentes con [SUPPORT-RUNBOOK.md](./SUPPORT-RUNBOOK.md).
8. Si vuelve el acceso al servidor/cloud, seguir [PILOT-LAUNCH-RUNBOOK.md](./PILOT-LAUNCH-RUNBOOK.md).
9. Usar la checklist de [DEMO-SAFETY.md](./DEMO-SAFETY.md), la ficha [FIRST-CLIENT-DATA.md](./FIRST-CLIENT-DATA.md), el [PILOT-KICKOFF.md](./PILOT-KICKOFF.md) y [POST-DEMO-FOLLOWUP.md](./POST-DEMO-FOLLOWUP.md).
10. Tomar la decisión con [GO-NO-GO.md](./GO-NO-GO.md).

## First customer sales kit

Para preparar el primer cliente sin outreach automático, usar [IDEAL-FIRST-CUSTOMER.md](./IDEAL-FIRST-CUSTOMER.md), [LEAD-QUALIFICATION.md](./LEAD-QUALIFICATION.md), [OUTREACH-PERSONALIZATION.md](./OUTREACH-PERSONALIZATION.md), [OUTREACH-WHATSAPP.md](./OUTREACH-WHATSAPP.md), [OUTREACH-INSTAGRAM.md](./OUTREACH-INSTAGRAM.md) y [OUTREACH-EMAIL.md](./OUTREACH-EMAIL.md).

El flujo de respuesta y seguimiento está en [SALES-RESPONSE-PLAYBOOK.md](./SALES-RESPONSE-PLAYBOOK.md), [OUTREACH-SEQUENCE.md](./OUTREACH-SEQUENCE.md), [DEMO-CTA.md](./DEMO-CTA.md), [PRICING-CONVERSATION.md](./PRICING-CONVERSATION.md) y [SALES-DAILY-RUNBOOK.md](./SALES-DAILY-RUNBOOK.md). La propuesta y el objetivo están en [VALUE-PROPOSITION.md](./VALUE-PROPOSITION.md), [COMPETITIVE-POSITIONING.md](./COMPETITIVE-POSITIONING.md), [SALES-ONE-LINERS.md](./SALES-ONE-LINERS.md) y [FIRST-CUSTOMER-GOAL.md](./FIRST-CUSTOMER-GOAL.md).

La primera tanda preparada para revisión humana está en [FIRST-REAL-PROSPECT-BATCH.md](./FIRST-REAL-PROSPECT-BATCH.md). Incluye sólo evidencia comercial pública, copy pendiente de aprobación y gates de identidad; no contiene envíos ni drafts ejecutados.

El paquete individual de Axel The Barber está en [AXEL-FIRST-CONTACT.md](./AXEL-FIRST-CONTACT.md). La fase informativa de hasta cinco negocios está en [FIRST-INFORMATIONAL-OUTREACH.md](./FIRST-INFORMATIONAL-OUTREACH.md). Ambos son material para aprobación humana: no abren conversaciones ni crean drafts.

La segunda tanda con demo preparada para revisión humana está en [SECOND-PROSPECT-BATCH.md](./SECOND-PROSPECT-BATCH.md). Incluye diez negocios con evidencia comercial pública, top 5 priorizado y copy por canal; no ejecuta ningún envío.

La fase informativa anterior sólo presentaba la idea y medía respuestas. La segunda tanda habilita preparar una demo pública y mencionar 15 días gratis, siempre con revisión humana por negocio; no inicia trials, no habilita QA/producción, no usa QR/pagos y no programa follow-ups.

Este kit exige revisión humana de Lautaro, una cuenta por negocio, datos comerciales públicos y ningún envío automático. [PROSPECT-TRACKER.csv](./PROSPECT-TRACKER.csv) permanece vacío hasta que un prospecto tenga fuente y permiso operativo revisados.

## Guardas del primer piloto

- Un negocio por vez, con consentimiento y datos mínimos.
- Trial de 15 días, sin tarjeta para empezar; continuidad manual después del trial.
- WhatsApp sólo controlado/shadow mientras no exista aprobación explícita para responder o automatizar. No prometer respuestas automáticas.
- No cargar datos reales en demos ni usar datos de un negocio para otro.
- No hacer checkout, cobros, pagos, cargos, migraciones productivas ni cambios de infraestructura desde este kit.
- Registrar sólo lo necesario, sin contraseñas, tokens, números completos ni payloads privados.

## Criterio de éxito

El piloto es exitoso cuando el dueño puede configurar lo esencial, entiende el valor, usa agenda/reservas con datos propios, recibe soporte claro y expresa intención de continuar. Las métricas y la clasificación completa están en [PILOT-METRICS.md](./PILOT-METRICS.md); no se declara éxito por cantidad de mensajes o por promesas de automatización.

## Estado de esta documentación

Preparada offline sobre el RC aprobado (`qa-release-candidate`). La ejecución real queda pendiente de acceso operativo, revisión humana y aprobación de cada cambio de entorno.
