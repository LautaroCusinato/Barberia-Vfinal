#!/usr/bin/env bash
set -euo pipefail

# Safe backup for the private mati-bot host. The .env is copied as protected
# data; this script never prints its contents and never touches the old
# pre-hardening backup directory.
BASE=/home/lautaro/backups/saas
COMPOSE=/home/lautaro/mati-bot/docker-compose.yml
ENV_FILE=/home/lautaro/mati-bot/.env
LOG_FILE=$BASE/backup.log
MODE=run
if [ "$#" -ge 1 ]; then MODE=$1; fi

log() { printf '%s\n' "$(date -Is) $*" >> "$LOG_FILE"; }
dry_run() {
  printf '%s\n' "dry-run: base=$BASE compose=$COMPOSE env_file=$ENV_FILE"
  printf '%s\n' 'dry-run: n8n SQLite/data, Evolution instances, Evolution PostgreSQL dump, Redis RDB, Compose, protected env, image/container manifests and SHA256SUMS'
}

if [ "$MODE" = '--dry-run' ]; then dry_run; exit 0; fi
if [ "$MODE" != 'run' ] && [ "$MODE" != '--verify' ]; then
  printf '%s\n' 'usage: saas-backup.sh [run|--dry-run|--verify]' >&2
  exit 2
fi

install -d -m 700 "$BASE"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

if [ "$MODE" = '--verify' ]; then
  latest=$(find "$BASE" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%T@ %p\n' | sort -nr | head -n 1 | cut -d' ' -f2-)
  [ -n "$latest" ] || { printf '%s\n' 'no backup found' >&2; exit 1; }
  (cd "$latest" && sha256sum -c SHA256SUMS >/dev/null)
  printf '%s\n' "verified:$(basename "$latest")"
  exit 0
fi

stamp=$(date +%Y%m%d-%H%M%S)
backup="$BASE/$stamp"
install -d -m 700 "$backup"
tmp=/tmp/saas-backup-$$
mkdir -m 700 "$tmp"
cleanup() { rm -rf -- "$tmp"; }
trap cleanup EXIT

cp -p "$COMPOSE" "$backup/docker-compose.yml"
cp -p "$ENV_FILE" "$backup/env"
cp -p /home/lautaro/infra/docker-compose.yml "$backup/infra-docker-compose.yml"
[ ! -f /home/lautaro/infra/.env ] || cp -p /home/lautaro/infra/.env "$backup/infra.env"
[ ! -f /etc/cloudflared/config.yml ] || cp -p /etc/cloudflared/config.yml "$backup/cloudflared-config.yml"

docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}' > "$backup/compose-services.txt"
docker volume ls --format '{{.Name}}|{{.Driver}}' > "$backup/compose-volumes.txt"
docker image ls --digests > "$backup/docker-images.txt"
docker inspect n8n evolution_api evolution_postgres evolution_redis > "$backup/docker-inspect.json"
docker exec n8n sh -c 'tar czf - -C /home/node .n8n' > "$backup/n8n_data.tgz"
docker exec evolution_api sh -c 'tar czf - -C /evolution/instances .' > "$backup/evolution_instances.tgz"
docker exec evolution_redis sh -c 'redis-cli --rdb /tmp/saas-backup.rdb >/dev/null 2>&1'
docker cp evolution_redis:/tmp/saas-backup.rdb "$backup/redis.rdb"
docker exec evolution_postgres sh -c 'pg_dumpall -U "$POSTGRES_USER"' > "$backup/evolution_postgres.sql"

(cd "$backup" && find . -maxdepth 1 -type f ! -name './SHA256SUMS' ! -name './MANIFEST' -printf '%f\n' | sort > MANIFEST)
(cd "$backup" && while IFS= read -r file; do sha256sum "$file"; done < MANIFEST > SHA256SUMS)
chmod 600 "$backup"/*
(cd "$backup" && sha256sum -c SHA256SUMS > hash-verification.txt)
chmod 600 "$backup"/hash-verification.txt
log "backup_complete=$(basename "$backup")"

# Retain seven newest daily copies, four Sunday copies and three first-of-month
# copies. Only directories inside BASE matching the timestamp shape are ever
# considered for removal; saas-prehardening-* is outside this rotation.
keep="$tmp/keep"
: > "$keep"
mapfile -t all < <(find "$BASE" -mindepth 1 -maxdepth 1 -type d -name '20*' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
for dir in "${all[@]:0:7}"; do basename "$dir" >> "$keep"; done
weekly=0
monthly=0
for dir in "${all[@]}"; do
  stamp_name=$(basename "$dir")
  date_part=$(printf '%s' "$stamp_name" | cut -c1-8)
  if [ "$weekly" -lt 4 ] && [ "$(date -d "$date_part" +%u 2>/dev/null || printf 0)" = 7 ]; then
    printf '%s\n' "$stamp_name" >> "$keep"
    weekly=$((weekly + 1))
  fi
  if [ "$monthly" -lt 3 ] && [ "$(date -d "$date_part" +%d 2>/dev/null || printf 0)" = 01 ]; then
    printf '%s\n' "$stamp_name" >> "$keep"
    monthly=$((monthly + 1))
  fi
done
for dir in "${all[@]}"; do
  name=$(basename "$dir")
  if ! grep -Fxq "$name" "$keep"; then rm -rf -- "$dir"; fi
done

printf '%s\n' "$backup"
