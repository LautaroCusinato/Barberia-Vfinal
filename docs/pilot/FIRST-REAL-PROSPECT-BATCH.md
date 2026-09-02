# First real prospect batch

Preparación offline para revisión humana de Lautaro. Este documento no autoriza ni ejecuta mensajes, emails, DMs, WhatsApp, drafts de Gmail ni contactos.

**Fecha de revisión pública:** 2026-09-02

**Estado:** `OUTREACH_READY_FOR_HUMAN_REVIEW`

**Envíos:** `DO_NOT_SEND`
**Regla:** antes de cualquier draft o contacto, confirmar que el canal pertenece directamente al negocio. Si el canal resulta ser de una agencia, proveedor, software, intermediario o persona no identificada, mantener `CONTACT_IDENTITY_REVIEW` y no contactar.

## Fuentes y límites

- Se usó únicamente información comercial públicamente visible en los enlaces de cada ficha.
- No se guardan emails, teléfonos completos, nombres privados ni datos de clientes.
- `observable pain` distingue entre un hecho visible y una hipótesis a validar; nunca afirma un problema interno no publicado.
- Cantidad de profesionales, clientes, ingresos y software actual quedan como `desconocido` cuando no hay evidencia.
- Un score alto no reemplaza la revisión humana del destinatario ni del canal.

## Tabla comparativa

