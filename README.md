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

### Login demo

- Usuario: `admin`
- Contraseña: `barberia2026`

## 🗄️ Supabase (opcional)

Sin configurar Supabase, el panel funciona igual con datos de ejemplo. Para activar la persistencia real:

1. Crear un proyecto en [Supabase](https://supabase.com)
2. Ejecutar el contenido de `supabase-schema.sql` en el SQL Editor
3. Copiar `.env.example` a `.env` y completar:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-publica
VITE_BARBERIA_ID=1
VITE_ADMIN_USER=admin
VITE_ADMIN_PASS=barberia2026
```

## 📱 Integración WhatsApp / n8n

El panel no envía mensajes por sí mismo. Para conectarlo con WhatsApp:

1. **n8n** recibe el webhook de WhatsApp
2. Inserta el mensaje del cliente en `mensajes` con `de = 'paciente'`
3. El bot responde automáticamente o el dueño responde desde el panel
4. Las respuestas del panel se guardan con `de = 'clinica'`
5. n8n lee esas filas y las envía por WhatsApp

## 🏗️ Estructura del proyecto

```
src/
├── App.jsx                   # Estado global y lógica principal
├── main.jsx                  # Punto de entrada con login
├── index.css                 # Estilos completos (light/dark)
├── components/
│   ├── Sidebar.jsx           # Navegación lateral + mobile tab bar
│   ├── Login.jsx             # Pantalla de inicio de sesión
│   ├── StatsCards.jsx        # Tarjetas de resumen
│   ├── Agenda.jsx            # Lista de turnos del día
│   ├── TurnoRow.jsx          # Fila de turno individual
│   ├── StatusSelect.jsx      # Selector de estado visual
│   ├── Calendar.jsx          # Calendario mensual/semanal
│   ├── NewTurnoModal.jsx     # Modal para crear/editar turnos
│   ├── Barberos.jsx          # Vista de equipo/barberos
│   ├── Messages.jsx          # Panel de mensajería
│   ├── Patients.jsx          # Lista de clientes
│   ├── PatientDetailModal.jsx # Ficha de cliente
│   ├── EditPatientModal.jsx  # Editar cliente
│   ├── Notes.jsx             # Notas internas
│   ├── Stats.jsx             # Estadísticas detalladas
│   └── Operations.jsx        # Configuración de servicios/barberos
├── lib/
│   ├── supabaseClient.js     # Conexión a Supabase
│   ├── avatar.js             # Generación de avatares
│   ├── csv.js                # Exportación CSV
│   └── text.js               # Utilidades de texto y horarios
└── data/
    └── mockData.js           # Datos de ejemplo
```

## 🔧 Tecnologías

- **React 18** con Vite 5
- **Supabase** (autenticación, base de datos, realtime)
- **date-fns** para manejo de fechas
- **lucide-react** para iconografía
- **CSS puro** con variables y temas light/dark

## 📄 Licencia

Uso interno — demo para presentación comercial.
