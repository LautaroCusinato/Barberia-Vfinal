# Alta y onboarding express de un negocio

**Estado:** `FIRST_CLIENT_ONBOARDING_READY`

Checklist para dejar una barbería lista para recibir reservas web reales en aproximadamente 15 minutos, una vez que producción esté autorizada. Se completa junto al responsable, con consentimiento explícito y datos reales del propio negocio. No crea cuentas, tenants, trials ni reservas automáticamente.

## Datos mínimos a solicitar

- [ ] Nombre comercial del negocio.
- [ ] Responsable y rol.
- [ ] Email de acceso verificado.
- [ ] WhatsApp comercial del negocio.
- [ ] Logo autorizado.
- [ ] Color principal y color secundario.
- [ ] Servicios que quiere probar.
- [ ] Precio de cada servicio.
- [ ] Duración de cada servicio en minutos.
- [ ] Barberos/profesionales y servicios que realiza cada uno.
- [ ] Horarios por barbero o del equipo.
- [ ] Breaks por barbero o generales.
- [ ] Días cerrados, feriados y bloqueos conocidos.
- [ ] Zona horaria `America/Argentina/Buenos_Aires` y moneda ARS, si corresponde.

No pedir contraseñas, tokens, conversaciones completas, agenda exportada ni contactos de terceros. El WhatsApp no es requisito para validar primero reservas web.

## Secuencia de 15 minutos

| Minutos | Acción | Comprobación |
|---|---|---|
| 00:00–02:00 | Confirmar negocio, responsable, email, consentimiento, zona horaria y moneda. | El responsable sabe quién tendrá acceso y qué se va a probar. |
| 02:00–05:00 | Cargar nombre, logo y colores autorizados. | La identidad visible corresponde al negocio correcto. |
| 05:00–08:00 | Cargar servicios con precio, duración y profesionales habilitados. | Cada servicio tiene datos correctos y al menos uno queda disponible para prueba. |
| 08:00–11:00 | Cargar barberos/profesionales, servicios que realizan y horarios. | No hay profesionales sin horario ni servicios sin responsable. |
| 11:00–13:00 | Configurar breaks, días cerrados, feriados y bloqueos. | La disponibilidad refleja las reglas comunicadas por el negocio. |
| 13:00–15:00 | Abrir la reserva pública, elegir servicio/profesional/fecha/hora y revisar la agenda. | El flujo es accesible; la reserva de smoke se hace sólo con datos acordados y no sustituye una reserva real. |

## Checklist de listo para operar

- [ ] Acceso del responsable verificado.
- [ ] Nombre, branding, zona horaria y moneda revisados.
- [ ] Servicios, precios y duraciones correctos.
- [ ] Barberos/profesionales y servicios relacionados correctamente.
- [ ] Horarios, breaks, días cerrados y bloqueos revisados.
- [ ] Reserva pública accesible y disponibilidad coherente.
- [ ] Agenda refleja el flujo de prueba.
- [ ] Clientes cargados sólo con consentimiento y datos mínimos.
- [ ] Trial de 15 días y continuidad manual explicados.
- [ ] Facturación sin cobro automático ni checkout.
- [ ] Estado real de WhatsApp explicado; no se presenta automatización live.

Si un punto falla, dejar el onboarding como `PENDING` y registrar qué falta. No marcarlo listo por cortesía.

## Mensaje de kickoff

> “Buenísimo. Vamos a configurar tu negocio juntos y vas a tener 15 días de prueba para usar agenda, servicios, equipo, clientes y reservas online con tus propios datos. Primero validamos el flujo web; WhatsApp se evalúa por separado y no lo presento como automatización activa.”

## Límites comerciales

- Austral tiene un único plan de ARS 50.000 por mes y 15 días gratis.
- Si tienen más de una sucursal: “Si tienen más de una sucursal, lo vemos según el caso.”
- No prometer precio por sucursal, descuentos, precio enterprise ni cobros automáticos.
- No iniciar el trial ni publicar el enlace real hasta contar con autorización operativa y consentimiento del negocio.
