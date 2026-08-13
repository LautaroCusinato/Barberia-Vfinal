# Checklist manual PRE-RC2

Esta lista está pensada para una revisión corta de alto valor. Usá únicamente una cuenta QA/demo autorizada para crear o modificar datos. No actives WhatsApp, no hagas pagos y no uses Barbería Central ni Barbería Nueva para pruebas destructivas.

## DESKTOP

1. **Auth** — Abrí `/registro`, completá el formulario sin enviarlo; verificá nombre, email y contraseña. Probá confirmación de email, login, logout y recuperación desde `/recuperar`.
2. **Sesión** — Después de logout, usá Atrás y refrescá: no deben reaparecer datos privados ni abrirse el workspace sin autenticación.
3. **Onboarding** — Con un usuario QA sin tenant, creá un negocio de prueba y verificá que la transición termine en el dashboard sin pantalla blanca, flashes ni redirecciones inesperadas.
4. **Checklist** — Minimizá el checklist, refrescá y confirmá que conserve el estado; completalo y verificá que no reaparezca solo.
5. **Dashboard** — Contrastá turnos de hoy, próximos turnos, clientes, equipo y porcentaje del checklist con los datos visibles del tenant.
6. **Navegación** — Cambiá entre Resumen, Agenda, Clientes, Servicios, Equipo, Horarios y Configuración; confirmá que el sidebar no tenga doble scrollbar y que el footer sea alcanzable.
7. **Dark mode** — Activá dark mode desde el shell y revisá dashboard, sidebar, modales, inputs, estados vacíos y foco.
8. **Agenda — crear** — Creá un turno QA seleccionando servicio, barbero, fecha y horario; confirmá que la duración y el precio correspondan.
9. **Agenda — editar/cancelar** — Editá servicio, barbero, fecha y hora; luego cancelá el turno. Verificá que la UI se actualice sin F5 y que el refresh conserve el resultado.
10. **Agenda — reglas** — Probá un horario que cruce un break/bloqueo, un turno solapado y un horario fuera de jornada. Deben rechazarse con un mensaje claro.
11. **Equipo** — Creá o editá un barbero QA, asignale y quitale un servicio, y revisá horario laboral, break y día no laboral.
12. **Servicios** — Creá tres servicios consecutivos y verificá `Nuevo servicio 1`, `Nuevo servicio 2`, `Nuevo servicio 3`; eliminá el segundo, creá otro y comprobá el primer nombre libre.
13. **Servicios — duplicado** — Intentá duplicar un nombre cambiando mayúsculas y espacios; el error debe ser específico y no crear una segunda fila.
14. **Clientes** — Creá y editá un cliente QA; revisá teléfono, notas, última visita, próxima visita e historial después de refrescar.
15. **Mensajes** — Abrí una conversación QA, verificá scroll inicial al final, mensajes largos y SafeMarkdown; cambiá de conversación y volvé sin perder el contexto.
16. **Notas** — Creá, editá y eliminá una nota QA; verificá persistencia y estado vacío.
17. **Configuración** — Cambiá nombre, contacto, teléfono, logo, color principal y secundario; guardá, salí, volvé y refrescá.
18. **Branding público** — Abrí la reserva pública del tenant QA y confirmá que logo, colores y nombre coincidan con Configuración.
19. **Billing** — Revisá trial, estado de suscripción, proveedor y mensajes. Los botones deben dejar claro cuando el proveedor productivo está deshabilitado; no deben iniciar un cobro real.
20. **WhatsApp** — En un tenant nuevo o sin integración, confirmá “desconectado”, toggle deshabilitado y explicación visible. No actives `reply_only` ni `booking_enabled`.

## MOBILE — SAMSUNG/CHROME

Probá en 360–430 px, con Chrome Android y teclado visible cuando corresponda.

21. **Shell y safe area** — Abrí el panel en 360, 390, 412 y 430 px; confirmá que la navegación inferior no tape el último elemento y que no haya overflow horizontal.
22. **Auth y teclado** — Abrí login, registro y recuperación; el teclado no debe tapar el botón principal y los targets importantes deben ser cómodos de tocar.
23. **Onboarding** — Avanzá un paso, girá el dispositivo si aplica y volvé; verificá progreso, loader y persistencia.
24. **Agenda móvil** — Cambiá día/semana/mes, abrí un turno y desplazate hasta el final; revisá números, breaks, bloqueos y acción “Nuevo turno”.
25. **Clientes** — Confirmá que cada card sea vertical y legible: nombre, teléfono, última visita, próximo turno, notas y acciones.
26. **Mensajes** — Abrí una conversación larga; comprobá burbujas, timestamp, scroll al final, indicador de mensajes nuevos y retorno a la lista.
27. **Modales y formularios** — Abrí edición de turno, cliente, servicio y configuración; verificá que el modal entre en viewport, que Escape/cerrar funcionen y que el scroll se restaure.
28. **Logo móvil** — Configuración → seleccionar imagen Android → preview → guardar → salir → volver; verificá persistencia y logo en reserva pública.
29. **Billing móvil** — Revisá trial y botones de proveedor; confirmá que ninguna acción parezca un cobro real.
30. **Dark mode móvil** — Revisá shell, Agenda, cards, mensajes, inputs, modal, skeletons y estados disabled con contraste suficiente.

## MULTI-TAB / REALTIME

31. **Preparación** — Abrí dos pestañas autenticadas del mismo tenant QA: Tab A en Agenda y Tab B en Agenda o Clientes.
32. **Cambio en A** — Creá o editá un dato QA en Tab A; esperá la actualización razonable en Tab B. Si no llega, cambiá de sección y volvé para comprobar el fallback.
33. **Background** — Dejá Tab B en background durante un cambio en A; al regresar, verificá que refresque sin duplicar filas ni mostrar datos stale.
34. **Refresh** — Refrescá ambas pestañas y confirmá que la sesión y workspace se restauren sin repetir requests visibles ni perder el tenant.
35. **Cierre seguro** — Cerrá sesión en una pestaña y verificá que la otra no siga mostrando datos privados después de refrescar.

## SESIÓN EXPIRADA (QA/LOCAL)

No cambies la expiración productiva global. Para una prueba segura, usá sólo QA/local:

1. Iniciá sesión con un usuario QA y abrí una pantalla autenticada.
2. En una sesión QA controlada, revocá o dejá expirar la sesión según el procedimiento permitido por el proyecto; no uses cuentas reales.
3. Volvé a la pestaña y ejecutá una acción/refresh.
4. Confirmá redirect canónico a `https://barberia.cuchitron.lat/ingresar`, workspace limpiado y ausencia de datos privados stale.
5. Usá Atrás y refrescá: no debe reabrir el panel autenticado sin login.

Si no tenés una forma QA autorizada de revocar la sesión, omití este punto y reportalo como “no ejecutado”, no fuerces tokens ni modifiques Auth global.

## Cómo reportar un hallazgo

Para cada problema anotá:

- sección;
- PC o móvil (modelo, navegador y viewport);
- pasos exactos;
- resultado esperado;
- resultado obtenido;
- captura o video;
- si ocurre siempre o de forma intermitente;
- hora aproximada y usuario/tenant QA usado.

No incluyes passwords, tokens, cookies, teléfonos reales ni datos privados en la evidencia.

## Criterio de cierre

Marcá cada punto como `OK`, `FALLA`, `NO EJECUTADO` o `BLOQUEADO`. Una falla de seguridad, cross-tenant, pérdida de datos o función principal bloquea PRE-RC2; un detalle visual aislado queda como P2/P3 para una etapa posterior.
