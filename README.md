# Barbería Central — Panel de Gestión Profesional

Dashboard completo para administrar turnos, clientes, barberos, conversaciones de WhatsApp, notas internas y métricas de una barbería. Diseñado para ser usado tanto en escritorio como en dispositivos móviles.

## ✨ Características

- **Agenda diaria** con vista de turnos, filtro por barbero y estados (confirmado, atendido, no asistió)
- **Calendario** con vista mensual y semanal, con disponibilidad por barbero
- **Gestión de clientes** con ficha completa, historial de turnos y notas
- **Mensajería** integrada con WhatsApp (vía n8n) con bot automático
- **Estadísticas** con métricas de rendimiento, ingresos por barbero y tendencias
- **Configuración** de servicios, precios, horarios y barberos
- **Modo oscuro/claro** con persistencia
- **Diseño responsive** adaptado a mobile, tablet y desktop
- **Tema cálido** con paleta de colores artesanal para barberías

## 🚀 Inicio rápido

```bash
npm install
npm run dev
```

Abrir en el navegador: `http://localhost:5173`

El panel usa Supabase Auth. No hay credenciales administrativas hardcodeadas en
el frontend; cada usuario debe existir en `auth.users` y estar vinculado a una
fila de `barberia_members`.

## 🗄️ Supabase (opcional)

Sin configurar Supabase, el panel funciona igual con datos de ejemplo. Para activar la persistencia real:

1. Crear un proyecto en [Supabase](https://supabase.com)
2. Ejecutar `supabase-schema.sql` en el SQL Editor y luego aplicar, en orden
   alfabético, todos los archivos de `supabase/migrations/`. El esquema base
   contiene las tablas y políticas; las migraciones agregan reserva pública,
   reglas transaccionales de agenda y normalización de teléfonos.
3. Copiar `.env.example` a `.env` y completar:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-publica
VITE_BARBERIA_ID=1
VITE_BUSINESS_NAME=Barbería Central
VITE_BUSINESS_VERTICAL=barberia
VITE_PRODUCT_NAME=Agenda
```

La `anon key` de Supabase está diseñada para estar en el cliente y siempre debe
estar protegida por RLS y RPCs seguros. Nunca agregues una `service_role key` ni
secretos de Evolution API a variables `VITE_*`.

## ☁️ Despliegue en Cloudflare Pages

Configuración recomendada:

- **Framework preset:** Vite
- **Build command:** `npm run build`
- **Output directory:** `dist`
- **Node version:** 22 (el repositorio incluye `.nvmrc`)

Variables para Preview y Production:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-publica
VITE_BARBERIA_ID=1
```

El archivo `public/_redirects` mantiene funcionando las rutas de la SPA al
recargar, incluyendo `/reservar/barberia-central`.

Para vincular GitHub: en Cloudflare Pages elegí **Create application → Pages →
Connect to Git**, seleccioná el repositorio y configurá las variables anteriores.
No subas `.env`; está excluido por `.gitignore`.

## 🧱 Base SaaS multi-tenant

La arquitectura SaaS y el diagnóstico de acoplamientos están documentados en
[`docs/SAAS_FOUNDATION.md`](docs/SAAS_FOUNDATION.md). La migración
`20260806060000_saas_foundation.sql` prepara metadatos de tenant, planes,
prueba gratuita, suscripciones, integraciones y CRM. Es aditiva y debe
revisarse antes de aplicarla en Supabase.

El frontend usa `src/lib/tenant.js` para resolver el contexto de tenant,
branding básico y etiquetas por vertical. El nombre físico `barberia_id` se
mantiene por compatibilidad con los datos y las políticas RLS actuales.

## ✅ Verificaciones locales

```bash
npm install
npm run lint
npm test
npm run build
npm run preview
```

## 📱 Integración WhatsApp / n8n

El panel no envía mensajes por sí mismo. Para conectarlo con WhatsApp:

1. **n8n** recibe el webhook de WhatsApp
2. Inserta el mensaje del cliente en `mensajes` con `de = 'paciente'`
3. El bot responde automáticamente o el dueño responde desde el panel
4. Las respuestas del panel se guardan con `de = 'clinica'`
5. n8n lee esas filas y las envía por WhatsApp

El workflow versionado en `integrations/` no contiene claves reales: configurá la
credencial de Supabase, DeepSeek y Evolution API dentro de n8n antes de activarlo.
Las respuestas manuales del panel pasan por la edge function
`whatsapp-panel-send`: valida la sesión y la membresía del usuario, toma el
teléfono de la ficha del cliente y reenvía a n8n con el header
`X-Austral-Panel-Secret`. Para activarla:

```bash
supabase secrets set WHATSAPP_PANEL_SEND_WEBHOOK_URL=https://tu-n8n.example.com/webhook/panel-enviar-wsp WHATSAPP_PANEL_SEND_SECRET=<secreto-largo>
supabase functions deploy whatsapp-panel-send
```

En n8n, el nodo webhook `panel-enviar-wsp` debe usar *Header Auth* con ese
mismo header y secreto, para que nadie pueda llamarlo directamente. La base de
datos mantiene la validación final de horarios, duración, bloqueos y
superposiciones aunque un mensaje de WhatsApp intente enviar datos inválidos.

## 🏗️ Estructura del proyecto

```
src/
├── main.jsx            # Rutas (landing, /reservar, /registro, /demo, /plataforma…) y resolución de sesión/tenant
├── App.jsx             # Panel del negocio: estado, carga de datos, realtime y vistas
├── components/         # Agenda, calendario, clientes, mensajes, notas, estadísticas, operación, modales
│   ├── ui/             # Componentes base (Button, Card, FormField, FocusTrap…)
│   └── billing/        # Formulario de tarjeta de Mercado Pago
├── pages/              # Reserva pública, landing, registro, onboarding, facturación, CRM de plataforma
├── lib/                # Supabase, tenant, texto/horarios/teléfonos, CSV, observabilidad, demo
├── data/               # Datos de ejemplo y plantillas comerciales
└── utils/              # Presentación de estados de WhatsApp

supabase/
├── migrations/         # Esquema incremental (aplicar en orden)
└── functions/          # Edge functions: billing-*, whatsapp-* y _shared/

scripts/                # Verificaciones (npm test), QA, diagnósticos y operación
e2e/                    # Playwright: público, demo y QA autenticado
integrations/           # Workflows de n8n versionados (sin credenciales)
docs/                   # Runbooks, contratos y auditorías
```

## 🔧 Tecnologías

- **React 18** con Vite 8
- **Supabase** (autenticación, base de datos, realtime)
- **date-fns** para manejo de fechas
- **lucide-react** para iconografía
- **CSS puro** con variables y temas light/dark

## 📄 Licencia

Uso interno — Austral Automatizaciones.
