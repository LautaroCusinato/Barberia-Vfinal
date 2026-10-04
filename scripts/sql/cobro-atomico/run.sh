#!/usr/bin/env bash
# Prueba de comportamiento de registrar_cobro_turno (tarea 05) sobre un
# cluster Postgres efímero y local (initdb en un directorio temporal, puerto
# 55432). No usa .env ni toca ninguna base remota. Requiere PostgreSQL 15+.
# Uso: bash scripts/sql/cobro-atomico/run.sh   (PG_BIN=<carpeta bin> opcional)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)"
OUT="$(mktemp -d)"
PORT=55432
export PGPORT=$PORT PGHOST=127.0.0.1 PGUSER=postgres PGDATABASE=cobro PGCLIENTENCODING=UTF8

"$BIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null
"$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$OUT/pg.log" -w start >/dev/null
trap '"$BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null; rm -rf "$DATA" "$OUT"' EXIT
"$BIN/createdb" cobro
PSQL=("$BIN/psql" -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$HERE/stub.sql"
"${PSQL[@]}" -f "$REPO/supabase/migrations/20261004090000_registrar_cobro_turno.sql"
# Idempotencia de la migración: aplicarla dos veces no falla.
"${PSQL[@]}" -f "$REPO/supabase/migrations/20261004090000_registrar_cobro_turno.sql"
"${PSQL[@]}" -f "$HERE/tests.sql"

# 11. Concurrencia real: dos sesiones sobre el turno 3.
SETUP="set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);"
# 11a. Doble clic: misma clave. A mantiene el lock 2 s; B espera y recibe el pago de A.
"${PSQL[@]}" -At -c "$SETUP begin; select public.t_try(3, 50, 'efectivo', '33333333-3333-4333-8333-333333333333'); select pg_sleep(2); commit;" > "$OUT/a.out" &
PID=$!
sleep 0.7
B=$("${PSQL[@]}" -At -c "$SETUP select public.t_try(3, 50, 'efectivo', '33333333-3333-4333-8333-333333333333');" | tail -n1)
wait $PID
A=$(grep -E '^(ok|turno|clave)' "$OUT/a.out" | head -n1)
echo "doble clic concurrente: A=$A B=$B"
[ "$A" = "ok:false" ] && [ "$B" = "ok:true" ]
# 11b. Dos operadores concurrentes, claves distintas, otro turno nuevo.
"${PSQL[@]}" -c "insert into public.turnos (barberia_id, servicio_id, paciente, motivo) values (1, 1, 'Carrera', 'Corte')"
T=$("${PSQL[@]}" -At -c "select max(id) from public.turnos")
"${PSQL[@]}" -At -c "$SETUP begin; select public.t_try($T, 50, 'efectivo', gen_random_uuid()); select pg_sleep(2); commit;" > "$OUT/a2.out" &
PID=$!
sleep 0.7
SETUP_B="set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);"
B2=$("${PSQL[@]}" -At -c "$SETUP_B select public.t_try($T, 70, 'transferencia', gen_random_uuid());" | tail -n1)
wait $PID
A2=$(grep -E '^(ok|turno|clave)' "$OUT/a2.out" | head -n1)
echo "dos operadores concurrentes: A=$A2 B=$B2"
[ "$A2" = "ok:false" ] && [ "$B2" = "turno_ya_atendido" ]
N=$("${PSQL[@]}" -At -c "select count(*) from public.pagos where turno_id in (3, $T)")
echo "pagos para los dos turnos concurrentes: $N"
[ "$N" = "2" ]

# 12. Rollback operativo documentado: quita la RPC y la columna, conserva pagos.
BEFORE=$("${PSQL[@]}" -At -c "select count(*) from public.pagos")
"${PSQL[@]}" -c "drop function if exists public.t_try(bigint, numeric, text, uuid); drop function if exists public.registrar_cobro_turno(bigint, numeric, text, uuid); drop index if exists public.uq_pagos_idempotency_key; alter table public.pagos drop column if exists idempotency_key;"
AFTER=$("${PSQL[@]}" -At -c "select count(*) from public.pagos")
echo "rollback: pagos antes=$BEFORE después=$AFTER"
[ "$BEFORE" = "$AFTER" ]
echo "SQL LOCAL: TODO PASS"
