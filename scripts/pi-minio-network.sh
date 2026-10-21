#!/usr/bin/env bash
# Opt-in Raspberry Pi MinIO network integration.
# Default is read-only. No docker compose down, volumes rm, or container restart.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
NETWORK="skyhub-storage-net"
PROJECT="skyhub-next"
COMPOSE=(
  docker compose --project-name "$PROJECT"
  --env-file "$ROOT/.env"
  -f "$ROOT/docker-compose.yml"
  -f "$ROOT/docker-compose.storage.yml"
  --profile media
)

usage() {
  cat <<'USAGE'
Usage: bash scripts/pi-minio-network.sh [plan|apply [--allow-legacy-image]|attach CONTAINER...|verify]
  plan      Read-only inventory; does not create a network or run a container.
  apply     Create the shared network, start ONLY SkyHub MinIO, connect a running
            SkyHub Next backend if present. Does NOT recreate the backend.
  attach    Explicitly join named existing application containers to the shared
            bridge. Does not restart them or pass credentials.
  verify    Read-only inspect + MinIO HTTP readiness check through SkyHub backend.
  --allow-legacy-image: FOR ISOLATED TESTS ONLY; 2023 MinIO is not supported.
Never pass secrets as command-line arguments. Do not paste .env into logs.
USAGE
}

require_docker() {
  command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not found" >&2; exit 2; }
  docker info >/dev/null 2>&1 || { echo "ERROR: Docker daemon inaccessible" >&2; exit 2; }
}

network_exists() { docker network inspect "$NETWORK" >/dev/null 2>&1; }

check_network() {
  if network_exists; then
    local driver
    driver="$(docker network inspect --format '{{.Driver}}' "$NETWORK")"
    [[ "$driver" == "bridge" ]] || {
      echo "ERROR: $NETWORK exists but is not a bridge (driver: $driver)" >&2
      exit 2
    }
  fi
}

is_connected() {
  [[ "$(docker inspect --format '{{if index .NetworkSettings.Networks "skyhub-storage-net"}}yes{{else}}no{{end}}' "$1")" == yes ]]
}

