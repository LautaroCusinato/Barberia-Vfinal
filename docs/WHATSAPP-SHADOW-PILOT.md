# WhatsApp / Evolution / n8n: shadow pilot

Estado de salida: **SHADOW READY · PENDIENTE DE CONFIGURACIÓN PRIVADA**.

Esta etapa no activa workflows, no envía mensajes, no crea reservas y no toca
Mercado Pago, PayPal, billing ni la lógica de agenda. Aplica Austral SaaS
Architecture para el aislamiento multi-tenant, la derivación server-side y la
idempotencia; la plantilla no agrega una pantalla ni altera el Design System.

## Inventario auditado

| Superficie | Estado | Alcance |
| --- | --- | --- |
| Legacy productivo | Activo, workflow `gRTZDLTXvGgNq4BZ` | Barbería Central; no fue editado, detenido ni reemplazado. |
| Nuevo shadow | Inactivo, workflow `5UQMp5vAMfBfJtSy` | 25 nodos; plantilla separada y fail-closed. |
| QA/mock | Disponible en `cmsymmszlzikqpvfqjre` | Tenants `E2E_QA_BARBERIA_A/B`, proveedores externos deshabilitados. |
| Evolution | Instancia documentada `miwsp`, receptor canónico `5491168280107` | Sólo lectura histórica; no se envió ningún mensaje. |

No se accedió al servidor Docker ni se modificó n8n/Evolution en esta etapa.
El estado del workflow y de la instancia corresponde a la última auditoría
operativa documentada; la verificación privada queda pendiente de acceso al
host.

## Flujo shadow

```text
Evolution webhook
  -> normalización y firma
  -> WHATSAPP_MODE=shadow (guard)
  -> resolver estricto de instancia + receptor
  -> claim idempotente (integration_id + event_id)
  -> contexto y catálogo filtrado por tenant
  -> IA sólo interpreta intención/argumentos
  -> RPC de disponibilidad existente
  -> simular_reserva_whatsapp (sin escrituras)
  -> record_whatsapp_shadow_run (reporte minimizado)
  -> finish_whatsapp_event
```

La plantilla `integrations/templates/WhatsApp Multi Tenant - Contract
Template.json` permanece `active: false`. El modo canónico es
`WHATSAPP_MODE=shadow`; `PILOT_MODE=shadow` se conserva sólo para compatibilidad.
Si ambas variables faltan o toman otro valor, el evento se descarta. La
plantilla no contiene URL `sendText`, `EVOLUTION_API_KEY` ni la RPC
`crear_reserva_whatsapp`, por lo que no puede enviar ni mutar aunque alguien
edite una condición de n8n.

## Resolución de tenant

La migración `20260810100000_harden_whatsapp_identity_resolution.sql` deja
versionada la regla estricta: cuando llegan instancia y receptor, ambos deben
coincidir con la misma integración Evolution conectada. Una combinación
cruzada, instancia desconocida, integración desconectada o tenant no válido
devuelve cero filas. El tenant no se acepta desde el texto, la IA ni un campo
arbitrario del payload.

La migración todavía no se aplicó a producción. Su despliegue requiere una
ventana aprobada y una revisión de compatibilidad; no cambia datos existentes.

## Disponibilidad y agenda

El workflow no reconstruye reglas de agenda para crear turnos. Consulta el
catálogo filtrado por el tenant resuelto y usa la misma función de
disponibilidad que la reserva pública. `simular_reserva_whatsapp` valida:

- servicio activo y relación profesional-servicio;
- duración específica o duración del servicio;
- jornada y zona horaria;
- breaks y bloqueos;
- turnos existentes y solapamientos;
- estado de suscripción;
- teléfono normalizado.

La simulación nunca inserta clientes, turnos ni pagos.

## IA

DeepSeek sólo extrae intención y argumentos permitidos. No decide disponibilidad,
precio, duración, permisos, suscripción ni éxito de reserva. Esos valores deben
provenir del contexto confiable o de RPC/backend. JSON inválido, timeout o
argumentos que intenten incluir `tenant_id`/`barberia_id` se convierten en una
respuesta segura o descarte.

## Idempotencia y datos registrados

`claim_whatsapp_event` reclama atómicamente por integración y `event_id`.
Repetir el mismo evento devuelve `acquired=false` y no produce una segunda
acción. `saas_automation_shadow_runs` conserva sólo intent, resultado propuesto,
longitud, latencia, hashes/metadatos mínimos y expiración de 30 días. No guarda
conversaciones completas, tokens, cookies ni secretos.

## Casos verificados con mocks

El self-test determinista cubre 24 escenarios:

- saludo, precio, servicios, horarios y disponibilidad;
- reserva solicitada, cambio de horario y cancelación solicitada;
- mensaje ambiguo, fuera de contexto y audio no soportado;
- mensaje/webhook duplicado;
- número desconocido y tenant suspendido;
- Evolution/n8n caídos, timeout de Supabase o IA, JSON inválido;
- RPC fallida y disponibilidad cambiada durante la conversación.

