# Runbook de lanzamiento del piloto

Este flujo comienza cuando regresan el servidor y los servicios cloud. La documentación no autoriza por sí sola cambios: todo paso marcado como **APROBACIÓN MANUAL REQUERIDA** debe detenerse hasta que la persona responsable confirme.

## Secuencia

1. **Servidor:** confirmar acceso, identidad del host, health de Docker y hora. Si no responde, detenerse; no sustituirlo por otro host.
2. **Backup:** confirmar snapshot/backup y restauración verificable. **APROBACIÓN MANUAL REQUERIDA** para cualquier restauración.
3. **Snapshot operativo:** registrar migraciones, variables por nombre, deployments, estado de Evolution/n8n y rollback; no copiar secretos.
4. **Migraciones:** comparar historial QA/producción y aplicar sólo migraciones autorizadas, aditivas e idempotentes. **APROBACIÓN MANUAL REQUERIDA**; nunca editar la tabla de historial a mano.
5. **DB/RLS:** ejecutar checks de políticas, grants, RPC, aislamiento y smoke de lectura/escritura permitida en el entorno autorizado.
6. **Deploy:** verificar commit, branch, build, variables y dominio; desplegar sólo el destino aprobado. **APROBACIÓN MANUAL REQUERIDA** para producción.
7. **Smoke productivo:** sólo después de backup, rollback y autorización; usar probes mínimos y sin mutaciones. **APROBACIÓN MANUAL REQUERIDA**.
8. **Tenant piloto:** crear o seleccionar un negocio con consentimiento, completar onboarding y confirmar fecha de trial server-side.
9. **Catálogo operativo:** cargar servicios, precios, profesionales, relaciones y horarios del negocio; validar breaks, bloqueos y enlace público.
10. **Reserva web:** realizar únicamente el smoke acordado; no crear datos de clientes reales sin autorización.
11. **WhatsApp:** usar una instancia dedicada, confirmar webhook/mode/allowlist y mostrar QR sólo en una ventana aprobada. **APROBACIÓN MANUAL REQUERIDA** para QR, pairing, mensajes o automatización real; `miwsp` debe permanecer fuera del piloto.
12. **Smoke del dueño:** login, Agenda, Clientes, Servicios, Equipo, Configuración, reserva pública y estado real de integraciones.
13. **Safeguards:** confirmar fail-closed, tenant isolation, outbound/mutation guards, logs sanitizados y rollback.
14. **Trial:** comunicar 15 días y continuidad manual. No habilitar cobros automáticos.
15. **Primeras 24 h:** seguir [FIRST-24-HOURS.md](./FIRST-24-HOURS.md) y registrar sólo métricas disponibles.

## Límites explícitos

- **APROBACIÓN MANUAL REQUERIDA:** migración, deploy productivo, billing productivo, Mercado Pago, tarjeta/token, checkout, pagos, cargos, QR/pairing, sendText, n8n/Evolution productivos y cualquier cambio de firewall/DNS/SSH.
- Nunca mezclar QA y producción ni usar un tenant real como fixture.
- Ante una referencia productiva inesperada, detenerse y conservar evidencia sanitizada.
