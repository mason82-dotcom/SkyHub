#!/usr/bin/env bash
# Explicit opt-in command wrapper; never starts/changes the Raspberry Pi production stack.
set -euo pipefail
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$HERE/../.." && pwd)"
ENV_FILE="$HERE/lab.env"
PROJECT="skyhub-hivemind-lab"

usage() {
  echo "Usage: bash simulators/hivemind/lab.sh init-env|prepare|config|up|smoke|ps|logs|down"
  echo "Only 'up' starts containers. 'down' preserves all named volumes."
}
if [[ $# -ne 1 ]]; then usage; exit 2; fi

case "$1" in
  init-env)
    command -v openssl >/dev/null || { echo "openssl is required" >&2; exit 2; }
    if [[ -e "$ENV_FILE" ]]; then
      echo "Local lab.env already exists; refusing overwrite" >&2
      exit 2
    fi
    umask 077
    ( set -C
      cat > "$ENV_FILE" <<EOF
# Disposable lab only; do NOT copy real DJI or broker credentials.
SKYHUB_VIEW_TOKEN=$(openssl rand -hex 32)
SKYHUB_DB_PASSWORD=$(openssl rand -hex 32)
SKYHUB_MINIO_USER=lab_minio
SKYHUB_MINIO_PASSWORD=$(openssl rand -hex 32)
MQTT_BROKER_URL=mqtt://hivemind-broker:1884
MQTT_USER=
MQTT_PASSWORD=
SKYHUB_HTTP_PORT=14001
SKYHUB_BIND_ADDRESS=127.0.0.1
SKYHUB_PILOT_ENABLED=false
SKYHUB_TOPOLOGY_ACK_ENABLED=false
SKYHUB_TRACK_RECORDING_ENABLED=false
SKYHUB_LAN_VIEW_CIDR=
EOF
    )
    echo "Created private lab.env (credentials not shown)."
    exit 0
    ;;
  prepare)
    exec bash "$HERE/prepare.sh"
    ;;
  config|up|smoke|ps|logs|down)
    ;;
  *)
    usage
    exit 2
    ;;
esac

command -v docker >/dev/null || { echo "docker is required" >&2; exit 2; }
if [[ ! -f "$ENV_FILE" ]]; then
  echo "No lab.env found. Run: bash simulators/hivemind/lab.sh init-env" >&2
  exit 2
fi
# Reject a copied production .env. Never load this file with 'source' or print secrets.
for expected in \
  'MQTT_BROKER_URL=mqtt://hivemind-broker:1884' \
  'SKYHUB_HTTP_PORT=14001' \
  'SKYHUB_BIND_ADDRESS=127.0.0.1' \
  'SKYHUB_PILOT_ENABLED=false' \
  'SKYHUB_TOPOLOGY_ACK_ENABLED=false' \
  'SKYHUB_TRACK_RECORDING_ENABLED=false'; do
  if ! grep -Fxq -- "$expected" "$ENV_FILE"; then
    echo "Lab isolation guard failed (missing expected lab setting)" >&2
    exit 2
  fi
done
# Shell variables override Compose env-file values; force all isolation-sensitive settings.
export MQTT_BROKER_URL=mqtt://hivemind-broker:1884
export SKYHUB_HTTP_PORT=14001 SKYHUB_BIND_ADDRESS=127.0.0.1
export SKYHUB_PILOT_ENABLED=false SKYHUB_TOPOLOGY_ACK_ENABLED=false
export SKYHUB_TRACK_RECORDING_ENABLED=false SKYHUB_LAN_VIEW_CIDR=
unset SKYHUB_VIEW_TOKEN SKYHUB_DB_PASSWORD SKYHUB_MINIO_USER SKYHUB_MINIO_PASSWORD
unset MQTT_USER MQTT_PASSWORD COMPOSE_PROFILES

cd "$ROOT"
compose=(docker compose --project-name "$PROJECT" --env-file "$ENV_FILE" \
  -f docker-compose.yml -f simulators/hivemind/compose.lab.yml)
case "$1" in
  config)
    "${compose[@]}" config --quiet
    echo "Lab Compose syntax OK (no containers started)."
    ;;
  up)
    if [[ ! -s "$HERE/.upstream/target/dji-dock-simulator-1.4.10.jar" ]]; then
      echo "Prepare pinned upstream first: bash simulators/hivemind/lab.sh prepare" >&2
      exit 2
    fi
    "${compose[@]}" config --quiet
    "${compose[@]}" up -d --build
    echo "Lab: simulator http://127.0.0.1:19090 and SkyHub http://127.0.0.1:14001"
    ;;
  smoke)
    command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 2; }
    "${compose[@]}" config --quiet
    exec python3 "$HERE/smoke.py"
    ;;
  ps) "${compose[@]}" ps --all ;;
  logs) "${compose[@]}" logs --tail=80 ;;
  down)
    "${compose[@]}" down
    echo "Lab stopped; named volumes retained (no -v)."
    ;;
esac
