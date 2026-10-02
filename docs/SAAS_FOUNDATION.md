# Base SaaS: diagnóstico y arquitectura

## Diagnóstico del estado actual

### Fortalezas

- El esquema ya tiene una frontera de tenant consistente: `barberia_id` aparece en clientes, turnos, servicios, profesionales, mensajes, notas, pagos, horarios y bloqueos.
- `barberia_members` permite que un usuario pertenezca a uno o varios negocios y define roles por negocio.
- Las políticas RLS usan membresía y rol; el panel no depende de una `service_role key`.
- La reserva pública usa `slug` y RPCs transaccionales, por lo que se puede publicar un enlace por negocio sin exponer tablas internas.
- La restricción de no superposición y las reglas de agenda viven en PostgreSQL y son reutilizables por panel, WhatsApp y web.

### Riesgos y acoplamientos

- La nomenclatura física es específica del primer producto (`barberias`, `barberos`, `paciente`, `horario_texto`). No impide SaaS, pero debe quedar documentada como compatibilidad mientras la interfaz usa etiquetas de vertical.
- El frontend mantenía textos y claves como `Barberia Central`, `barberia-central` y `barberia-central-theme`, además de datos demo específicos.
- La configuración del tenant funcionaba en el panel por `barberiaId`, pero el modo sin Supabase y algunas claves de almacenamiento dependían del valor 1.
- El workflow de n8n filtra `barberia_id = 1`, usa la instancia `miwsp` y un prompt de “Barberia Central”. No es multi-tenant todavía.
- No existen planes, suscripciones, período de prueba, estado de cuenta, usuarios internos de plataforma ni CRM.
- `pagos` registra cobros de turnos; no representa pagos recurrentes ni eventos idempotentes de un proveedor.
- El estado de suscripción ya protege las reservas web y el RPC de reservas de WhatsApp; la escritura general del panel seguirá una política de billing separada para conservar exportación y soporte.

## Arquitectura objetivo

`barberias` continúa siendo la tabla física del tenant para no romper datos ni RLS. En la capa de dominio se la llama `tenant` y se accede mediante un contexto único:

```text
TenantContext
├── id / slug / dominio
├── vertical y etiquetas de interfaz
├── branding y zona horaria
├── miembros y roles
├── clientes / profesionales / servicios
├── horarios / bloqueos / reservas
├── configuración e integraciones
└── suscripción y estado de acceso
```

La aplicación se divide en cuatro capas:

1. **Núcleo de agenda**: disponibilidad, duración, bloqueos, reservas y clientes.
2. **Adaptadores de vertical**: etiquetas, campos opcionales y presets por rubro.
3. **Operación SaaS**: onboarding, planes, trial, billing, CRM y soporte.
4. **Canales**: panel web, reservas públicas, WhatsApp/n8n y futuras APIs.

La migración `20260806060000_saas_foundation.sql` agrega metadatos de tenant, planes, suscripciones, usuarios internos, registro de integraciones y CRM. Está aplicada al proyecto remoto `ssagttjdgtypxjcgdnrw`.

## Prueba gratuita de 15 días

1. Al crear un negocio se inserta una suscripción `trialing` con `trial_ends_at = now() + 15 days` para nuevas altas. La duración proviene de `saas_planes.trial_dias`; las fechas de trials existentes no se reescriben.
2. Durante el trial se habilitan agenda, clientes, reservas públicas y una integración inicial.
3. En el día 10 se muestra aviso y se crea una tarea de seguimiento en CRM.
4. Al vencer, `expire_saas_trials` (cuando lo invoca el job privado) pasa la cuenta de `trialing` a `expired`, sin período de gracia automático. Además, `barberia_access_state()` comprueba `trial_ends_at <= now()` en cada lectura para bloquear reservas y mutaciones aunque el scheduler esté atrasado. El propietario puede iniciar sesión, consultar Billing y contactar ventas; los datos se conservan intactos.
5. Un webhook de pagos actualiza la suscripción de forma idempotente usando un identificador de evento en la siguiente migración de billing.

No se abrirán cuentas de pago ni se cobrarán fondos automáticamente sin autorización explícita.

## Activación y suspensión por pago

Estados previstos: `trialing`, `active`, `past_due`, `grace_period`, `paused`, `canceled` y `expired`. `past_due`/`grace_period` siguen representando fallas de pago de suscripciones activas; `expired` identifica exclusivamente el trial comercial vencido y no se transforma en grace automáticamente. `barberia_access_state()` centraliza la lectura y mantiene habilitada la vista de Billing para el propietario sin reabrir la operación.

## CRM y agentes

El CRM separa negocio (`crm_negocios`), contacto (`crm_leads`) e interacción (`crm_interacciones`). Se registran país, idioma, canal, etapa, interés, precio ofrecido, próxima acción y resultado.

Los agentes propuestos son:

- **Research**: investiga negocios usando fuentes públicas y guarda evidencias.
- **Prospecting**: califica y prioriza leads, sin contactar automáticamente.
- **Copy**: prepara mensajes personalizados para revisión humana.
- **Inbox**: clasifica respuestas y detecta interés.
- **Trial**: prepara onboarding y tareas de prueba gratuita.
- **Support**: deriva conversaciones importantes al dueño.
- **Analytics**: mide conversiones, MRR, churn y costo por lead.

Todos los agentes deben escribir en CRM, usar claves idempotentes y pasar por una cola de aprobación antes de enviar mensajes externos.

## Integraciones

- **GitHub + Cloudflare Pages**: repositorio único versionado, build reproducible y variables por ambiente.
- **Supabase**: datos, Auth, RLS y RPCs de agenda.
- **n8n privado**: orquestación; las credenciales se guardan en n8n, no en el frontend.
- **DeepSeek**: clasificación, resumen y redacción con límites de costo y revisión humana.
- **Evolution API**: canal WhatsApp inicial; la instancia y el webhook deben resolverse por tenant, no estar hardcodeados.

## Estado de la etapa 2 (2026-08-06)

La migracion SaaS ya fue aplicada al proyecto remoto `ssagttjdgtypxjcgdnrw` y
el owner inicial fue verificado en `platform_members`. El workspace interno
del CRM esta disponible en `/plataforma`; el detalle operativo y el SQL
idempotente de administracion estan documentados en `docs/PLATFORM_ADMIN.md`.

## Etapas siguientes

1. Aplicar y verificar la migración SaaS en Supabase; crear el primer `platform_member`.
2. Crear onboarding de negocio, selección de vertical, branding y usuarios.
3. Pilotear el contrato multi-tenant de WhatsApp documentado en `docs/MULTITENANT_WHATSAPP_CONTRACT.md`, sin activar todavía el workflow de producción.
4. Implementar billing con eventos idempotentes y enforcement de acceso; la salida comercial vigente permanece manual por WhatsApp, con activación controlada desde plataforma.
5. Construir CRM operativo y agentes en modo borrador/aprobación.
6. Agregar dominios/subdominios por tenant, presets de vertical y métricas comerciales.
