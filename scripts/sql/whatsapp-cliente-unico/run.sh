#!/usr/bin/env bash
# Prueba de la ficha única de cliente entre reserva web y WhatsApp (tarea 35)
# sobre un cluster Postgres efímero y local. No usa .env ni toca bases remotas.
#
# Requisitos: los mismos que scripts/sql/cobro-atomico/run.sh (bash, binarios
# initdb/pg_ctl/createdb/psql 13+; PG_BIN=<carpeta bin> si no están en
# "C:\Program Files\PostgreSQL\18\bin"). Puerto 55433 (PG_TEST_PORT).
# Finales LF fijados por .gitattributes.
#
# Uso: bash scripts/sql/whatsapp-cliente-unico/run.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
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
export PGPORT=$PORT PGHOST=127.0.0.1 PGUSER=postgres PGDATABASE=clientes PGCLIENTENCODING=UTF8

"$BIN/initdb" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null
"$BIN/pg_ctl" -D "$DATA" -o "-p $PORT -c listen_addresses=127.0.0.1" -l "$OUT/pg.log" -w start >/dev/null
trap '"$BIN/pg_ctl" -D "$DATA" -m fast -w stop >/dev/null; rm -rf "$DATA" "$OUT"' EXIT
"$BIN/createdb" clientes
PSQL=("$BIN/psql" -X -q -v ON_ERROR_STOP=1)
"${PSQL[@]}" -f "$HERE/stub.sql"
# Trigger de teléfono vigente (rechaza lo que no es 549 + 10 dígitos).
"${PSQL[@]}" -f "$REPO/supabase/migrations/20261001091000_phone_any_argentine_area.sql"
"${PSQL[@]}" -c "create trigger trg_clientes_phone before insert or update of telefono on public.clientes for each row execute function public.normalize_phone_ar_fields(); create trigger trg_turnos_phone before insert or update of telefono on public.turnos for each row execute function public.normalize_phone_ar_fields();"
# Reserva web vigente.
"${PSQL[@]}" -f "$REPO/supabase/migrations/20261002092000_public_booking_hardening.sql"

# Línea de base: la definición anterior de crear_reserva_whatsapp reemplazaba
# el nombre de una ficha web con el escrito en el chat.
awk '/^create or replace function public\.crear_reserva_whatsapp\(/{on=1} on{print} on&&/^\$\$;$/{exit}' \
  "$REPO/supabase/migrations/20260806150000_multitenant_whatsapp_contract.sql" > "$OUT/anterior.sql"
"${PSQL[@]}" -f "$OUT/anterior.sql"
"${PSQL[@]}" -At -c "select turno_id from public.crear_reserva_publica('negocio-dos', 2, 2, date '2099-02-01', time '10:00', 'Base Web', '+54 9 11 5555-0900', null)" >/dev/null
"${PSQL[@]}" -At -c "select turno_id from public.crear_reserva_whatsapp(20, 'base-1', 2, 2, date '2099-02-02', time '10:00', 'Base Chat', '5491155550900', null)" >/dev/null
BASE=$("${PSQL[@]}" -At -c "select nombre from public.clientes where barberia_id = 2 and telefono = '5491155550900'")
echo "línea de base (definición anterior): nombre de la ficha web tras reservar por chat = '$BASE'"
[ "$BASE" = "Base Chat" ]
"${PSQL[@]}" -c "delete from public.turnos; delete from public.clientes; delete from public.saas_automation_events;"

# Migración nueva, dos veces (idempotente).
"${PSQL[@]}" -f "$REPO/supabase/migrations/20261004120000_whatsapp_cliente_unico.sql"
"${PSQL[@]}" -f "$REPO/supabase/migrations/20261004120000_whatsapp_cliente_unico.sql"
"${PSQL[@]}" -f "$HERE/tests.sql" 2>&1 | sed -n 's/.*NOTICE:  //p'

# Rollback documentado: volver a la definición anterior funciona sin tocar datos.
BEFORE=$("${PSQL[@]}" -At -c "select count(*) || '/' || (select count(*) from public.turnos) from public.clientes")
"${PSQL[@]}" -f "$OUT/anterior.sql"
"${PSQL[@]}" -c "revoke all on function public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text) from public, anon, authenticated; grant execute on function public.crear_reserva_whatsapp(bigint, text, bigint, bigint, date, time, text, text, text) to service_role;"
AFTER=$("${PSQL[@]}" -At -c "select count(*) || '/' || (select count(*) from public.turnos) from public.clientes")
echo "rollback: clientes/turnos antes=$BEFORE después=$AFTER"
[ "$BEFORE" = "$AFTER" ]
echo "SQL LOCAL: TODO PASS"
