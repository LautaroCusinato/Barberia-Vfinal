# UI Sprint 4 · Gestión interna del negocio

Sprint 4 rediseña únicamente la capa visual de Clientes, Operación (Servicios y Horarios), Equipo y Configuración del negocio. Se aplicaron explícitamente los guardrails de **Austral SaaS Architecture** y **Austral Design System**: aislamiento por tenant, contratos y permisos intactos; tokens semánticos, mobile-first, dark mode, foco visible y reduced motion.

## Alcance y decisiones UX

- **Clientes:** la tabla mantiene el mismo orden, búsqueda, ficha, notas y acciones, pero en pantallas de hasta 640 px cada fila se convierte en una tarjeta legible. El teléfono conserva `formatTelefonoDisplay`; sólo se agregó la etiqueta accesible y no se cambió el valor enviado a Supabase.
- **Servicios:** cada servicio se presenta como una tarjeta de edición con jerarquía de nombre, descripción, precio y duración. Los controles de agregar y eliminar mantienen los callbacks existentes.
- **Empleados y horarios:** las métricas del equipo, avatar, especialidades, días laborables y rango horario tienen una jerarquía común. El bloque Pausa / Break usa una superficie ámbar y campos Desde/Hasta para que no se confunda con una reserva. La validación y serialización de horarios no se modificaron.
- **Configuración:** la pantalla conserva las categorías existentes (identidad/contacto, marca, región/reservas, colaboradores y actividad) y recibe una composición más calmada, acciones sticky en desktop y controles táctiles en mobile.
- **Producto común:** se reutilizan `src/index.css` y las primitives/tokens de `src/components/ui/`; `management.css` agrega sólo estilos scoped. No se agregaron dependencias ni lógica paralela.

## Componentes y estilos reutilizados

- Design tokens: `--surface`, `--border`, `--accent`, escalas `--space-*`, `--control-*`, radios, sombras, focus visible, `--safe-bottom` y dark mode.
- Primitives existentes: botones, campos, badges, paneles, estados vacíos y skeletons; las pantallas existentes conservan sus callbacks, estados y modales.
- Nueva capa visual: `src/components/management.css`, importada después de `index.css` y `agenda.css` para aislar los overrides de gestión.

## Problemas de la auditoría resueltos

- Tabla de Clientes difícil de leer en móvil → tarjetas por fila, etiquetas de campo y acciones táctiles.
- Operación demasiado densa → cards, jerarquía de metadatos, acciones rápidas y paneles responsivos.
- Pausas ambiguas → bloque visual diferenciado, contraste ámbar y agrupación Desde/Hasta sin modificar la regla de negocio.
- Equipo con jerarquía débil → KPI, avatar, estado visual, disponibilidad y detalle con el mismo lenguaje.
- Configuración extensa → categorías visuales, superficie de guardado sticky y safe-area.
- Contraste y focus inconsistentes → tokens semánticos, focus de 3 px, estados dark y reduced motion.
- Overflow horizontal en la grilla de Equipo móvil → columnas de una sola tarjeta hasta 640 px y `min-width: 0` en contenedores.

## Evidencia visual

Las capturas generadas con Playwright están en [docs/ui-sprint4/](./ui-sprint4/). La matriz cubre desktop (1440), tablet (834), mobile (390), light y dark para las cuatro pantallas. El baseline de auditoría y las comparaciones anteriores se conservan en [UI-UX-AUDITORIA.md](./UI-UX-AUDITORIA.md), [ui-sprint2](./ui-sprint2/) y [ui-sprint3](./ui-sprint3/); no se reemplazaron esas evidencias.

| Pantalla | Desktop light/dark | Tablet light | Mobile light/dark |
| --- | --- | --- | --- |
| Clientes | [light](./ui-sprint4/after-pacientes-desktop-light.png) · [dark](./ui-sprint4/after-pacientes-desktop-dark.png) | [captura](./ui-sprint4/after-pacientes-tablet-light.png) | [light](./ui-sprint4/after-pacientes-mobile-light.png) · [dark](./ui-sprint4/after-pacientes-mobile-dark.png) |
| Operación | [light](./ui-sprint4/after-operacion-desktop-light.png) · [dark](./ui-sprint4/after-operacion-desktop-dark.png) | [captura](./ui-sprint4/after-operacion-tablet-light.png) | [light](./ui-sprint4/after-operacion-mobile-light.png) · [dark](./ui-sprint4/after-operacion-mobile-dark.png) |
| Equipo | [light](./ui-sprint4/after-equipo-desktop-light.png) · [dark](./ui-sprint4/after-equipo-desktop-dark.png) | [captura](./ui-sprint4/after-equipo-tablet-light.png) | [light](./ui-sprint4/after-equipo-mobile-light.png) · [dark](./ui-sprint4/after-equipo-mobile-dark.png) |
| Configuración | [light](./ui-sprint4/after-configuracion-desktop-light.png) · [dark](./ui-sprint4/after-configuracion-desktop-dark.png) | [captura](./ui-sprint4/after-configuracion-tablet-light.png) | [light](./ui-sprint4/after-configuracion-mobile-light.png) · [dark](./ui-sprint4/after-configuracion-mobile-dark.png) |

## Verificación

- `npm.cmd run lint` — OK.
- `npm.cmd test` — OK; pasan las verificaciones estáticas de Agenda, SaaS, onboarding, billing, serverless, comercial, CRM y piloto.
- `npm.cmd run build` — OK; Vite produjo el bundle de producción.
- `git diff --check` — OK.
- Playwright manual con servidor mock aislado — OK en 20 combinaciones de pantalla/tema (4 pantallas × 5 perfiles). En cada navegación se comprobó heading esperado, `documentElement.scrollWidth`, `body.scrollWidth` y consola/page errors. Resultado: cero overflow y cero errores.

La prueba usa datos ficticios del modo demo; no escribe en Supabase ni crea reservas, clientes, empleados o servicios reales. No se modificaron Supabase, RPC, RLS, backend, billing, Mercado Pago, WhatsApp, Evolution, CRM, Landing ni Plataforma.

## Pendiente para Sprint 5

- Auditoría visual del próximo módulo autorizado (por ejemplo CRM o Plataforma) sólo con autorización explícita.
- Paginación/virtualización si el volumen real de clientes o servicios lo requiere; queda fuera de este sprint porque cambiaría comportamiento y contratos.
- Pruebas autenticadas contra un tenant real en un entorno controlado, sin cambiar producción.

Sprint 4 queda detenido aquí, tal como fue solicitado.