single_running_service() {
  local service="$1"
  local -a ids=()
  mapfile -t ids < <(
    docker ps --filter "label=com.docker.compose.project=$PROJECT" \
      --filter "label=com.docker.compose.service=$service" --format '{{.ID}}'
  )
  if (( ${#ids[@]} > 1 )); then
    echo "ERROR: multiple running containers for $PROJECT/$service; refusing ambiguous operation" >&2
    exit 2
  fi
  if (( ${#ids[@]} == 1 )); then printf '%s\n' "${ids[0]}"; fi
}

connect_existing() {
  local target="$1"
  if is_connected "$target"; then
    echo "OK: container already attached to $NETWORK"
  else
    docker network connect "$NETWORK" "$target"
    echo "OK: attached container to $NETWORK (connection may be lost on recreation)"
  fi
}

plan() {
  printf '=== Shared MinIO preflight (read-only) ===\n'
  if network_exists; then
    check_network
    echo "Network: $NETWORK (exists)"
  else
    echo "Network: $NETWORK (not created)"
  fi
  echo "MinIO-like containers (name / image, including stopped):"
  docker ps -a --format '{{.Names}} {{.Image}}' |
    awk '{ line=tolower($0); if (line ~ /minio|aistor/) print }'
  if docker volume inspect "${PROJECT}_minio_data" >/dev/null 2>&1; then
    echo "Existing SkyHub MinIO volume: present (will be preserved)"
  else
    echo "Existing SkyHub MinIO volume: absent (first start creates it)"
  fi
  if [[ -f "$ROOT/.env" ]]; then
    if "${COMPOSE[@]}" config --quiet >/dev/null; then
      echo "Combined Compose configuration: valid (credentials not printed)"
    else
      echo "ERROR: combined Compose configuration invalid" >&2
      return 2
    fi
  else
    echo "WARNING: .env missing; cannot validate deployment configuration"
  fi
  echo "No containers, networks or volumes were modified."
}

apply() {
  [[ "${1:-}" == "" || "${1:-}" == "--allow-legacy-image" ]] || { usage; exit 2; }
  [[ -f "$ROOT/.env" ]] || { echo "ERROR: private .env missing" >&2; exit 2; }
  command -v python3 >/dev/null || { echo "ERROR: python3 required" >&2; exit 2; }
  "${COMPOSE[@]}" config --quiet >/dev/null
  check_network

  # Multiple MinIO installations could mean existing data must be reused,
  # not silently replaced with a second empty instance.
  local other
  other="$(docker ps -a --format '{{.Names}} {{.Image}}' |
    awk '{ line=tolower($0); if (line ~ /minio|aistor/ && $1 !~ /^skyhub-next-minio-[0-9]+$/) print $1 }')"
  [[ -z "$other" ]] || {
    echo "ERROR: other MinIO-like containers found; audit/reuse them before deploying another:" >&2
    printf '%s\n' "$other" >&2
    exit 2
  }

  local image
  image="$("${COMPOSE[@]}" config --format json |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["minio"]["image"])')"
  if [[ "$image" == "minio/minio:RELEASE.2023-09-04T19-57-37Z" &&
        "${1:-}" != "--allow-legacy-image" ]]; then
    echo "ERROR: 2023 MinIO image is obsolete; choose a reviewed, ARM64-capable" >&2
    echo "SKYHUB_MINIO_IMAGE in private .env, or use --allow-legacy-image for isolated tests." >&2
    exit 2
  fi
  if ! network_exists; then
    docker network create --driver bridge "$NETWORK" >/dev/null
    echo "Created shared Docker bridge: $NETWORK"
  fi
  # Restrict to MinIO: no backend/Postgres/Redis/EMQX re-creation.
  "${COMPOSE[@]}" up -d --no-deps minio

  local backend
  backend="$(single_running_service backend)"
  if [[ -n "$backend" ]]; then
    connect_existing "$backend"
  else
    echo "INFO: SkyHub backend not running; it can be attached later."
  fi
  echo "Storage endpoint for joined containers: http://skyhub-minio:9000"
  echo "No buckets, IAM users or application media APIs were created."
}

attach() {
  (( $# > 0 )) || { echo "ERROR: supply at least one container name" >&2; exit 2; }
  network_exists || { echo "ERROR: $NETWORK missing; run plan then apply" >&2; exit 2; }
  check_network
  local name running
  for name in "$@"; do
    [[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || {
      echo "ERROR: invalid container name" >&2; exit 2;
    }
    case "${name,,}" in
      *minio*|*aistor*|*postgres*|*redis*|*emqx*|*mosquitto*|*caddy*)
        echo "ERROR: infrastructure container '$name' is not an S3 client" >&2
        exit 2 ;;
    esac
    running="$(docker inspect --format '{{.State.Running}}' "$name" 2>/dev/null)" || {
      echo "ERROR: container '$name' not found" >&2; exit 2;
    }
    [[ "$running" == true ]] || {
      echo "ERROR: '$name' is not running" >&2; exit 2;
    }
  done
  # Complete validation of every target before the first network mutation.
  for name in "$@"; do
    connect_existing "$name"
  done
}

verify() {
  network_exists || { echo "ERROR: shared network missing" >&2; exit 1; }
  check_network
  local minio backend
  minio="$(single_running_service minio)"
  [[ -n "$minio" ]] || { echo "ERROR: SkyHub MinIO is not running" >&2; exit 1; }
  is_connected "$minio" || { echo "ERROR: MinIO not on shared network" >&2; exit 1; }
  backend="$(single_running_service backend)"
  [[ -n "$backend" ]] || { echo "ERROR: no running SkyHub backend available for S3 readiness probe" >&2; exit 1; }
  is_connected "$backend" || { echo "ERROR: backend not on shared network" >&2; exit 1; }
  docker exec "$backend" node -e '
    fetch("http://skyhub-minio:9000/minio/health/ready",
      {signal: AbortSignal.timeout(5000)})
    .then(r => { console.log("MinIO readiness HTTP: " + r.status);
      process.exit(r.ok ? 0 : 1); })
    .catch(() => { console.error("MinIO readiness unreachable"); process.exit(1); });
  '
}

mode="${1:-plan}"
shift "$(( $# > 0 ? 1 : 0 ))"
case "$mode" in
  -h|--help|help) usage ;;
  plan) (( $# == 0 )) || { usage; exit 2; }; require_docker; plan ;;
  apply) require_docker; apply "$@" ;;
  attach) require_docker; attach "$@" ;;
  verify) (( $# == 0 )) || { usage; exit 2; }; require_docker; verify ;;
  *) usage >&2; exit 2 ;;
esac
