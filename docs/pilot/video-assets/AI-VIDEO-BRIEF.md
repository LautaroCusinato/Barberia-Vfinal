# AI video brief — Austral

**Estado:** `AI_VIDEO_BRIEF_READY`

## Objetivo

Crear un video SaaS premium de 60–75 segundos para dueños de barberías. La pieza debe mostrar cómo Austral ordena la reserva pública, agenda, clientes, servicios, equipo y la propuesta comercial, preservando exactamente los píxeles de las capturas reales.

## Entregables recomendados

- **Formato principal:** 16:9, 1920×1080.
- **Versión posterior:** 9:16 para Instagram/Reels, reencuadrando cada captura sin reducir la legibilidad.
- **Duración:** 60–75 segundos.
- **Audio:** música moderna y discreta, voz masculina joven en español rioplatense neutro, subtítulos legibles.
- **Presentación:** sin avatar humano si distrae; usar títulos cortos y foco en la interfaz.

## Secuencia visual

1. `01-landing.png` — abrir con marca y propuesta.
2. `02-public-booking.png` — reserva pública como entrada del cliente.
3. `03-booking-selection.png` — selección segura de servicio, profesional, horario y precio.
4. `04-dashboard.png` — vista general del negocio.
5. `05-agenda.png` — turnos, profesionales y estados.
6. `06-clientes.png` — ficha e historial de ejemplo.
7. `07-servicios.png` — catálogo, precios y duraciones.
8. `08-equipo.png` — barberos y horarios.
9. `09-configuracion.png` — reglas operativas y branding.
10. `10-facturacion.png` — Austral, ARS 50.000/mes y 15 días gratis.

## Dirección visual

- Moderna, minimalista, tecnológica pero cercana.
- Fondo oscuro coherente con las capturas actuales; texto y subtítulos de alto contraste.
- Movimientos suaves: paneo lento, zoom/parallax moderado y cortes limpios.
- Mantener UI nítida, sin deformar texto ni iconos.
- Usar una captura completa por escena o un recorte rectangular con bordes suaves; no superponer elementos generados encima de botones o campos.
- Música por debajo de la voz y bajar aún más durante el precio final.

## Qué no debe hacer la IA

- No inventar interfaces, métricas, clientes, logos, testimonios ni pantallas.
- No reemplazar screenshots reales por UI generada.
- No animar texto de la interfaz como si fuera editable si no lo es.
- No usar 3D exagerado, estética gaming, exceso de stock footage ni avatar protagonista.
- No mostrar credenciales, datos reales, proveedores de pago, herramientas internas o URLs privadas.
- No presentar WhatsApp automático como disponible. Si aparece, usar “Integración de WhatsApp en desarrollo.”

## Motor recomendado

### `RECOMMENDED_VIDEO_ENGINE`: Remotion / composición asistida con screenshots reales

Es la opción principal porque permite montar imágenes reales, títulos, subtítulos, música y movimientos de cámara sin pasar la UI por un modelo generativo que pueda deformar texto. La composición debe tratar cada screenshot como una capa bloqueada.

### `SECOND_OPTION`: HeyGen Video Agent con screenshots bloqueados

Puede servir para ensamblar voz, subtítulos y ritmo si acepta las capturas como assets no editables. No usar transformaciones image-to-video sobre la interfaz ni un avatar que compita con el producto.

### No recomendado para la UI

Runway u otros generadores image-to-video sólo serían adecuados para una transición abstracta muy breve, nunca para animar o reconstruir pantallas con texto. Si se usan, mantenerlos fuera de la UI real.

## Reglas de aprobación

- Revisar el video cuadro a cuadro antes de compartirlo.
- Confirmar que el precio sea exactamente ARS 50.000/mes y el trial exactamente 15 días gratis.
- Confirmar que la voz no prometa automatización de WhatsApp, pagos automáticos, Mercado Pago, PayPal ni resultados garantizados.
- No publicar ni enviar el video sin revisión humana de Lautaro.
