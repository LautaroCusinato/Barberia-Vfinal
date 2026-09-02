# Personalization engine

## Inputs

For each lead, provide only fields supported by public evidence or by the business:

`BUSINESS_NAME`
`NEIGHBORHOOD`
`OBSERVED_BOOKING_METHOD`
`NUMBER_OF_BARBERS`
`OBSERVED_PAIN`
`INSTAGRAM_DETAIL`
`WEBSITE_DETAIL`

## Output

Generate exactly one natural opening line, then review it manually. The line should connect one observed fact to one plausible operational benefit without claiming inside knowledge.

### Safe patterns

- “Vi que toman los turnos por WhatsApp y quería mostrarte una forma simple de ordenar esa agenda.”
- “Vi que trabajan varios barberos; Austral ayuda a dejar servicios, horarios y reservas más claros.”
- “Vi que ya tienen reservas online; podemos mostrarte cómo Austral organiza la operación alrededor de ese flujo.”
- “Vi el detalle de [servicio/dinámica pública] en su perfil y pensé que podía interesarte una demo breve.”

### Rules

1. Use one or two concrete public facts, never a dossier.
2. Say “vi que” or “en su sitio aparece”; do not imply a personal visit or customer experience.
3. Never invent number of clients, volume, pain, owner name, response time or business performance.
4. Never write “estuve investigándolos mucho”, “sé que tienen problemas” or similar creepy language.
5. If a fact is uncertain, omit it.
6. Keep the first message focused on a reply, not a feature list.
7. Avoid identical openings in a cohort; vary rhythm, not the truth.

## Human review record

Before use, record:

- source URL for each personalized fact;
- reviewer and timestamp;
- `contact_owner_type`;
- DNC and duplicate result;
- final edited sentence;
- approval decision.

No personalization engine sends, queues or schedules a message.
