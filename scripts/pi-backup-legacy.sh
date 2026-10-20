#!/usr/bin/env bash
# Snapshot existing legacy SkyHub Postgres + last persisted Redis RDB.
# Does NOT stop services, run Redis SAVE/BGSAVE, migrate data,
# print secrets, run Docker Compose up/down, or alter any live volumes.
set -Eeuo pipefail
umask 077

if [[ "$1" == "--help" ]]; then
  printf '%s\n' 'Usage: bash scripts/pi-backup-legacy.sh'
  printf '%s\n' 'Creates a private backup under ~/Projekte/_backups/skyhub-legacy-*'
  exit 0
fi
if [[ $# -ne 0 ]]; then
  printf '%s\n' 'Unexpected arguments. Use --help for usage.' >&2
  exit 2
fi

for command in docker sha256sum head mktemp date df; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'ERROR: Missing required command: %s\n' "$command" >&2
    exit 2
  fi
done

if ! docker inspect -f '{{.State.Running}}' skyhub_postgres 2>/dev/null | grep -qx true; then
  echo 'ERROR: Existing skyhub_postgres is not running; no backup started.' >&2
  exit 1
fi
if ! docker inspect -f '{{.State.Running}}' skyhub_redis 2>/dev/null | grep -qx true; then
  echo 'ERROR: Existing skyhub_redis is not running; no backup started.' >&2
  exit 1
fi

backup_root="$HOME/Projekte/_backups"
mkdir -p -- "$backup_root"
backup_dir="$(mktemp -d "$backup_root/skyhub-legacy-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXXXX")"
chmod 700 "$backup_dir"
printf 'Backup directory: %s\n' "$backup_dir"
echo 'WARNING: Local backup may reside on the same microSD as the Pi system.'
df -h -- "$backup_dir"

echo '=== Recording non-secret legacy container metadata ==='
{
  printf 'Captured UTC: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for name in skyhub_backend skyhub_postgres skyhub_redis skyhub_emqx; do
    docker inspect -f \
      'container={{.Name}} running={{.State.Running}} image={{.Image}} restart={{.HostConfig.RestartPolicy.Name}}' \
      "$name" 2>/dev/null || true
  done
} > "$backup_dir/runtime-metadata.txt"

echo '=== Consistent PostgreSQL logical backup (no TTY) ==='
pg_tmp="$backup_dir/postgres.dump.part"
pg_file="$backup_dir/postgres.dump"
if ! docker exec skyhub_postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$pg_tmp"; then
  echo 'ERROR: pg_dump failed; incomplete backup kept, no container changed.' >&2
  exit 1
fi
if [[ ! -s "$pg_tmp" ]]; then
  echo 'ERROR: pg_dump file is empty.' >&2
  exit 1
fi
if ! docker exec -i skyhub_postgres pg_restore -l < "$pg_tmp" > /dev/null; then
  echo 'ERROR: pg_restore could not read the archive list.' >&2
  exit 1
fi
mv -- "$pg_tmp" "$pg_file"
printf 'OK: PostgreSQL archive created and archive list verified (%s bytes).\n' "$(wc -c < "$pg_file")"

echo '=== Copying last persisted Redis RDB (no SAVE/BGSAVE issued) ==='
redis_tmp="$backup_dir/redis-dump.rdb.part"
redis_file="$backup_dir/redis-dump.rdb"
if ! docker cp skyhub_redis:/data/dump.rdb "$redis_tmp" >/dev/null; then
  echo 'ERROR: Redis RDB unavailable; database backup exists, bundle incomplete.' >&2
  exit 1
fi
if [[ "$(head -c 5 "$redis_tmp")" != REDIS ]]; then
  echo 'ERROR: Redis RDB header is unexpected; bundle incomplete.' >&2
  exit 1
fi
mv -- "$redis_tmp" "$redis_file"
printf 'OK: Redis RDB snapshot copied (%s bytes).\n' "$(wc -c < "$redis_file")"

echo '=== Redis persistence metadata (no client data) ==='
docker exec skyhub_redis redis-cli INFO persistence |
  tr -d '\r' |
  grep -E '^(rdb_last_save_time|rdb_last_bgsave_status|aof_enabled):' \
  > "$backup_dir/redis-persistence.txt" || true

echo '=== SHA256 integrity manifest ==='
(
  cd "$backup_dir"
  sha256sum postgres.dump redis-dump.rdb runtime-metadata.txt redis-persistence.txt > SHA256SUMS
  sha256sum -c SHA256SUMS
)
echo '=== Result ==='
printf 'COMPLETE: %s\n' "$backup_dir"
echo 'NOTE: Redis RDB contains only the LAST persisted state, not necessarily live memory.'
echo 'NOTE: Copy backups to independent storage before cutting over host port 4000.'
echo 'NOTE: Restoration has not been exercised; disaster recovery is not yet validated.'
