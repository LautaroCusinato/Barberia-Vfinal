# Release notes · RC1

## Qué incluye

- Landing pública y vertical de barbería.
- Registro, recuperación de contraseña y onboarding self-service.
- Agenda, reservas públicas, clientes, servicios, empleados, horarios y configuración.
- Workspace de negocio y workspace de Plataforma con CRM, leads, negocios, métricas y billing.
- Aislamiento multi-tenant y roles verificados en el proyecto QA.
- Design System Austral aplicado a estados, responsive, dark mode, foco y cargas.
- Split de rutas y optimizaciones de sincronización documentadas en Sprint 8.

## Seguridad

- Suite QA completa: 192/192 escenarios Chromium.
- Tenant A/B aislados.
- Rutas protegidas, logout, recuperación y permisos por rol verificados.
- `service_role` no aparece en el bundle cliente.
- No se tocaron datos productivos ni proveedores externos.

## Billing

Billing queda en mock/sandbox para QA. No se habilita Mercado Pago real, PayPal ni cobros. La activación futura debe depender de webhook o verificación backend válida, nunca sólo de la URL de retorno.

## UX y performance

- Flujos públicos y autenticados verificados en 360, 390, 768, 1366 y 1920 px.
- Light/dark y reduced motion revisados en QA.
- Entry JS 217.00 kB (56.76 kB gzip) y CSS inicial 117.25 kB (20.74 kB gzip).
- No se agregaron dependencias de runtime.

## Limitaciones conocidas

- Firefox y WebKit no se probaron porque no están instalados en el entorno de auditoría.
- Lighthouse/axe automatizados quedan pendientes de un entorno con esas herramientas.
- Backups/PITR, monitoring, legal/comercial, billing real y WhatsApp productivo requieren aprobación manual.
- RC1 no autoriza prospección comercial ni activación de integraciones productivas.
