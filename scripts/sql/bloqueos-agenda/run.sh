#!/usr/bin/env bash
# Prueba de bloqueos_agenda (tarea 41) sobre un cluster Postgres efímero y
# local: permisos por rol/negocio, trigger de turnos (todos los canales),
# desbloqueo con solapamientos y la carrera bloqueo ↔ reserva.
# No usa .env ni toca ninguna base remota.
#
# Requisitos (los mismos que scripts/sql/cobro-atomico/run.sh):
#   * bash (Git Bash en Windows) con mktemp, grep, awk y tail.
#   * initdb, pg_ctl, createdb y psql de PostgreSQL 13+ (probado con 18).
#     Por defecto "C:\Program Files\PostgreSQL\18\bin"; si no, PG_BIN=<carpeta bin>.
#   * Puerto 55433 libre (cambiable con PG_TEST_PORT).
#   * Finales LF: .gitattributes lo fija con eol=lf.
# El trigger de turnos, la guarda de tenant y las políticas de bloqueos se
# extraen tal cual de las migraciones del repo; el resto es stub.sql.
#
# Uso: bash scripts/sql/bloqueos-agenda/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIG="$REPO/supabase/migrations"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
for tool in initdb pg_ctl createdb psql; do
  if [ ! -x "$BIN/$tool" ] && [ ! -x "$BIN/$tool.exe" ]; then
    echo "No se encontró $tool en '$BIN'. Indicá la carpeta con PG_BIN=<carpeta bin>." >&2
    exit 2
  fi
done
DATA="$(mktemp -d)"
OUT="$(mktemp -d)"
PORT="${PG_TEST_PORT:-55433}"
export PGPORT=$PORT PGHOST=127.0.0.1 PGUSER=postgres PGDATABASE=bloqueos PGCLIENTENCODING=UTF8

"$BIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null
"$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$OUT/pg.log" -w start >/dev/null
trap '"$BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null; rm -rf "$DATA" "$OUT"' EXIT
"$BIN/createdb" bloqueos
PSQL=("$BIN/psql" -X -q -v ON_ERROR_STOP=1)

# Extrae un bloque desde la línea que contiene $2 hasta completar $3 sentencias.
extract() { awk -v start="$2" -v n="$3" 'index($0, start) { on = 1 } on { print; if ($0 ~ /;[[:space:]]*$/ && ++c >= n) exit }' "$1"; }
# Para funciones plpgsql: hasta el cierre "$$;".
extract_fn() { awk -v start="$2" 'index($0, start) { on = 1 } on { print; if ($0 ~ /^\$\$;/) exit }' "$1"; }

"${PSQL[@]}" -f "$HERE/stub.sql"
"${PSQL[@]}" -f "$MIG/20260801030000_turno_business_rules.sql"
{
  extract_fn "$MIG/20261002091000_tenant_write_boundaries.sql" 'create or replace function public.enforce_barbero_same_tenant()'
  extract "$MIG/20261002091000_tenant_write_boundaries.sql" 'drop trigger if exists trg_bloqueos_barbero_same_tenant' 2
  extract "$MIG/20260810171324_qa_base_schema.sql" 'drop policy if exists "bloqueos_select_member"' 2
  extract "$MIG/20261003090000_invited_roles_agenda_access.sql" 'drop policy if exists "bloqueos_write_owner"' 2
} > "$OUT/extraido.sql"
grep -q "array\['owner', 'admin'\]" "$OUT/extraido.sql" || { echo "No se extrajo la política vigente de bloqueos" >&2; exit 1; }
grep -q "enforce_barbero_same_tenant" "$OUT/extraido.sql" || { echo "No se extrajo la guarda de tenant" >&2; exit 1; }
"${PSQL[@]}" -f "$OUT/extraido.sql"
"${PSQL[@]}" -f "$HERE/tests.sql"

AS_OWNER="set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);"
AS_STAFF="set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);"

# 7. Carrera: el bloqueo se guarda mientras una reserva confirma el mismo día.
# A inserta el bloqueo y mantiene la transacción 2 s; B confirma un turno.
"${PSQL[@]}" -At -c "$AS_OWNER begin; select public.try_bloqueo(1, null, public.d(20)); select pg_sleep(2); commit;" > "$OUT/a.out" &
PID=$!
sleep 0.7
B=$("${PSQL[@]}" -At -c "$AS_STAFF select public.try_turno(11, public.d(20), '10:00');" | tail -n1)
wait $PID
A=$(grep -E '^(ok|[0-9A-Z]{5}:)' "$OUT/a.out" | head -n1)
echo "carrera bloqueo pendiente / reserva: bloqueo=$A reserva=$B"
# Sin lock compartido, B no ve el bloqueo sin confirmar y reserva: queda como
# si la reserva hubiera llegado antes. El turno se conserva (regla de la
# tarea) y a partir del commit ninguna reserva nueva entra ese día.
[ "$A" = "ok" ] && [ "$B" = "ok" ]
C=$("${PSQL[@]}" -At -c "$AS_STAFF select public.try_turno(12, public.d(20), '11:00');" | tail -n1)
echo "reserva posterior al commit del bloqueo: $C"
case "$C" in 22023:*bloqueado*) ;; *) exit 1 ;; esac

# 8. Carrera inversa: la reserva está confirmándose cuando se bloquea el día.
"${PSQL[@]}" -At -c "$AS_STAFF begin; select public.try_turno(11, public.d(21), '10:00'); select pg_sleep(2); commit;" > "$OUT/b.out" &
PID=$!
sleep 0.7
D=$("${PSQL[@]}" -At -c "$AS_OWNER select public.try_bloqueo(1, null, public.d(21));" | tail -n1)
wait $PID
E=$(grep -E '^(ok|[0-9A-Z]{5}:)' "$OUT/b.out" | head -n1)
echo "carrera reserva pendiente / bloqueo: reserva=$E bloqueo=$D"
[ "$E" = "ok" ] && [ "$D" = "ok" ]
N=$("${PSQL[@]}" -At -c "select count(*) from public.turnos where fecha in (public.d(20), public.d(21))")
echo "turnos conservados en los días de las carreras: $N"
[ "$N" = "2" ]

# 9. Una oferta obsoleta: la disponibilidad se calculó antes del bloqueo y la
# confirmación llega después. La confirmación se rechaza en el trigger.
"${PSQL[@]}" -At -c "$AS_OWNER select public.try_bloqueo(1, 12, public.d(22));" >/dev/null
F=$("${PSQL[@]}" -At -c "$AS_STAFF select public.try_turno(12, public.d(22), '09:30');" | tail -n1)
echo "confirmación de oferta obsoleta: $F"
case "$F" in 22023:*bloqueado*) ;; *) exit 1 ;; esac
echo "SQL LOCAL BLOQUEOS: TODO PASS"
