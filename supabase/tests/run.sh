#!/bin/sh
# Levanta un Postgres temporal en Docker, aplica migración + seed y corre las pruebas.
set -e
cd "$(dirname "$0")/.."
NAME=turnos-schema-test
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=test postgres:17 >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1' EXIT
until docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
sleep 1
run() { docker exec -i "$NAME" psql -q -v ON_ERROR_STOP=1 -U postgres -d postgres < "$1"; }
run tests/supabase_stub.sql
run migrations/20261117000000_init.sql
run seed.sql
run seed.sql   # el seed tiene que poder correrse dos veces sin romper
run tests/schema_test.sql
