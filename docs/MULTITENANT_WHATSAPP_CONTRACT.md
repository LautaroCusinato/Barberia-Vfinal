# Contrato multi-tenant para WhatsApp

## Alcance

La integración nueva está preparada para n8n y Evolution API, pero permanece
inactiva. El workflow productivo de Barbería Central no fue editado, activado
ni eliminado.

## Inventario del workflow actual

Archivo auditado: `integrations/Barberia Central - Bot WhatsApp (Evolution + Deepseek) (5).json`.

| Valor fijo | Ubicación | Función | Riesgo | Reemplazo |
| --- | --- | --- | --- | --- |
| `barberia_id = 1` | filtros y campos de Supabase de clientes, mensajes, servicios, barberos y turnos | fuerza todas las lecturas/escrituras al demo | mezcla o pérdida de datos al agregar otro negocio | `tenant_id` derivado por `resolve_whatsapp_tenant_context` |
| `miwsp` | webhook `whatsapp-miwsp` y dos URLs `sendText` | ata recepción/envío a una instancia | un mensaje de otra instancia puede entrar al tenant equivocado | `external_instance_id` resuelto desde Supabase |
| número receptor | no hay un valor receptor confiable; se usa `remoteJid`/`telefono` del evento o panel | no distingue de forma segura el número conectado | no permite resolver una integración sólo por identidad del receptor | `receiver_number` normalizado y registrado, con la instancia como identidad primaria |
| `Barberia Central` | nombre del workflow y `systemMessage` del agente | personaliza el prompt | respuestas con marca incorrecta | `business_name`, `vertical`, `locale` del contexto |
| slug | no aparece en el workflow | no hay URL pública por tenant | no se puede construir un enlace correcto | `slug` y `booking_url` del contexto |
| idioma, zona horaria y moneda | no están configurados por tenant; el prompt está en español y el código usa la zona local del proceso | fechas y mensajes incorrectos al crecer | disponibilidad y copy inconsistentes | `locale`, `timezone` y `currency` del contexto |
| `PONE-ACA-TU-EVOLUTION-API-KEY` | headers de envío | placeholder de credencial | si se reemplaza en el JSON queda expuesto en Git | `EVOLUTION_API_KEY` en credenciales/variables privadas de n8n |
| `http://evolution_api:8080` | nodos de envío | URL interna fija | no sirve para otra instalación o entorno | `EVOLUTION_BASE_URL` privado de n8n |
| `deepseek-v4-flash` | nodo del modelo | modelo fijo | cambios de costo/capacidad requieren editar workflow | `ai_model` por integración, con fallback controlado |
| textos, reglas y calendario en español | `Armar contexto1` y `Agente Deepseek1` | prompt y lógica de agenda | no soporta idioma ni vertical por tenant | prompt modular con datos operativos bajo demanda |
| `horario_texto` y habilidades JSON | `Armar contexto1` | reconstruye reglas en JavaScript | divergencia con PostgreSQL, breaks incorrectos | RPCs/tablas centrales de agenda |
| referencias a nodos `Traer servicios1`, `Traer barberos1` | expresiones de creación de turno | acoplamiento a nombres de nodos | rompe al duplicar o versionar | plantilla con contexto resuelto y RPC de reserva |
| webhook `panel-enviar-wsp` | recepción de mensajes manuales | integración del panel | sigue enviando siempre por `miwsp` | endpoint por instancia resuelta; migración posterior |
| credenciales `Supabase account 2` y `DeepSeek account` | metadata de nodos | nombres de credenciales locales | no son portables entre entornos | referencias privadas de n8n, nunca secretos en Git |

El workflow original figura activo en el archivo auditado. No se lo tocó.

## Contrato de contexto

La RPC `public.resolve_whatsapp_tenant_context` recibe únicamente una
identidad de integración: `external_instance_id`, `receiver_number` o un
`integration_id` registrado. La instancia tiene prioridad. Una instancia o un
número desconocido devuelve cero filas; una identidad duplicada genera error.

El resultado es:

```json
{
  "integration_id": 12,
  "tenant_id": 1,
  "business_name": "Barbería Central",
  "vertical": "barberia",
  "slug": "barberia-central",
  "locale": "es-AR",
  "timezone": "America/Argentina/Buenos_Aires",
  "currency": "USD",
  "subscription_status": "active",
  "booking_enabled": true,
  "evolution_instance": "instancia-registrada",
  "receiver_number": "54911...",
  "ai_provider": "deepseek",
  "ai_model": "deepseek-chat",
  "booking_url": "/reservar/barberia-central",
  "integration_status": "conectado"
}
```

