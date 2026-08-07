# Hardening operativo del servidor privado

## Estado aplicado

- Backup pre-hardening validado en `/home/lautaro/backups/saas-prehardening-20260806-150903`.
- Backup nuevo verificado en `/home/lautaro/backups/saas/20260807-000408`.
- Backup automático instalado en `/home/lautaro/bin/saas-backup.sh`, con `--dry-run` y `--verify`.
- Cron diario a las 03:15, con rotación diaria/semanal/mensual dentro de `/home/lautaro/backups/saas`.
- Secretos existentes migrados a `/home/lautaro/mati-bot/.env` con permisos 600; no se cambiaron valores.
- Compose sin `version`, con imágenes fijadas por digest, rotación `json-file` y healthchecks declarados.
- Sólo `n8n` fue recreado y quedó `healthy`. Evolution API, PostgreSQL y Redis no fueron reiniciados; sus healthchecks quedan pendientes de una ventana segura de recreación.
- Cloudflared continúa activo y sus ingress apuntan a `localhost`; no se modificaron DNS ni puertos.

## Variables del piloto

El archivo privado es `/home/lautaro/mati-bot/.env`. `PILOT_MODE=shadow` quedó configurado. Las siguientes variables quedaron declaradas pero vacías porque no existían en el servidor y no se deben inventar:

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `DEEPSEEK_API_KEY`.

Deben cargarse manualmente en ese archivo, con permisos 600, antes de una prueba shadow. El workflow piloto permanece inactivo.

## Exposición y acceso

Cloudflared usa `http://localhost:5678` y `http://localhost:8081`, y ambos destinos respondieron localmente. Los puertos Docker todavía escuchan en `0.0.0.0`; enlazarlos a `127.0.0.1` queda pendiente hasta aplicar una ventana de cambio con rollback y prueba externa del túnel.

La auditoría de UFW/nftables/iptables y la configuración efectiva completa de `sshd` no pudo elevar privilegios porque el alias SSH no tiene sudo sin contraseña. No se cambiaron firewall ni SSH.

## Restauración

`saas-backup.sh --verify` valida `SHA256SUMS`, pero no ejecuta restauraciones destructivas. La restauración debe hacerse en una ventana controlada, deteniendo únicamente el servicio que corresponda y conservando el backup pre-hardening.