| Prospecto | Evidencia comercial pública verificada | `observed_booking_method` | Perfil aproximado | Dolor observable / hipótesis | Score | Canal sugerido | `contact_owner_type` | Gate |
|---|---|---|---|---|---:|---|---|---|
| Axel The Barber — Villa Devoto | Sitio oficial: atención personalizada, 7 años de oficio, servicios, dirección y horarios; publica reserva previa por WhatsApp e Instagram `@axeelthebarber`. [Fuente](https://axeelthebarber.com.ar/) | WhatsApp con turno previo; web e Instagram públicos | Marca profesional de barbería de una ubicación; se identifica públicamente a Axel Andrada; tamaño del equipo no publicado | Hecho: la reserva publicada depende de WhatsApp. Hipótesis: coordinación manual de turnos | 82 (A) | WhatsApp | `BUSINESS_DIRECT` por canal publicado en sitio oficial; verificar en revisión | `READY_TO_CONTACT_AFTER_REVIEW` |
| La Guarida Barbería — CABA | Sitio oficial: desde 2018, servicios de corte/barba/afeitado, dirección, horarios, WhatsApp y reserva online. [Fuente](https://laguaridabarberia.com/) | WhatsApp recomendado y reserva online; ambos publicados por el sitio oficial | Barbería tradicional con una ubicación pública; equipo y cantidad de profesionales no publicados | Hecho: existen dos rutas públicas de reserva. Hipótesis: puede convenir una vista más unificada | 74 (B) | WhatsApp | `BUSINESS_DIRECT` por canal publicado en sitio oficial; verificar en revisión | `READY_TO_CONTACT_AFTER_REVIEW` |
| TwinCam.Studio — Ramos Mejía | Ficha pública con dirección, horarios, teléfono comercial e Instagram `@twincam.studio`. [Fuente](https://www.waze.com/live-map/directions/ar/provincia-de-buenos-aires/ramos-mejia/twincam.studio?to=place.ChIJt8WBflLJvJURm4SRpcaHxSU) | No verificado; no se encontró una página pública de reservas en la fuente revisada | Studio/barbería con presencia local y horarios publicados; servicios y equipo no publicados en la fuente | Hecho: no aparece un método de reserva en la ficha revisada. Hipótesis: puede haber coordinación por DM/teléfono | 64 (B) | Instagram, sólo después de confirmar el perfil oficial | `UNKNOWN` hasta confirmar que el perfil corresponde al negocio | `CONTACT_IDENTITY_REVIEW` |
| Coco barber shop — Palermo | Ficha pública con Av. Córdoba 5391, Palermo, horarios martes–sábado y reseñas públicas. [Fuente](https://salonberlin.com.ar/peluqueria/coco-barber-shop-palermo/) | No verificado; la ficha indica contacto telefónico, sin enlace directo de reserva | Barbería moderna de una ubicación listada; equipo y sistema actual no publicados | Hecho: no aparece un canal de reserva directo en la fuente revisada. Hipótesis: puede existir coordinación manual | 50 (C) | Instagram, sólo después de confirmar el perfil oficial | `UNKNOWN` | `CONTACT_IDENTITY_REVIEW` |
| Correa Barber — Almagro | Ficha comercial secundaria: Mario Bravo 308, barbería masculina, estilo dominicano, horarios y reseñas. [Fuente](https://lacabeautysarmiento.com.ar/salon-belleza/correa-barber-barberia-shop-almagro/) | No verificado; la ficha sólo muestra contacto telefónico | Barbería de barrio en Almagro; equipo, dueño y sistema actual no publicados | La fuente menciona posibles esperas en alta afluencia, pero es una señal secundaria, no un hecho interno confirmado | 48 (C) | Instagram, sólo después de confirmar el perfil oficial | `UNKNOWN` | `CONTACT_IDENTITY_REVIEW` |

## Fichas personalizadas

### 1. Axel The Barber — Villa Devoto

1. **`observed_booking_method`**: turno previo por WhatsApp; el sitio también publica Instagram y una página de reserva.
2. **Perfil aproximado**: marca profesional de una ubicación en Villa Devoto, con 7 años de oficio y servicios de corte, barba y combo. El sitio identifica a Axel Andrada; no publica cantidad de profesionales.
3. **Dolor observable**: no hay un dolor interno declarado. La única señal verificable es que el turno se coordina por WhatsApp; la carga manual es una hipótesis, no un hecho.
4. **Por qué Austral puede encajar**: podría ordenar agenda y reservas públicas sin exigir cambiar de golpe el canal conocido. No prometer automatización de WhatsApp.
5. **Score**: 82/100 — alta actividad y presencia propia, canal de reserva claro y contacto comercial directo; se descuenta por tamaño de equipo y sistema actual no publicados.
6. **Canal recomendado**: WhatsApp comercial publicado en el sitio oficial, sujeto a revisión humana del chat de destino.
7. **Primera línea personalizada**: “Vi que en Axel The Barber trabajan con turno previo por WhatsApp en Villa Devoto.”
8. **Mensaje inicial recomendado**:

   > Hola, ¿cómo va? Soy Lautaro, estoy armando Austral, una agenda simple para barberías. Vi que en Axel The Barber trabajan con turno previo por WhatsApp en Villa Devoto. ¿Te puedo mostrar una demo de 5 minutos?

9. **Follow-up #1** (día 2/3):

   > Hola, Axel. Retomo por si se perdió el mensaje. La idea es ordenar reservas y agenda sin complicar la forma de trabajar. ¿Te muestro una demo de 5 minutos?

10. **Follow-up #2** (día 6/7):

   > Último mensaje por acá, no quiero molestar. Si en algún momento querés ver una agenda para barberías, ¿te muestro una demo de 5 minutos?

11. **Si pregunta “¿qué es?”**: “Austral es una herramienta para ordenar agenda, reservas, clientes, servicios y horarios de una barbería. La podemos probar 15 días y ver si te resulta útil.”
12. **Si pregunta precio**: “El plan Starter está en ARS 30.000 por mes y hay 15 días de prueba gratis. En el piloto vemos qué nivel encaja; todavía no asignamos prestaciones cerradas por plan.”
13. **CTA de demo**: “Si querés, te muestro cómo funciona en 5 minutos.”
14. **Objeción principal probable**: “No quiero cambiar cómo tomo turnos por WhatsApp.”
15. **Respuesta sugerida**: “Tiene sentido. La idea es mostrarte si una agenda ordenada te simplifica el día, sin pedirte cambiar todo de entrada; la integración de WhatsApp sigue en validación con pilotos.”

### 2. Correa Barber — Almagro

1. **`observed_booking_method`**: no verificado. La fuente pública sólo muestra contacto telefónico, sin reserva directa.
2. **Perfil aproximado**: barbería masculina en Mario Bravo 308, Almagro, con estilo dominicano descrito por una fuente comercial secundaria, horarios amplios y reseñas públicas. Equipo y dueño no confirmados.
3. **Dolor observable**: no hay dolor interno confirmado. La fuente secundaria menciona posibles esperas en días de alta afluencia; tratarlo sólo como hipótesis.
4. **Por qué Austral puede encajar**: si se confirma que los turnos se coordinan manualmente, Austral podría ordenar agenda y reservas; primero hay que validar el flujo real.
5. **Score**: 48/100 — actividad y presencia comercial visibles, pero sin canal directo ni método de reserva verificado.
6. **Canal recomendado**: Instagram únicamente después de identificar el perfil oficial; si no se confirma, no contactar.
7. **Primera línea personalizada**: “Vi que Correa Barber está en Mario Bravo, Almagro, y que la propuesta está enfocada en barbería masculina.”
8. **Mensaje inicial recomendado (sólo como copy pendiente de identidad)**:

   > Hola, ¿cómo va? Soy Lautaro, estoy armando Austral, una agenda simple para barberías. Vi que Correa Barber está en Mario Bravo, Almagro, y que la propuesta está enfocada en barbería masculina. ¿Te puedo mostrar una demo de 5 minutos?

9. **Follow-up #1** (sólo si se valida canal directo):

   > Hola, ¿cómo va? Retomo por si se perdió el mensaje. Quería mostrarte una forma simple de ordenar reservas y agenda. ¿Te muestro una demo de 5 minutos?

10. **Follow-up #2** (sólo si se valida canal directo):

   > Último mensaje por acá. Si más adelante querés ver cómo funciona una agenda para barberías, ¿te muestro una demo de 5 minutos?

11. **Si pregunta “¿qué es?”**: “Austral ordena agenda, reservas, clientes, servicios y horarios para que el equipo tenga la información más clara. Se puede probar 15 días.”
12. **Si pregunta precio**: “Starter cuesta ARS 30.000 por mes y hay 15 días gratis. En el piloto definimos qué nivel encaja mejor; no hay prestaciones por plan cerradas todavía.”
13. **CTA de demo**: “Si querés, te muestro cómo funciona en 5 minutos.”
14. **Objeción principal probable**: “¿Qué problema me resuelve?”
15. **Respuesta sugerida**: “Depende de cómo estén tomando turnos hoy. Primero miramos ese flujo y, si hay mensajes o agenda dispersa, te muestro si Austral puede ordenarlo; no hace falta asumir un cambio antes de verlo.”

**Gate específico**: `CONTACT_IDENTITY_REVIEW`. La fuente disponible no permite asignar un destinatario directo ni un perfil oficial; no preparar Gmail ni contacto real todavía.

### 3. TwinCam.Studio — Ramos Mejía

1. **`observed_booking_method`**: no verificado. La ficha pública muestra Instagram y teléfono comercial, pero no confirma que allí se tomen turnos.
2. **Perfil aproximado**: studio/barbería con presencia local en Gral. Julio Argentino Roca 457, Ramos Mejía, y horarios públicos de martes a sábado. Servicios, equipo y dueño no publicados en la fuente revisada.
3. **Dolor observable**: la ficha no muestra una reserva online; eso es una brecha de información pública, no prueba de un problema operativo.
4. **Por qué Austral puede encajar**: podría sumar una ruta pública de reservas y una agenda ordenada si hoy no existe; hay que confirmarlo antes.
5. **Score**: 64/100 — presencia local reciente y canal social visible; se descuenta por identidad directa y booking no verificados.
6. **Canal recomendado**: Instagram `@twincam.studio`, sólo tras verificar que el perfil es oficial y comercial.
7. **Primera línea personalizada**: “Vi que TwinCam.Studio está en Ramos Mejía y que tienen un perfil público de Instagram.”
8. **Mensaje inicial recomendado (sólo como copy pendiente de identidad)**:

   > Hola, ¿cómo va? Soy Lautaro, estoy armando Austral, una agenda simple para barberías. Vi que TwinCam.Studio está en Ramos Mejía y que tienen un perfil público de Instagram. ¿Te puedo mostrar una demo de 5 minutos?

9. **Follow-up #1** (sólo si se valida canal directo):

   > Hola, ¿cómo va? Retomo por si se perdió el mensaje. Quería mostrarte una forma simple de ordenar turnos y agenda. ¿Te muestro una demo de 5 minutos?

10. **Follow-up #2** (sólo si se valida canal directo):

   > Cierro por acá para no insistir. Si en algún momento querés ver una agenda pensada para barberías, ¿te muestro una demo de 5 minutos?

11. **Si pregunta “¿qué es?”**: “Austral es una herramienta para ordenar reservas, agenda, clientes, servicios y horarios. La idea es probarla 15 días y ver si les simplifica el trabajo.”
12. **Si pregunta precio**: “Starter está en ARS 30.000 por mes, con 15 días de prueba gratis. En el piloto definimos qué nivel encaja; no inventamos diferencias de prestaciones.”
13. **CTA de demo**: “Te puedo pasar una demo y ves si te sirve.”
14. **Objeción principal probable**: “No sé si necesitamos otra herramienta.”
15. **Respuesta sugerida**: “Totalmente válido. La demo es corta y sirve para comparar con lo que ya usan; si no aporta, no hace falta seguir.”

**Gate específico**: `CONTACT_IDENTITY_REVIEW` hasta validar el Instagram como canal directo del negocio.

### 4. La Guarida Barbería — CABA

1. **`observed_booking_method`**: el sitio oficial recomienda reservar por WhatsApp y también ofrece reserva online; admite atención sin turno según disponibilidad.
2. **Perfil aproximado**: barbería tradicional en Sánchez de Bustamante 2336, CABA, activa desde 2018, con cortes, barba, afeitado clásico y atención personalizada. Cantidad de profesionales no publicada.
3. **Dolor observable**: no se declara un problema interno. La coexistencia de WhatsApp y reserva online puede generar una hipótesis de coordinación entre canales, a validar.
4. **Por qué Austral puede encajar**: puede ser útil para comparar una agenda unificada o acompañar un flujo ya digitalizado; no se debe presentar como reemplazo automático.
5. **Score**: 74/100 — presencia oficial fuerte y contacto directo, aunque ya existe reserva online y el equipo/sistema actual no están confirmados.
6. **Canal recomendado**: WhatsApp enlazado desde el sitio oficial, sujeto a revisión humana del destino.
7. **Primera línea personalizada**: “Vi que en La Guarida recomiendan reservar por WhatsApp y también tienen reserva online.”
8. **Mensaje inicial recomendado**:

   > Hola, ¿cómo va? Soy Lautaro, estoy armando Austral, una agenda simple para barberías. Vi que en La Guarida recomiendan reservar por WhatsApp y también tienen reserva online. ¿Te puedo mostrar una demo de 5 minutos?

9. **Follow-up #1** (día 2/3):

   > Hola, ¿cómo va? Retomo por si se perdió el mensaje. Como ya tienen más de un canal de reserva, quería mostrarte cómo ordenamos agenda y turnos en una demo corta. ¿Te la muestro?

10. **Follow-up #2** (día 6/7):

   > Último mensaje por acá, no quiero molestar. Si alguna vez querés comparar otra forma de ordenar reservas, ¿te muestro una demo de 5 minutos?

11. **Si pregunta “¿qué es?”**: “Austral ordena agenda, reservas, clientes, servicios y horarios para una barbería. Si ya tienen un sistema, la demo sirve para comparar sin asumir una migración.”
12. **Si pregunta precio**: “Starter cuesta ARS 30.000 por mes y hay 15 días de prueba gratis. En el piloto vemos qué nivel encaja mejor, sin prometer prestaciones que todavía no estén cerradas.”
13. **CTA de demo**: “Si querés, te muestro cómo funciona en 5 minutos.”
14. **Objeción principal probable**: “Ya tenemos reservas online.”
15. **Respuesta sugerida**: “Perfecto, entonces no tendría sentido cambiar por cambiar. Podemos comparar el flujo actual con una demo corta y ver si hay algo que realmente les simplifique la agenda.”

### 5. Coco barber shop — Palermo

1. **`observed_booking_method`**: no verificado. La ficha pública indica contacto telefónico y horarios, pero no ofrece un enlace directo de reserva.
2. **Perfil aproximado**: barbería moderna listada en Av. Córdoba 5391, Palermo, con horarios publicados de martes a sábado y reseñas públicas. Equipo, dueño y sistema actual no publicados.
3. **Dolor observable**: no hay dolor interno confirmado. La ausencia de una reserva directa visible es sólo una brecha de información pública; no permite afirmar que pierdan turnos.
4. **Por qué Austral puede encajar**: si hoy coordinan por teléfono o mensajes, una agenda pública podría ordenar el acceso; primero hay que verificar el canal y el flujo real.
5. **Score**: 50/100 — actividad y ubicación visibles, pero identidad de canal y método de reserva no confirmados.
6. **Canal recomendado**: Instagram sólo después de confirmar el perfil oficial; no usar teléfonos de directorios como sustituto de identidad.
7. **Primera línea personalizada**: “Vi que Coco barber shop está en Palermo, sobre Av. Córdoba, y que tienen horarios publicados de martes a sábado.”
8. **Mensaje inicial recomendado (sólo como copy pendiente de identidad)**:

   > Hola, ¿cómo va? Soy Lautaro, estoy armando Austral, una agenda simple para barberías. Vi que Coco barber shop está en Palermo, sobre Av. Córdoba, y que tienen horarios publicados de martes a sábado. ¿Te puedo mostrar una demo de 5 minutos?

9. **Follow-up #1** (sólo si se valida canal directo):

   > Hola, ¿cómo va? Retomo por si se perdió el mensaje. Quería mostrarte una forma simple de ordenar reservas y horarios. ¿Te muestro una demo de 5 minutos?

10. **Follow-up #2** (sólo si se valida canal directo):

   > Último mensaje por acá, no quiero insistir. Si más adelante te interesa ver una agenda para barberías, ¿te muestro una demo de 5 minutos?

11. **Si pregunta “¿qué es?”**: “Austral es una herramienta para ordenar agenda, reservas, clientes, servicios y horarios. Se puede probar 15 días y evaluar con calma.”
12. **Si pregunta precio**: “El Starter está en ARS 30.000 por mes y hay 15 días gratis. Durante el piloto definimos qué nivel encaja; los entitlements de cada plan todavía no están cerrados.”
13. **CTA de demo**: “Te puedo pasar una demo y ves si te sirve.”
14. **Objeción principal probable**: “Pasame info y lo veo después.”
15. **Respuesta sugerida**: “Dale, te paso lo más corto: Austral ordena agenda y reservas de una barbería. Si después te sirve, vemos una demo de 5 minutos; no hace falta decidir nada ahora.”

**Gate específico**: `CONTACT_IDENTITY_REVIEW` hasta confirmar que el canal elegido corresponde a Coco barber shop de Palermo y no a otro negocio con el mismo nombre.

## FIRST CONTACT RECOMMENDATION

Orden recomendado para revisión y eventual contacto manual, sin ejecutar ninguno:

1. **Axel The Barber — Villa Devoto**: mejor evidencia directa y booking por WhatsApp explícito; mensaje muy concreto.
2. **La Guarida Barbería — CABA**: fuente oficial y canales directos; validar si buscan mejorar un flujo que ya tiene reserva online.
3. **TwinCam.Studio — Ramos Mejía**: presencia pública y Instagram visible, pero confirmar identidad y método de turnos antes de usarlo.
4. **Coco barber shop — Palermo**: buena presencia en fuente secundaria, pero falta canal directo y existe riesgo de homónimos.
5. **Correa Barber — Almagro**: ficha comercial secundaria sin canal de reserva ni perfil directo verificable; requiere más revisión.

## Checklist antes de cualquier acción humana

- Confirmar el perfil/canal directamente desde la web o cuenta oficial del negocio.
- Asignar `contact_owner_type`: sólo `BUSINESS_DIRECT` o `EMPLOYEE_BUSINESS` permiten pasar a `READY_TO_CONTACT`; `UNKNOWN` queda en `CONTACT_IDENTITY_REVIEW`.
- Revisar duplicados, DNC y respuestas previas en CRM.
- Copiar un solo mensaje, una sola CTA y un solo negocio por contacto.
- No crear Gmail draft mientras falte identidad directa verificada.
- No enviar nada sin aprobación explícita de Lautaro.

**Estado final:** `OUTREACH_READY_FOR_HUMAN_REVIEW`

**Envíos realizados:** `0`
