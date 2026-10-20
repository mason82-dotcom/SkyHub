#!/usr/bin/env bash
# Updates only the existing SkyHub Next BACKEND on a Raspberry Pi.
# No docker volume removal, no database migrations 001/002, no broker changes.
# Run from a verified local main checkout: bash scripts/pi-update-backend.sh --apply
set -Eeuo pipefail
umask 077

if [[ "${1:-}" != "--apply" || "$#" -ne 1 ]]; then
  echo "Usage: bash scripts/pi-update-backend.sh --apply" >&2
  echo "This operation backs up local configuration and PostGIS, builds and recreates" >&2
  echo "ONLY the existing skyhub-next backend container." >&2
  exit 2
fi
if [[ "$(uname -s)" != Linux || "$(uname -m)" != aarch64 ]]; then
  echo "REFUSED: run on the Raspberry Pi Linux ARM64 host only." >&2;exit 2
fi
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
if [[ ! -f .env ]]; then
  echo "REFUSED: local .env missing (do not replace it with .env.example)." >&2;exit 2
fi
if [[ "$(git branch --show-current)" != main || -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "REFUSED: main branch and clean tracked working tree required." >&2;exit 2
fi
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "REFUSED: current HEAD does not match fetched origin/main." >&2;exit 2
fi
for cmd in docker curl git python3;do
  command -v "$cmd" >/dev/null || { echo "Missing prerequisite: $cmd" >&2;exit 2; }
done
docker info >/dev/null
if ! bash scripts/pi-preflight.sh;then
  echo "REFUSED: Pi preflight failed; existing services were not changed." >&2;exit 2
fi
compose=(docker compose -p skyhub-next --env-file .env)
"${compose[@]}" config --quiet
backend_id="$("${compose[@]}" ps -q backend)"
postgres_id="$("${compose[@]}" ps -q postgres)"
redis_id="$("${compose[@]}" ps -q redis)"
if [[ -z "$backend_id" || -z "$postgres_id" || -z "$redis_id" ]];then
  echo "REFUSED: expected running SkyHub Next backend, Postgres and Redis required." >&2;exit 2
fi
for id in "$backend_id" "$postgres_id" "$redis_id";do
  state="$(docker inspect -f '{{.State.Running}}' "$id")"
  [[ "$state" == true ]] || { echo "REFUSED: expected container is not running." >&2;exit 2; }
done
backend_name="$(docker inspect -f '{{.Name}}' "$backend_id")"
if [[ "$backend_name" != /skyhub-next-backend-1 ]];then
  echo "REFUSED: unexpected backend container owner." >&2;exit 2
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$HOME/Projekte/_backups/skyhub-next/$stamp"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
cp -p .env "$backup_dir/.env"
if [[ -f docker-compose.override.yml ]];then
  cp -p docker-compose.override.yml "$backup_dir/docker-compose.override.yml"
fi
printf '%s\n' "$(git rev-parse HEAD)" > "$backup_dir/source-commit.txt"
old_image="$(docker inspect -f '{{.Image}}' "$backend_id")"
backup_tag="skyhub-next-backend-preupdate:$stamp"
docker image tag "$old_image" "$backup_tag"
printf '%s\n' "$backup_tag" > "$backup_dir/previous-image-tag.txt"

echo "Saving a custom-format Postgres database dump (contains real data; keep private)."
if ! "${compose[@]}" exec -T postgres pg_dump -U skyhub_next -d skyhub_next -Fc > "$backup_dir/postgis.dump";then
  rm -f "$backup_dir/postgis.dump"
  echo "REFUSED: Postgres backup failed. Existing containers unchanged." >&2;exit 1
fi
if [[ ! -s "$backup_dir/postgis.dump" ]];then
  echo "REFUSED: backup appears empty. Existing containers unchanged." >&2;exit 1
fi

echo "Building backend from the locked dependencies; Postgres, Redis and EMQX untouched."
"${compose[@]}" build backend
echo "Recreating the SkyHub Next backend only."
"${compose[@]}" up -d --no-deps --no-build backend

ok=0
for i in $(seq 1 20);do
  if health="$(curl -fsS --max-time 4 http://127.0.0.1:4001/api/health 2>/dev/null)" &&
    python3 -c 'import sys,json; h=json.load(sys.stdin); assert h.get("readOnly") is True and h.get("status") in ("online","degraded")' <<< "$health";then
    ok=1;break
  fi
  sleep 2
done
if [[ "$ok" != 1 ]];then
  echo "ERROR: expected read-only /api/health did not recover." >&2
  echo "Previous backend image was retained as: $backup_tag" >&2
  echo "Backups: $backup_dir" >&2
  echo "Inspect: docker compose -p skyhub-next logs --tail=100 backend" >&2
  exit 1
fi
echo "SUCCESS: new SkyHub Next backend answers the read-only health endpoint."
echo "Postgres, Redis, EMQX and Caddy were not recreated by this script."
echo "Backup directory (PRIVATE): $backup_dir"
echo "Previous backend image: $backup_tag"
