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
- El estado de suscripción todavía no se aplica a RLS. Eso se hará después de probar onboarding y período de gracia para no bloquear la cuenta existente.

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

La migración `20260806060000_saas_foundation.sql` agrega metadatos de tenant, planes, suscripciones, usuarios internos, registro de integraciones y CRM. Es aditiva y todavía no se aplicó al proyecto remoto.

## Prueba gratuita de 14 días

1. Al crear un negocio se inserta una suscripción `trialing` con `trial_ends_at = now() + 14 days`.
2. Durante el trial se habilitan agenda, clientes, reservas públicas y una integración inicial.
3. En el día 10 se muestra aviso y se crea una tarea de seguimiento en CRM.
4. Al vencer, la cuenta pasa a `past_due` o `expired`, conserva lectura/exportación y bloquea nuevas reservas después de un período de gracia configurable.
5. Un webhook de pagos actualiza la suscripción de forma idempotente usando un identificador de evento en la siguiente migración de billing.

No se abrirán cuentas de pago ni se cobrarán fondos automáticamente sin autorización explícita.

## Activación y suspensión por pago

Estados previstos: `trialing`, `active`, `past_due`, `paused`, `canceled` y `expired`. La función `barberia_access_state()` ya centraliza la lectura del estado. En la siguiente etapa se incorporará a las políticas de lectura/escritura con una excepción de propietario para exportar datos y resolver facturación.

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

## Etapas siguientes

1. Aplicar y verificar la migración SaaS en Supabase; crear el primer `platform_member`.
2. Crear onboarding de negocio, selección de vertical, branding y usuarios.
3. Cambiar n8n a un contrato multi-tenant con `tenant_slug`/`barberia_id` resuelto desde webhook y configuración.
4. Implementar billing con proveedor elegido, eventos idempotentes y enforcement de acceso.
5. Construir CRM operativo y agentes en modo borrador/aprobación.
6. Agregar dominios/subdominios por tenant, presets de vertical y métricas comerciales.

