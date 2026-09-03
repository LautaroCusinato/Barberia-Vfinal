# Austral video context

**Estado:** `VIDEO_CONTEXT_READY`

## Producto

- **Nombre exacto:** Austral
- **Público:** barberías
- **Fuente visual autorizada:** <https://barberia-qa.cuchitron.lat/>
- **Datos de las capturas:** ficticios/demo; no corresponden a clientes reales.

## Funcionalidades verificadas para mostrar

- Reservas web / reserva pública.
- Agenda de turnos.
- Clientes e historial de ejemplo.
- Servicios con precio y duración.
- Barberos/equipo con servicios y horarios.
- Configuración de horarios, breaks, días cerrados, bloqueos y branding.
- Vista comercial del trial y del plan.

## Oferta comercial vigente

- **Plan:** Austral
- **Precio:** ARS 50.000 / mes
- **Trial:** 15 días gratis
- **Multi-sucursal:** se evalúa según el caso; no hay precio por sucursal definido.

## WhatsApp

No presentar WhatsApp automation como live ni como disponibilidad general. Si hace falta mencionarlo, usar exactamente:

> “Integración de WhatsApp en desarrollo.”

## Alcance de esta captura

- La landing y el workspace `/demo` cargaron correctamente con el fixture seguro.
- La ruta pública `/reservar/...` no tenía un slug demo disponible durante la captura. `02-public-booking.png` usa la representación de reserva pública del landing, que forma parte de la interfaz comercial; `03-booking-selection.png` muestra el selector de turno del workspace demo sin confirmar ni guardar una reserva.
- La vista de Facturación fue sanitizada visualmente para no mostrar nombres de proveedores de pago.
- No se utilizaron credenciales, datos privados, producción, developer tools ni cambios persistentes.
