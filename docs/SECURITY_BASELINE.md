# Baseline de seguridad SaaS

## Endurecimiento aplicado

La migracion `20260806110000_harden_security_definer_grants.sql` reduce el
alcance de las funciones `SECURITY DEFINER` heredadas:

- las funciones de triggers y bootstrap no se pueden invocar desde `anon` ni
  desde `authenticated`;
- `get_conversacion` y `upsert_conversacion` quedan reservadas a la credencial
  privada `service_role` de n8n;
- los helpers de RLS (`is_barberia_member` e `is_barberia_role`) solo se
  pueden ejecutar desde `authenticated`;
- `get_conversacion`, `upsert_conversacion` y `actualizar_proximo_turno_cliente`
  fijan `search_path` para evitar resoluciones manipulables.

Las tres RPC de reservas publicas (`catalogo_reserva_publica`,
`horarios_disponibles_reserva_publica` y `crear_reserva_publica`) conservan
ejecucion para `anon` porque son la superficie publica intencional de la web
de reservas.

## Advertencias conocidas

Supabase puede seguir mostrando advertencias sobre que los helpers de RLS son
`SECURITY DEFINER` ejecutables por `authenticated`. Es intencional: las
politicas necesitan consultar membresias sin quedar atrapadas por RLS
recursivo. No se debe revocar ese permiso sin reemplazar primero el patron por
una funcion privada o un rol de acceso equivalente.

## Siguiente endurecimiento

El siguiente paso de seguridad es aplicar el estado de suscripcion a la
reserva publica y a las escrituras del panel, manteniendo una ventana de
gracia para `past_due`. Debe probarse primero con una cuenta de prueba para no
bloquear accidentalmente los tenants actuales.
