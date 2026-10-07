#!/usr/bin/env bash
set -euo pipefail

: "${PGDATA:=/var/lib/postgresql/data}"
: "${PRIMARY_HOST:?PRIMARY_HOST is required}"
: "${PRIMARY_PORT:=5432}"
: "${REPLICATION_USER:?REPLICATION_USER is required}"
: "${REPLICATION_PASSWORD:?REPLICATION_PASSWORD is required}"

find "$PGDATA" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
printf '%s:%s:replication:%s:%s\n' "$PRIMARY_HOST" "$PRIMARY_PORT" "$REPLICATION_USER" "$REPLICATION_PASSWORD" > /tmp/replica.pgpass
chmod 600 /tmp/replica.pgpass

PGPASSFILE=/tmp/replica.pgpass pg_basebackup \
  --host="$PRIMARY_HOST" \
  --port="$PRIMARY_PORT" \
  --username="$REPLICATION_USER" \
  --pgdata="$PGDATA" \
  --wal-method=stream \
  --write-recovery-conf \
  --checkpoint=fast \
  --progress

cp /tmp/replica.pgpass "$PGDATA/.pgpass"
chmod 600 "$PGDATA/.pgpass"
rm /tmp/replica.pgpass
export PGPASSFILE="$PGDATA/.pgpass"

exec docker-entrypoint.sh postgres \
  -c hot_standby=on \
  -c shared_preload_libraries=pg_stat_statements
