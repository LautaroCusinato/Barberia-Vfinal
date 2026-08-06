# Acceso operativo por suscripcion

La migracion `20260806120000_enforce_booking_access.sql` agrega una frontera
de integridad en PostgreSQL para las reservas de la web.

Se aceptan nuevas reservas cuando el estado efectivo es:

- `active`;
- `trialing`;
- `past_due` como ventana de gracia.

Las cuentas `suspended`, `paused`, `canceled` o `expired` no pueden insertar
turnos con origen `reserva_web`, incluso si alguien intenta llamar la RPC
directamente. El panel y WhatsApp conservan sus reglas actuales hasta que se
defina el flujo de billing y su política de gracia completa.

Los tenants existentes fueron verificados antes de aplicar la migracion y se
encuentran en estado efectivo `active`.
