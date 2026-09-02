# Seguridad de la demo en vivo

Checklist breve antes de compartir pantalla. La demo usa datos ficticios y el adapter local; no iniciar una cuenta real para improvisar.

## Antes de empezar

- [ ] Sesión/profil de navegador correcto y sin pestañas con producción.
- [ ] Ruta `/demo` o entorno de demo identificado; tenant demo = Austral Barber Demo.
- [ ] Agenda contiene turnos relativos a la fecha actual.
- [ ] Servicios, profesionales, horarios, breaks y bloqueos se ven coherentes.
- [ ] Reserva pública demo abre y ofrece disponibilidad sin enviar datos reales.
- [ ] No aparecen clientes reales, secretos, números completos ni capturas de infraestructura.
- [ ] WhatsApp se describe como conexión/configuración separada; shadow no se presenta como auto-respuesta.
- [ ] Billing se muestra como trial de 15 días y continuidad manual; no abrir checkout.
- [ ] Tener preparada la salida comercial y el contacto de soporte.

## Si algo falla

**Booking falla:** decir “La demo no pudo cargar esta consulta; no voy a inventar un turno. Podemos revisar otra fecha o mostrar la Agenda”. Registrar ruta/hora y continuar sólo con una lectura segura.

**WhatsApp unavailable:** decirlo tal cual: “La conexión requiere configuración adicional y hoy no la vamos a activar”. Continuar con booking y operación; no reconectar ni mostrar un QR.

**La página tarda:** esperar una vez, comprobar la ruta y explicar que se está cargando. Si persiste, pasar a una captura/flujo local preparado; no refrescar repetidamente ni ocultar el error.

**Sesión expirada:** volver al login de demo o reiniciar la sesión ficticia. No pedir ni copiar credenciales del dueño en la llamada.

**Agenda vacía:** comprobar que la fecha de la demo esté dentro del seed relativo. Si no hay datos, mostrar Servicios/Equipo y registrar el fixture para corregirlo después; no crear turnos durante la reunión.

Nunca continuar con una pantalla de error como si fuera una confirmación, ni transformar un fallo en promesa de disponibilidad, conexión o cobro.
