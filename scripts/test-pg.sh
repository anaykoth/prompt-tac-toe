#!/bin/sh
# Throwaway local Postgres for the SQL-level tests (needs Homebrew postgres).
#   scripts/test-pg.sh start   -> cluster on 127.0.0.1:54371, db joust_test, all migrations applied
#   scripts/test-pg.sh stop    -> stops it and deletes the data dir
# Nothing here touches the real database; TTT_DATABASE_URL is never read.
set -e
PORT=${TEST_PG_PORT:-54371}
DIR=${TEST_PG_DIR:-${TMPDIR:-/tmp}/ptt-test-pg}
HERE=$(cd "$(dirname "$0")/.." && pwd)
case "$1" in
  start)
    if pg_ctl -D "$DIR" status >/dev/null 2>&1; then echo "already running on :$PORT"; exit 0; fi
    rm -rf "$DIR"; initdb -D "$DIR" -U postgres -A trust >/dev/null
    pg_ctl -D "$DIR" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$DIR/log.txt" -w start >/dev/null
    createdb -h 127.0.0.1 -p "$PORT" -U postgres joust_test
    for f in "$HERE"/supabase/migrations/*.sql; do psql -q -h 127.0.0.1 -p "$PORT" -U postgres -d joust_test -f "$f"; done
    echo "test postgres up: postgres://postgres@127.0.0.1:$PORT/joust_test";;
  stop)
    pg_ctl -D "$DIR" -m fast stop >/dev/null 2>&1 || true; rm -rf "$DIR"; echo "stopped";;
  *) echo "usage: $0 start|stop"; exit 2;;
esac
