# Autorización de billing

La migración `20260807060000_billing_authorization_hardening.sql` separa las capacidades de lectura comercial, administración, reconciliación y checkout. Las migraciones `20260807061000_billing_auth_null_safety.sql` y `20260807062000_billing_auth_boolean_safety.sql` garantizan que una identidad sin membresía se evalúe como `false`, nunca como `NULL`. `20260807063000_billing_helper_privileges.sql` evita que esos helpers internos sean RPC directos para usuarios autenticados.

| Rol | Lectura comercial | Checkout propio | Checkout de terceros | Cambios administrativos | Reconciliación |
| --- | --- | --- | --- | --- | --- |
| Owner de tenant | Sí, sólo su tenant | Sí | No | No | No |
| Owner/admin de plataforma | Sí | Sí | Sí | Sí | Sí |
| Sales | Sí, datos sanitizados | No salvo que además sea owner del tenant | No | No | No |
| Support | Sí, datos sanitizados | No | No | No | No |
| Readonly | Sí, datos sanitizados | No | No | No | No |
| Automation | Sólo por backend `service_role` | Sólo por backend | Sólo por backend | Sólo por backend | Sólo por backend |
| Usuario sin membresía | No | No | No | No | No |

Los RPCs sensibles no procesan pagos ni llaman proveedores. El checkout mantiene idempotencia y la API Edge sigue resolviendo exclusivamente el tenant owner de la sesión. `get_billing_portal` oculta pagos, comprobantes, historial y email de billing para roles comerciales.
