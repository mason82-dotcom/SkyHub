#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# CI-only, self-contained restore test. It never accepts a database URL or
# container name, and never connects to SkyHub's Pi or production databases.
if [[ "${GITHUB_ACTIONS:-}" != "true" || "${CI:-}" != "true" ||
      "${SKYHUB_CI_RESTORE_TEST:-}" != "isolated" ]]; then
  echo "REFUSED: dedicated GitHub Actions CI environment and explicit test gate required." >&2
  exit 2
fi
if [[ -n "${DATABASE_URL:-}" || -n "${SKYHUB_TEST_DATABASE_URL:-}" ]]; then
  echo "REFUSED: restore test must not inherit any database connection URL." >&2
  exit 2
fi

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="postgis/postgis:15-3.5"
SOURCE_DB="skyhub_test"
RESTORE_DB="skyhub_restore_test"
TEST_USER="skyhub_test"
CID=""
cleanup() {
  if [[ -n "$CID" ]]; then docker rm -f "$CID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

command -v docker >/dev/null || { echo "Docker required." >&2; exit 2; }
for file in \
  "$ROOT/backend/db/schema.sql" \
  "$ROOT/backend/db/migrations/001_dji_map_elements.sql" \
  "$ROOT/tests/fixtures/postgis-restore-seed.sql" \
  "$ROOT/tests/fixtures/postgis-restore-verify.sql"; do
  [[ -f "$file" ]] || { echo "Missing SQL fixture." >&2; exit 2; }
done

echo "Starting a temporary, network-isolated PostGIS container; no host ports."
CID="$(docker run --detach --rm --network none \
  --tmpfs /var/lib/postgresql/data:rw,size=512m \
  --env POSTGRES_USER="$TEST_USER" \
  --env POSTGRES_PASSWORD=ci_only_ephemeral \
  --env POSTGRES_DB="$SOURCE_DB" \
  "$IMAGE")"

network="$(docker inspect --format '{{.HostConfig.NetworkMode}}' "$CID")"
[[ "$network" == "none" ]] || { echo "Container network isolation failed." >&2; exit 1; }

ready=0
for _ in $(seq 1 60); do
  if docker exec "$CID" pg_isready -q -U "$TEST_USER" -d "$SOURCE_DB" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo "Temporary PostGIS failed to become ready." >&2; exit 1; }

sql_file() {
  local db="$1" file="$2"
  docker exec -i "$CID" psql -X -q -v ON_ERROR_STOP=1 \
    -U "$TEST_USER" -d "$db" < "$file" > /dev/null
}
echo "Building synthetic SkyHub and DJI schemas in the disposable source database."
sql_file "$SOURCE_DB" "$ROOT/backend/db/schema.sql"
sql_file "$SOURCE_DB" "$ROOT/backend/db/migrations/001_dji_map_elements.sql"
sql_file "$SOURCE_DB" "$ROOT/tests/fixtures/postgis-restore-seed.sql"
sql_file "$SOURCE_DB" "$ROOT/tests/fixtures/postgis-restore-verify.sql"

echo "Creating a real pg_dump custom-format archive and checking its manifest."
docker exec "$CID" pg_dump -U "$TEST_USER" -d "$SOURCE_DB" \
  --format=custom --no-owner --no-acl --file=/tmp/skyhub-ci-backup.dump
docker exec "$CID" pg_restore --list /tmp/skyhub-ci-backup.dump > /dev/null

echo "Restoring into an entirely separate disposable database."
docker exec "$CID" createdb -U "$TEST_USER" "$RESTORE_DB"
docker exec "$CID" pg_restore --exit-on-error --no-owner --no-acl \
  -U "$TEST_USER" --dbname="$RESTORE_DB" /tmp/skyhub-ci-backup.dump

echo "Verifying restored workspace separation, PostGIS geometry, history and indexes."
sql_file "$RESTORE_DB" "$ROOT/tests/fixtures/postgis-restore-verify.sql"
echo "PASS: pg_dump/pg_restore roundtrip validated in temporary isolated databases."
echo "The temporary container and all backup/fixture data are removed at exit."