También verifica aislamiento A/B, identidad cruzada instancia-receptor, modo no
shadow y ausencia de efectos externos. Son pruebas **MOCK**, no tráfico real de
Evolution ni ejecución privada de n8n.

## Failure modes y severidades

| Señal | Severidad | Comportamiento |
| --- | --- | --- |
| Webhook/tenant no resoluble | P1 | Descartar y auditar código sanitizado. |
| Duplicado de evento | P2 | No repetir acción; registrar `duplicate_event`. |
| Timeout/5xx de Supabase o IA | P1 | Fallar cerrado, finalizar como error y no responder externamente. |
| Disponibilidad vacía o validación | P2 | Proponer alternativas sólo con datos backend; no inventar turno. |
| Intento de mutación en shadow | P0 | Guard bloqueante; incidente y rollback del piloto. |
| Evolución/n8n indisponible | P1 | No reintentar mensajes; revisar logs y correlation ID. |

Las señales se integran con `docs/MONITORING-ALERTING.md`: webhook recibido,
tenant resuelto/fallido, AI success/failure, availability success/failure,
duplicate event, shadow completed, mutation blocked y latencia.

## Variables privadas pendientes

Configurar sólo en el servidor/Compose/Portainer de n8n, nunca en Git ni en el
frontend:

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_BASE_URL`,
`EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY`,
`WHATSAPP_MODE=shadow`, `PILOT_MODE=shadow`.

No se muestran ni se solicitan valores en el chat. El workflow piloto continúa
inactivo hasta que esas variables se configuren y se autorice una prueba
controlada con fixture anonimizado.

## Evolución futura y rollback

- `shadow`: única modalidad preparada ahora; sin mensajes ni mutaciones.
- `reply_only`: futuro workflow separado, allowlist explícita y revisión de
  contenido; no habilitado.
- `booking_enabled`: futuro workflow separado que llamará al backend seguro,
  con allowlist, firma, idempotencia y autorización independiente; no habilitado.

Rollback: mantener o restaurar `WHATSAPP_MODE=shadow` y `PILOT_MODE=shadow`,
desactivar sólo el workflow piloto, conservar el legacy y revisar los reportes.
No borrar turnos, clientes ni eventos históricos.

## Próximo paso mínimo

1. Configurar variables privadas en n8n sin exponerlas.
2. Confirmar que el piloto `5UQMp5vAMfBfJtSy` sigue inactivo y el legacy activo.
3. Aplicar la migración de identidad sólo después de revisar el plan de
   despliegue.
4. Ejecutar un único fixture anonimizado y repetir su `event_id` para comprobar
   idempotencia.

## Preparacion offline de autenticacion

Antes de cualquier acceso al servidor se definio el contrato de entrada en
[docs/WHATSAPP-WEBHOOK-AUTH.md](./WHATSAPP-WEBHOOK-AUTH.md). El Shadow Pilot
debe recibir `X-Austral-Webhook-Secret` y validarlo con
`EVOLUTION_WEBHOOK_SECRET` antes de resolver tenant, consultar Supabase o
llamar a DeepSeek. Ausencia, valor vacio, secreto no configurado o valor
incorrecto producen 401 y no dejan efectos secundarios. Ningun secreto o
header se escribe en logs.

La preparacion usa el mecanismo de headers configurables documentado por
Evolution API 2.3.7; no asume una firma HMAC nativa. El workflow legacy
`gRTZDLTXvGgNq4BZ` queda fuera del cambio. El script
`scripts/whatsapp-webhook-config.mjs` ofrece `--dry-run`, `--apply` y
`--rollback`, preserva URL/eventos/base64/by-events y no se ejecuto durante esta
etapa offline.

## Checklist E2E para la proxima ventana autorizada

1. Confirmar acceso privado al host y que la instancia sea `miwsp`.
2. Ejecutar `npm run whatsapp:webhook:dry-run`; revisar metadata sanitizada.
3. Confirmar backup privado, `WHATSAPP_MODE=shadow`, `PILOT_MODE=shadow`,
   `reply_only=false` y `booking_enabled=false`.
4. Cargar `EVOLUTION_WEBHOOK_SECRET` solo en el gestor privado y ejecutar
   `npm run whatsapp:webhook:apply` con aprobacion.
5. Mantener `5UQMp5vAMfBfJtSy` inactivo para webhooks externos y conservar
   `gRTZDLTXvGgNq4BZ` activo e intacto.
6. Ejecutar un unico fixture `E2E_QA_WA_SHADOW_001` con instancia/receptor
   ficticios; validar tenant, intencion, disponibilidad y propuesta.
7. Repetir exactamente `integration_id + event_id`; esperar un unico shadow log.
8. Verificar `mutation_blocked=true`, cero `sendText`, cero reservas y cero
   cambios de clientes.
9. Probar identidad cruzada, header ausente/incorrecto, timeout y JSON IA
   invalido; todos deben fallar cerrado.
10. Si algo difiere, detenerse y ejecutar rollback; no activar
    `reply_only`/`booking_enabled`.

No cambiar a `reply_only` ni `booking_enabled` sin autorización explícita.

La suite offline equivalente es `npm run whatsapp:shadow:offline` y no hace
requests de red.