`tenant_id` es un alias de compatibilidad de `barberia_id`; no se duplicó la
columna para evitar divergencias. `provider` se representa físicamente como
`proveedor` por compatibilidad con el panel actual.

## Modelo y permisos

La migración `20260806150000_multitenant_whatsapp_contract.sql` agrega a
`saas_integraciones`:

- `integration_type`, `external_instance_id`, `receiver_number`;
- `credential_reference` (sólo identificador, nunca un token);
- `locale`, `timezone`, `ai_provider`, `ai_model`;
- `limits` y `last_verified_at`.

También agrega índices únicos para instancias y números Evolution y la tabla
`saas_automation_events`, aislada por `integration_id + event_id`.

Las RPC del contrato (`resolve_whatsapp_tenant_context`, `claim_whatsapp_event`,
`finish_whatsapp_event`, `cleanup_whatsapp_events` y
`crear_reserva_whatsapp`) tienen `search_path = public, pg_temp`, no son
ejecutables por `anon` ni `authenticated` y sólo se otorgan a `service_role`.
No exponen secretos ni permiten consultas de un tenant arbitrario.

## Idempotencia y reservas

`claim_whatsapp_event` reclama atómicamente un `event_id` estable de Evolution.
Un duplicado devuelve `acquired=false` y el workflow termina sin responder dos
veces. Se persisten `event_id`, `tenant_id`, `status`, `processed_at`,
`result_reference` y `expires_at`.

`crear_reserva_whatsapp` deriva el tenant desde la integración, valida la
suscripción, servicio, profesional, duración, horario, pausas, bloqueos,
solapamientos y formato telefónico. La reserva queda con origen `whatsapp`.
Un reintento de un evento completado devuelve el mismo turno en lugar de crear
otro.

La limpieza se prepara mediante `cleanup_whatsapp_events(1000)`. Debe
programarse desde n8n o pg_cron una vez por día, con retención acorde al
negocio.

## Plantilla n8n

Archivo: `integrations/templates/WhatsApp Multi Tenant - Contract Template.json`.

Está marcada `active: false` y no contiene credenciales reales. Incluye:

1. webhook Evolution;
2. extracción y validación de identidad;
3. resolución de tenant;
4. reclamación idempotente;
5. carga filtrada de servicios, empleados, horarios y bloqueos;
6. prompt modular y llamada a DeepSeek;
7. validación de intención y argumentos;
8. consulta de disponibilidad;
9. reserva centralizada;
10. respuesta por la instancia Evolution resuelta;
11. finalización y logging técnico sin tokens.

## Credenciales y variables privadas

Configurar únicamente en n8n, nunca en Git, `metadata` ni `VITE_*`:

- `SUPABASE_URL`;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `EVOLUTION_BASE_URL`;
- `EVOLUTION_API_KEY`;
- `EVOLUTION_WEBHOOK_SECRET` (compartido por el webhook o proxy);
- `DEEPSEEK_API_KEY`.

`credential_reference` sólo identifica qué credencial de n8n usar. La base no
guarda claves, prompts completos ni payloads sensibles.

## Rollout sin riesgo

1. **Shadow**: importar la plantilla sin activar y registrar sólo resoluciones.
2. **Simulación**: usar eventos ficticios y los casos de prueba de abajo.
3. **Piloto**: registrar una integración de Barbería Central como `pendiente`,
   luego `conectado`, sin cambiar el webhook productivo.
4. **Comparación**: cotejar disponibilidad, reservas y respuestas contra el
   workflow actual.
5. **Activación gradual**: cambiar una sola instancia durante una ventana de
   bajo tráfico.
6. **Rollback**: desactivar la plantilla y restaurar el webhook anterior; no
   se borra la tabla de eventos ni los turnos creados.

Barbería Nueva se incorpora creando otra fila de `saas_integraciones`, sin
duplicar workflow ni credenciales en el repositorio.

## Pruebas realizadas

- JSON de la plantilla parseado correctamente: 25 nodos, `active=false`, sin
  referencias de conexión inexistentes.
- Instancia desconocida: la RPC devuelve cero tenants.
- Integración ficticia dentro de una transacción revertida: resolución a
  tenant 1, `booking_enabled=true`, primer claim `true`, duplicado `false`,
  finalización correcta y cero eventos persistidos después del rollback.
- Privilegios remotos: las cinco RPC sólo son ejecutables por `service_role`.

Quedan para el piloto real: registrar las integraciones reales, configurar las
variables privadas de n8n, verificar el payload exacto de Evolution y ejecutar
las pruebas de reservas fuera de horario, tenant suspendido, servicio
inexistente, errores de Supabase/DeepSeek y cruce entre tenants.
