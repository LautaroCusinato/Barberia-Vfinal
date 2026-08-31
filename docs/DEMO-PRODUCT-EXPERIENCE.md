# Demo de producto Austral

## Propósito

`/demo` es la experiencia comercial de Austral. Abre el mismo workspace que usa un negocio real, sin login y sin conectar Supabase, billing, WhatsApp, n8n, Evolution ni Mercado Pago.

## Arquitectura y aislamiento

- `DemoWorkspace` monta `App` con `demoMode=true`; no existe una segunda copia de Agenda, Clientes, Operación o Configuración.
- `src/lib/demoStore.js` funciona como adapter local: genera un dataset ficticio coherente y persiste sólo el snapshot de esa sesión en `localStorage`.
- `demo_session_id` es un UUID generado por el navegador. Es un identificador de almacenamiento, no una credencial ni un parámetro de autorización para APIs.
- Cada navegador/perfil obtiene una sesión independiente. Las mutaciones de la demo actualizan únicamente ese snapshot local.
- En demo, `isSupabaseConfigured` se fuerza a `false` dentro del workspace y se bloquean las ramas de escritura, realtime, billing y envío de mensajes.

## Dataset y fechas

La semilla es `Barbería Demo Austral`, con Mateo, Lucas y Tomás, seis servicios, 25 clientes ficticios, turnos históricos y próximos, notas, conversaciones, breaks y bloqueos. Los teléfonos usan números sintéticos y los datos no representan clientes reales.

Las fechas se generan relativas al día actual (histórico, hoy y próximos días); no hay fechas fijas en la semilla.

## Persistencia, TTL y reset

- El `demo_session_id` y su snapshot tienen un TTL de 8 horas; el snapshot se conserva durante ese período desde la última escritura y una sesión vencida recibe un identificador nuevo.
- Un refresh mantiene los cambios del visitante mientras el TTL siga vigente.
- `Reiniciar demo` requiere confirmación, elimina snapshot y configuración de branding de esa sesión y vuelve al resumen con la semilla original.
- Al expirar el TTL se crea una sesión limpia automáticamente.

## Superficies disponibles

La demo permite explorar y modificar temporalmente:

- Resumen y estadísticas derivadas del dataset.
- Agenda: navegación, alta, edición, estados, cancelación y notas de turnos.
- Clientes: búsqueda, alta, edición y ficha/historial ficticio.
- Servicios y equipo: precios, duración, especialidades y horarios demo.
- Mensajes y notas: conversaciones simuladas y notas locales.
- Configuración: nombre, branding, colores y preferencias de reservas.
- Facturación: catálogo informativo Starter ARS 30.000/mes, 15 días de prueba y continuidad manual por WhatsApp; no hay checkout.

La reserva pública demo queda fuera de este corte: `/demo` mantiene el panel operativo real como superficie comercial principal y no abre un flujo de reserva adicional que pueda confundirse con una reserva pública real.

## Integraciones bloqueadas

- WhatsApp muestra que está disponible al crear una cuenta y deriva a Facturación; no activa bot ni integración.
- Mercado Pago, PayPal, billing API y checkout no se invocan.
- No se envían mensajes, no se crean reservas productivas y no se modifican clientes reales.
- `/plataforma` no abre un workspace autenticado desde la demo.
- Colaboradores y carga de logo quedan explicados como funciones de la cuenta real; no generan invitaciones ni suben archivos.

## UX y accesibilidad

Se reutilizan el shell, Sidebar, bottom navigation, tokens, focus visible, modales y dark mode del producto. La barra de demo es compacta, responsive y siempre identifica que los cambios son temporales.
En mobile, las acciones de estado de Agenda se envuelven dentro de la tarjeta para conservar targets táctiles y evitar clipping a 390 px.

## Validación

La suite `e2e/demo.spec.mjs` cubre DEMO-01 a DEMO-21: entrada sin login, panel real, datos actuales, CRUD demo, persistencia, reset, billing/WhatsApp/plataforma bloqueados, ausencia de mutaciones Supabase, mobile, dark mode, CTA e aislamiento entre dos sesiones.

La demo no reemplaza una cuenta QA autenticada: sus datos son deliberadamente locales y no prueban RLS, RPC ni proveedores externos.
