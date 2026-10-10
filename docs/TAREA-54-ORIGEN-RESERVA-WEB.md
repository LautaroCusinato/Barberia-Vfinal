# 54 · Etiqueta Web en turnos · 10/10/2026

Pedido del dueño: una pastilla verde como la de WhatsApp, para turnos
agendados desde la página pública. Implementación local para revisión; no
completar ni afirmar publicación en QA.

La base ya guarda origen='reserva_web': CHECK de
20260731210000_public_booking.sql y creación en las RPC de reserva pública,
incluida 20261002092000_public_booking_hardening.sql. No se cambia ese contrato
ni se agrega migración/backfill. No se deduce origen del teléfono, nombre,
fecha ni de la ausencia de etiqueta WhatsApp.

TurnoOriginBadge comparte las representaciones Web/WhatsApp. TurnoRow muestra
Web con icono de globo en las tarjetas de lista/detalle; Calendar usa un
indicador compacto como el existente y agrega «vía la web» al tooltip semanal.
Panel, nulos y valores desconocidos no reciben ninguna etiqueta. La variante
Web usa --green-soft/--green-text y conserva tamaño/tipografía existentes.

Smoke de render SSR sobre TurnoRow real: Web, WhatsApp, panel, undefined y
valor desconocido; marcador compacto y tooltip web PASS. No es navegador ni
prueba responsive. StatusSelect emitió avisos preexistentes de useLayoutEffect
por ejecutarse en SSR; la app es cliente y no se concluye un fallo de consola
del navegador a partir de ese arnés. Log: work/auditoria-origen54-smoke.log;
script temporal respaldado fuera del repo y retirado.

Verificar en la combinación: Agenda/lista, detalle de día, semana, claro y
oscuro a 375/1366 px; accesibilidad y ausencia de scroll horizontal. Después,
con aprobación, reserva real QA mostrando la etiqueta y conservando origen
tras editar/reprogramar/cobrar. Una reserva por panel no debe llamarse Web.

No se modifican datos, origen, reglas de reserva ni envíos. No hubo publicación
ni actividad en Supabase/n8n/Evolution. Lint, contratos, unitarios y build de la
combinación 53+54 pasaron: lint sin advertencias, npm test, 64 archivos/796
unitarios y build. Revisión visual, integración y QA pendientes.
