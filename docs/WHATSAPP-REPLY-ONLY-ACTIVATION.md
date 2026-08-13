# Runbook de activación Reply-only

Este documento no ejecuta acciones. El servidor está **PENDING SERVER ACCESS**.

## Precheck

- [ ] SSH operativo; hostname y project ref sanitizados.
- [ ] Docker/n8n/Evolution/PostgreSQL/Redis healthy.
- [ ] `miwsp` conectada; webhook conserva URL, eventos, base64 y `webhook_by_events`.
- [ ] backup/config rollback de n8n disponible.
- [ ] legacy `gRTZDLTXvGgNq4BZ` activo e intacto.
- [ ] shadow `5UQMp5vAMfBfJtSy` inactivo.
- [ ] `X-Austral-Webhook-Secret` presente; nunca mostrarlo.
- [ ] Supabase y service role apuntan al entorno autorizado; producción `ssagttjdgtypxjcgdnrw` bloqueada.

## QA antes de activar

- [ ] Aplicar `20260813120000_whatsapp_reply_only_pilot.sql` sólo en QA.
- [ ] Crear Credential nativa privada de Supabase QA.
- [ ] Crear exactamente una fila enabled en `saas_whatsapp_reply_only_allowlist`.
- [ ] Importar `Austral WhatsApp Reply Only Pilot` como `active=false`.
- [ ] Ejecutar la matriz offline y fixtures QA, sin Evolution real.
- [ ] Repetir event id; confirmar una sola reclamación.
- [ ] Probar auth, cross-tenant, fromMe, media, timeouts, rate limit y mutación.

## GO controlado

Requiere autorización explícita para tráfico real. Habilitar sólo el workflow reply-only separado y el kill switch; no cambiar shadow ni legacy. Registrar responsable, tenant/integration/instancia y timestamp. Usar sólo un número controlado por el propietario.

## Rollback

1. Desactivar reply-only.
2. Kill switch `disabled`.
3. Confirmar shadow/off y legacy activo.
4. No reiniciar Evolution ni borrar datos.
5. Conservar auditoría y revisar señales sanitizadas.
