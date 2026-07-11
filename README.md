# Panel Barberia Central

Dashboard para administrar turnos, clientes, conversaciones de WhatsApp, notas internas y metricas de una barberia. Esta basado en el panel dental original, pero adaptado a servicios como corte clasico, barba, fade, color y peinados.

## Ejecutar

```bash
npm install
npm run dev
```

## Supabase

1. Crear un proyecto nuevo en Supabase.
2. Ejecutar `supabase-schema.sql` en el SQL editor.
3. Copiar `.env.example` a `.env`.
4. Completar:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_ADMIN_USER=admin
VITE_ADMIN_PASS=barberia2026
```

Si no configuras Supabase, el panel abre igual con datos de ejemplo.

## Esquema actual

El archivo `supabase-schema.sql` ya prepara:

- `barberias`
- `profiles`
- `barberia_members`
- `servicios`
- `barberos`
- `clientes`
- `turnos`
- `mensajes`
- `notas`
- `config`
- `horarios_barbero`
- `bloqueos_agenda`

Ese esquema ya incluye `barberia_id`, Auth y RLS para un uso multi-barberia real. El frontend demo todavia usa algunos nombres heredados como `paciente`, por eso la siguiente etapa es alinear el panel con el esquema final y el login de Supabase.

## WhatsApp / n8n

El dashboard no envia WhatsApp por si solo. Para integrarlo:

- Cuando llega un mensaje del cliente, insertar en `mensajes` con `de = 'paciente'`.
- Cuando el bot responde, insertar en `mensajes` con `de = 'bot'`.
- Cuando el bot agenda, insertar en `turnos` y crear/actualizar `clientes`.
- Cuando el panel envia una respuesta manual, queda en `mensajes` con `de = 'clinica'`; n8n puede leer esas filas y mandarlas por tu proveedor de WhatsApp.

## Login demo

El login es local, pensado para demo o uso simple:

- Usuario: `admin`
- Contrasena: `barberia2026`

Para produccion conviene pasar a Supabase Auth y politicas RLS cerradas.
