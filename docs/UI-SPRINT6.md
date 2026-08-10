# UI Sprint 6 · Landing, marketing y conversión

## Alcance

Se implementó únicamente Sprint 6: una landing pública comercial para Austral Automatizaciones y sus páginas `/para/:vertical`. La operación interna, la autenticación y todos los contratos de datos permanecen sin cambios.

La implementación aplica **Austral SaaS Architecture** (sin cambios de Supabase, RLS, RPC, billing, Edge Functions, WhatsApp, n8n, Evolution, auth o multi-tenant) y **Austral Design System** (tokens semánticos, estados, foco visible, responsive, dark mode y reduced motion).

## Qué cambió

- Se reemplazó la landing anterior por un recorrido comercial completo y concreto:
  - Hero con propuesta de valor, CTA principal y CTA secundario.
  - Visual interactivo de Agenda, Reserva pública, Gestión y CRM.
  - Problema → solución, funciones agrupadas y flujo de WhatsApp.
  - Cómo funciona en cuatro pasos.
  - Historias visuales de Reserva, Agenda, Gestión y CRM.
  - Planes, FAQ, CTA final y footer.
- La navegación pública ahora incluye menú responsive, acceso a Ingresar, Demo aislada y Registro.
- La landing reutiliza las interfaces existentes como representaciones visuales. No muestra métricas, testimonios, clientes, porcentajes ni resultados inventados.
- Se agregó `src/components/landing.css`, scoped a `.marketing-page`, para aislar el marketing del panel operativo.
- Se retiraron los estilos `landing-*` antiguos que ya no tenían referencias.
- Los planes se siguen cargando con `get_public_saas_catalog`; el fallback existente solo opera cuando el catálogo público no está disponible. La moneda, importe, periodicidad y trial se presentan desde el dato recibido.
- Se amplió el sitemap con las verticales ya soportadas por la arquitectura (`veterinaria`, `gimnasio`, `clinica`, `taller`).
- Se actualizan title, description, canonical, Open Graph y Twitter Cards según la vertical visible.

## Copy principal

Para Barbería la propuesta principal es: **“Turnos, equipo y clientes en un solo lugar.”**

El subtítulo explica el alcance real: reservas online, agenda, clientes, empleados, servicios y horarios conectados. El CTA primario es **“Probar gratis 14 días”** y el secundario **“Ver cómo funciona”**.

En otras verticales se reutiliza la misma arquitectura y se adapta el título a la vertical normalizada, sin duplicar páginas ni lógica.

## WhatsApp

Se presenta como un flujo visual conceptual: Cliente → WhatsApp → Disponibilidad → Reserva → Agenda. El copy aclara que la conexión requiere configuración adicional y que la landing no activa automatizaciones productivas. No se prometen capacidades que estén únicamente en piloto/shadow.

## Producto mostrado

- **Agenda:** turnos, profesionales, breaks y disponibilidad.
- **Reserva pública:** servicio, profesional, fecha, hora y confirmación.
- **Gestión:** clientes, servicios, horarios y configuración.
- **CRM:** pipeline y seguimientos de la plataforma.

Todas las composiciones indican que son representaciones visuales basadas en interfaces existentes y utilizan datos ilustrativos.

## Responsive, tema y accesibilidad

- Viewports verificados: 360×800, 390×844, 768×1024, 1366×768 y 1920×1080.
- Menú móvil operable, controles táctiles, layout sin overflow horizontal y CTA visibles.
- Light mode, dark mode y preferencia del sistema; el tema público se guarda de forma local sin afectar el workspace autenticado.
- `:focus-visible`, roles de tab para el visual de producto, labels de navegación, semántica de headings, estados de acordeón nativos y `prefers-reduced-motion`.
- Safe-area y espaciado móvil se apoyan en los tokens globales existentes.

## SEO

Se preservó la estructura pública y se mejoró la metadata estática de `index.html`. `Landing` actualiza title, description, canonical, Open Graph y Twitter Cards para `/` y `/para/:vertical`. Se mantiene JSON-LD básico de `SoftwareApplication` sin métricas ni claims externos.

## Performance y Lighthouse

No se inició el Sprint global de performance. La landing no agrega librerías nuevas: reutiliza `lucide-react`, CSS scoped y composiciones CSS/HTML. Las pruebas locales no registraron errores de consola ni overflow. Lighthouse CLI no está instalado en este entorno, por lo que no se reporta un score inventado; queda como verificación de despliegue.

## Evidencia

Las capturas están en [docs/ui-sprint6/](ui-sprint6/). El conjunto incluye baseline antes del cambio y evidencia posterior de Hero desktop/mobile, producto, WhatsApp, pricing, FAQ, dark mode y la vertical Barbería. La evidencia posterior se tomó contra un servidor local, con datos ilustrativos y sin escribir en Supabase.

## Verificaciones

Resultado de la pasada final antes del commit:

```text
npm run lint
npm test
npm run build
npm run test:e2e
git diff --check
node scripts/scan-secrets.mjs
```

Resultado: `lint` OK, `npm test` OK, `build` OK, `git diff --check` OK, escaneo de secretos OK y Playwright `48 passed / 144 skipped` (los skips corresponden a flujos reales que requieren credenciales Supabase sandbox). La landing, navegación, CTA, FAQ, recarga directa, reservas mock y overflow se verificaron en los viewports configurados.

## Commits y despliegue

El cambio se separará en un commit de implementación y otro de documentación/evidencia. Se hará push normal a `main` únicamente después de que todas las verificaciones pasen. Cloudflare Pages se comprobará después del push sin modificar DNS.

## Pendientes reales

- Ejecutar Lighthouse en un entorno que tenga el CLI o integración disponible.
- Confirmar el deployment de Cloudflare Pages posterior al push.
- Product Polish y optimización global de performance quedan fuera de Sprint 6.

Sprint 7 no fue iniciado.
