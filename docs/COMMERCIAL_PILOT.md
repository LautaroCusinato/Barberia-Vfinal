# Piloto comercial controlado

La vista **Piloto comercial** del panel de plataforma prepara cinco fichas en modo local. Guarda los borradores en `localStorage` del navegador y no escribe en Supabase. Es una barrera intencional mientras no haya autorización para cargar leads reales.

## Procedimiento

1. Abrir `Plataforma → Piloto comercial`.
2. Completar una ficha con negocio, país, idioma, rubro, sitio, Instagram, WhatsApp, email, fuente, evidencia, necesidad observada, base legal, canal, estado y próxima acción.
3. Revisar el score y la recomendación de precio. El cálculo es explicable, separa setup/mensualidad y respeta mínimo de USD 10.
4. Generar y editar el borrador mock. Se soportan email, formulario web, Instagram DM, WhatsApp y LinkedIn como canales de preparación; ninguno tiene proveedor de envío.
5. Completar el checklist: fuente, DNC, score, mensaje, edición, canal, precio, aprobación humana y autorización.
6. Guardar borradores localmente. El estado aprobado significa únicamente “listo para revisión final”, nunca “enviado”.
7. Cuando se autorice el primer contacto, cargar el lead en el CRM global, volver a verificar DNC y registrar manualmente el resultado.

No existe un botón de envío en esta vista. Para operar un lead real todavía deben autorizarse el canal, el texto final, el precio y el destinatario de forma explícita.

## Demo para un lead

Abrir `/demo`, elegir vertical, color y servicio, crear una reserva ficticia y reiniciar la sesión. La demo no usa tenants productivos, Supabase, WhatsApp, Evolution ni pagos.
