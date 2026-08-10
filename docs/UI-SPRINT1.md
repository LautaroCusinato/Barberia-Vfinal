# Sprint 1 — Design System y hardening visual

Fecha: 2026-08-09  
Base: [`docs/UI-UX-AUDITORIA.md`](./UI-UX-AUDITORIA.md)

## Alcance

Se implementó únicamente el Sprint 1 del roadmap: foundations del Austral Design System y correcciones críticas/altas de infraestructura visual compartida. Se preservó el comportamiento funcional existente.

No se modificaron Booking, Agenda, CRM, Landing ni Plataforma como pantallas completas. Tampoco se tocaron lógica de negocio, autenticación, contratos, multi-tenant, Supabase, RLS, RPC, billing, Mercado Pago, Edge Functions, n8n o Evolution.

## Cambios realizados

### Foundations

- Tokens semánticos para espaciado (escala de 4 px), controles, radios, movimiento, overlay, capas y safe areas.
- Variables light/dark y `color-scheme` para que controles nativos respeten el tema activo.
- Focus visible global, `prefers-reduced-motion` y overflow horizontal acotado en la raíz.
- Breakpoints conservados y reglas compartidas para layouts compactos.

### Primitives reutilizables

Se creó `src/components/ui/index.jsx` y su stylesheet `src/components/ui/ui.css` con:

`Button`, `IconButton`, `Input`, `PasswordField`, `PhoneField`, `Select`, `Textarea`, `Checkbox`, `Switch`, `Badge`, `StatusBadge`, `Card`, `Panel`, `Modal`, `Sheet`, `EmptyState`, `Skeleton`, `Spinner`, `PageHeader`, `SectionHeader`, `FormField`, `Toast` y `Tooltip`.

También se incorporó `FocusTrap`, usado por el sheet móvil existente, con foco inicial, navegación circular por Tab/Shift+Tab, Escape y retorno al elemento que abrió el overlay.

### Correcciones críticas/altas

- Selector de workspace: el contenedor ahora usa una tarjeta fluida (`width: min(100%, 380px)`, `min-width: 0`) y acciones apiladas, evitando el recorte observado a 390 px.
- Menú móvil: el sheet “Más secciones” tiene semántica de diálogo, cierre por backdrop/Escape, focus trap y focus-visible.
- Tabbar móvil: incorpora `safe-area-inset-bottom`, altura táctil mínima y padding equivalente en el contenido principal.
- Overflow: el root y los estados centrados limitan desbordes horizontales sin alterar el scroll vertical de tablas o paneles existentes.
- Teléfono público: el mensaje de validación explica el formato completo esperado, alineado con `PhoneField` y la validación canónica existente.
- Estados compartidos: se dejaron disponibles primitives consistentes de skeleton, spinner, empty, error, toast y headers para adopción gradual sin cambiar flujos actuales.
- Estilos duplicados del selector de workspace: se movieron layouts repetidos desde inline styles a clases compartidas, sin cambiar sus acciones ni rutas.

## Verificación

Ejecutados sobre el proyecto:

- `npm.cmd run lint` — OK.
- `npm.cmd test` — OK; verificaciones de agenda, SaaS, onboarding, billing, serverless, preparación comercial, CRM y piloto comercial pasan.
- `npm.cmd run build` — OK; build de Vite completado.
- Playwright/browser: se verificaron rutas públicas y el shell responsive en desktop, tablet y mobile, en light y dark, comprobando `scrollWidth` contra `innerWidth`, foco visible y ausencia de errores de consola en los estados accesibles. El sheet autenticado se validó con focus trap/Escape/retorno de foco cuando la sesión disponible estuvo presente; si el entorno no entrega sesión, esa comprobación debe repetirse en CI autenticado.

## Componentes unificados y decisiones

- Se estableció una capa `ui/` sin reemplazar masivamente `.btn`, `.panel`, `.phone-field` ni componentes de dominio existentes; esto evita regresiones y permite migración gradual.
- `PhoneField` se reexporta desde la implementación existente para mantener exactamente su formato y contrato.
- `Modal` y `Sheet` comparten overlay, tokens, foco y safe area.
- Los estilos nuevos consumen las variables semánticas actuales y respetan `data-theme="dark"`.

## Pendiente para Sprint 2

- Booking guiado: stepper, resumen persistente, estados live de disponibilidad, zona horaria y moneda con código.
- Agenda/operación mobile-first: presentación explícita de breaks desde/hasta y motivos de indisponibilidad.
- CRM/plataforma: tablas adaptativas a tarjetas y reducción de densidad móvil.
- Landing/onboarding: navegación móvil, dark mode completo y pricing localizado.
- Migración gradual de formularios y botones de dominio a las primitives, sólo después de pruebas visuales por ruta.

## Integridad del sistema

No hay migraciones ni cambios de base de datos. No se modificaron secretos, proveedores, pagos, workflows ni producción. Sprint 2 no debe comenzar sin autorización explícita.
