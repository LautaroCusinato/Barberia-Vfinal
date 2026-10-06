#!/usr/bin/env bash
# Prueba de las RPC del envío del panel (tarea 38) sobre un cluster Postgres
# efímero y local, con sesiones concurrentes reales. No usa .env ni toca
# ninguna base remota. Mismos requisitos que scripts/sql/cobro-atomico/run.sh:
# bash, binarios de PostgreSQL 13+ (por defecto los de Windows en
# "C:\Program Files\PostgreSQL\18\bin"; si no, PG_BIN=<carpeta bin>) y el
# puerto 55433 libre (PG_TEST_PORT). Finales LF fijados en .gitattributes.
#
# Uso: bash scripts/sql/whatsapp-panel-send/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
MIGRATION="$REPO/supabase/migrations/20261005120000_whatsapp_panel_send_atomic.sql"
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
export PGPORT=$PORT PGHOST=127.0.0.1 PGUSER=postgres PGDATABASE=panel PGCLIENTENCODING=UTF8

"$BIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null
"$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1 -c max_connections=60" -l "$OUT/pg.log" -w start >/dev/null
trap '"$BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null; rm -rf "$DATA" "$OUT"' EXIT
"$BIN/createdb" panel
PSQL=("$BIN/psql" -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$HERE/stub.sql"
"${PSQL[@]}" -f "$MIGRATION"
# Idempotencia de la migración: aplicarla dos veces no falla.
"${PSQL[@]}" -f "$MIGRATION"
"${PSQL[@]}" -f "$HERE/tests.sql" 2>&1 | grep -E "ok:|PASS|FALLA" | sed 's/^psql:[^ ]* NOTICE:  //'

SR="set role service_role;"
res() { # cliente key texto limite confirm
  echo "select public.reservar_envio_panel(1, $1, '$2', '$3', '12:00', ${5:-false}, ${4:-20}, 60, 300, 120) ->> 'status';"
}
now_ms() { date +%s%3N; }

# C1. Serialización: A toma el único lugar (límite 1) y mantiene la transacción
# 2 s abierta. B empieza durante ese tiempo: debe esperar el lock y, al ver la
# fila de A ya confirmada, recibir rate_limited. Sin el lock, B leería antes del
# commit de A y también reservaría (límite superado).
"${PSQL[@]}" -At -c "$SR begin; $(res 1 aaaaaaaa-0000-4000-8000-000000000001 C1-A 1); select pg_sleep(2); commit;" > "$OUT/c1a.out" &
PID=$!
sleep 0.7
T0=$(now_ms)
B=$("${PSQL[@]}" -At -c "$SR $(res 2 aaaaaaaa-0000-4000-8000-000000000002 C1-B 1)" | tail -n1)
T1=$(now_ms)
wait $PID
A=$(grep -E '^[a-z_]+$' "$OUT/c1a.out" | head -n1)
echo "C1 límite 1 con dos sesiones: A=$A B=$B (B esperó $((T1 - T0)) ms)"
[ "$A" = "reserved" ] && [ "$B" = "rate_limited" ] && [ $((T1 - T0)) -ge 900 ]
"${PSQL[@]}" -c "delete from public.mensajes; delete from public.config;"

# C0. Control negativo: la misma RPC sin el lock, en el mismo escenario, debe
# superar el límite. Demuestra que C1 detectaría la falta del lock.
"${PSQL[@]}" -c "do \$\$ declare d text; begin
  d := pg_get_functiondef('public.reservar_envio_panel(bigint,bigint,uuid,text,text,boolean,integer,integer,integer,integer)'::regprocedure);
  d := replace(d, 'public.reservar_envio_panel(', 'public.t_reservar_sin_lock(');
  d := replace(d, 'perform pg_advisory_xact_lock(', 'perform (');
  execute d;
end \$\$; grant execute on function public.t_reservar_sin_lock(bigint,bigint,uuid,text,text,boolean,integer,integer,integer,integer) to service_role;"
SIN_LOCK() { echo "select public.t_reservar_sin_lock(1, $1, '$2', '$3', '12:00', false, 1, 60, 300, 120) ->> 'status';"; }
"${PSQL[@]}" -At -c "$SR begin; $(SIN_LOCK 1 eeeeeeee-0000-4000-8000-000000000001 C0-A); select pg_sleep(2); commit;" > "$OUT/c0a.out" &
PID=$!
sleep 0.7
B=$("${PSQL[@]}" -At -c "$SR $(SIN_LOCK 2 eeeeeeee-0000-4000-8000-000000000002 C0-B)" | tail -n1)
wait $PID
A=$(grep -E '^[a-z_]+$' "$OUT/c0a.out" | head -n1)
N=$("${PSQL[@]}" -At -c "select count(*) from public.mensajes where barberia_id = 1")
echo "C0 control sin lock, límite 1: A=$A B=$B filas=$N (se esperaba superar el límite)"
[ "$A" = "reserved" ] && [ "$B" = "reserved" ] && [ "$N" = "2" ]
"${PSQL[@]}" -c "drop function public.t_reservar_sin_lock(bigint,bigint,uuid,text,text,boolean,integer,integer,integer,integer); delete from public.mensajes; delete from public.config;"

# C2. Respuesta perdida + reintento simultáneo con el mismo identificador:
# B espera a A y recibe replay (ni una segunda fila ni un error de unicidad).
"${PSQL[@]}" -At -c "$SR begin; $(res 1 bbbbbbbb-0000-4000-8000-000000000001 Mismo); select pg_sleep(2); commit;" > "$OUT/c2a.out" &
PID=$!
sleep 0.7
B=$("${PSQL[@]}" -At -c "$SR $(res 1 bbbbbbbb-0000-4000-8000-000000000001 Mismo)" | tail -n1)
wait $PID
A=$(grep -E '^[a-z_]+$' "$OUT/c2a.out" | head -n1)
N=$("${PSQL[@]}" -At -c "select count(*) from public.mensajes where client_message_id = 'bbbbbbbb-0000-4000-8000-000000000001'")
echo "C2 mismo identificador concurrente: A=$A B=$B filas=$N"
[ "$A" = "reserved" ] && [ "$B" = "replay" ] && [ "$N" = "1" ]

# C3. Dos operadores, mismo texto al mismo cliente, identificadores distintos.
"${PSQL[@]}" -At -c "$SR begin; $(res 2 cccccccc-0000-4000-8000-000000000001 Repetido); select pg_sleep(2); commit;" > "$OUT/c3a.out" &
PID=$!
sleep 0.7
B=$("${PSQL[@]}" -At -c "$SR $(res 2 cccccccc-0000-4000-8000-000000000002 Repetido)" | tail -n1)
wait $PID
A=$(grep -E '^[a-z_]+$' "$OUT/c3a.out" | head -n1)
echo "C3 mismo texto concurrente: A=$A B=$B"
[ "$A" = "reserved" ] && [ "$B" = "possible_duplicate" ]
"${PSQL[@]}" -c "delete from public.mensajes; delete from public.config;"

# C4. Ráfaga: 25 sesiones simultáneas, límite 20 (valor de prueba).
for i in $(seq 1 25); do
  KEY=$(printf 'dddddddd-0000-4000-8000-%012d' "$i")
  "${PSQL[@]}" -At -c "$SR $(res 1 "$KEY" "Rafaga $i" 20)" > "$OUT/burst.$i" &
done
wait
RESERVED=$(cat "$OUT"/burst.* | grep -c '^reserved$' || true)
LIMITED=$(cat "$OUT"/burst.* | grep -c '^rate_limited$' || true)
ROWS=$("${PSQL[@]}" -At -c "select count(*) from public.mensajes where barberia_id = 1")
echo "C4 ráfaga de 25 sesiones con límite 20: reservadas=$RESERVED frenadas=$LIMITED filas=$ROWS"
[ "$RESERVED" = "20" ] && [ "$LIMITED" = "5" ] && [ "$ROWS" = "20" ]

# R. Rollback: conserva las filas, quita funciones, restricción y columnas; el
# panel anterior sigue insertando; la migración se puede volver a aplicar.
BEFORE=$("${PSQL[@]}" -At -c "select count(*) from public.mensajes")
"${PSQL[@]}" -f "$HERE/rollback.sql"
AFTER=$("${PSQL[@]}" -At -c "select count(*) from public.mensajes")
LEFT=$("${PSQL[@]}" -At -c "select count(*) from pg_proc where proname in ('reservar_envio_panel', 'completar_envio_panel', 'recuperar_envios_panel_pendientes', 'telefono_whatsapp_canonico')")
COLS=$("${PSQL[@]}" -At -c "select count(*) from information_schema.columns where table_name = 'mensajes' and column_name in ('client_message_id', 'envio_actualizado_at')")
"${PSQL[@]}" -c "insert into public.mensajes (barberia_id, cliente_id, paciente, texto, de) values (1, 1, 'Ana', 'despues del rollback', 'clinica')"
echo "R rollback: filas antes=$BEFORE después=$AFTER funciones=$LEFT columnas=$COLS"
[ "$BEFORE" = "$AFTER" ] && [ "$LEFT" = "0" ] && [ "$COLS" = "0" ]
"${PSQL[@]}" -f "$MIGRATION"
echo "R migración reaplicada después del rollback"
echo "SQL LOCAL: TODO PASS"
