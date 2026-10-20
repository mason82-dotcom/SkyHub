#!/usr/bin/env bash
# Read-only preflight for the Raspberry Pi deployment.
# Checks listener topology only. Does not contact DJI hardware, disclose secrets,
# start/stop Docker services, or publish MQTT messages.
set -u

if ! command -v ss >/dev/null 2>&1; then
  printf 'ERROR: ss (iproute2) is required for the Pi preflight.\n' >&2
  exit 2
fi

listening() {
  local port="$1"
  ss -ltnH | awk -v suffix=":$port" '$4 ~ suffix "$" { found=1 } END { exit !found }'
}

result=0
printf '%s\n' '=== SkyHub Raspberry Pi preflight (read-only) ==='
printf '%s\n' 'Required DJI MQTT broker: EMQX on host TCP 1884'
if listening 1884; then
  printf '%s\n' 'OK: TCP 1884 is listening.'
else
  printf '%s\n' 'ERROR: TCP 1884 is not listening. Do not deploy SkyHub Next.' >&2
  result=1
fi
if listening 1883; then
  printf '%s\n' 'INFO: TCP 1883 also listens. This may be the independent Mosquitto broker; it is NOT the SkyHub MQTT target.'
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    mapping="$(docker port skyhub_emqx 1883/tcp 2>/dev/null || true)"
    if printf '%s\n' "$mapping" | grep -Eq ':1884$'; then
      printf '%s\n' 'OK: skyhub_emqx publishes container TCP 1883 as host TCP 1884.'
    else
      printf '%s\n' 'WARNING: skyhub_emqx:1883 -> host:1884 mapping could not be confirmed.'
      result=1
    fi
    if docker ps --filter 'name=^/skyhub_backend$' --format '{{.Names}}' | grep -qx skyhub_backend; then
      printf '%s\n' 'INFO: Existing skyhub_backend is running; do not replace its HTTP port.'
    fi
  else
    printf '%s\n' 'WARNING: Docker daemon is not accessible to this user; container mapping not verified.'
    result=1
  fi
else
  printf '%s\n' 'WARNING: docker command is unavailable; container mapping not verified.'
  result=1
fi

if listening 4000; then
  printf '%s\n' 'INFO: TCP 4000 is occupied by the existing deployment; SkyHub Next must not bind it.'
fi
if listening 4001; then
  printf '%s\n' 'ERROR: TCP 4001 is already occupied; choose another free SKYHUB_HTTP_PORT before deployment.' >&2
  result=1
else
  printf '%s\n' 'OK: TCP 4001 has no listener currently (does not reserve the port).'
fi

if [ "$result" -eq 0 ]; then
  printf '%s\n' 'Preflight checks passed. MQTT authentication, topic traffic and device telemetry remain unverified.'
else
  printf '%s\n' 'Preflight detected issues. Existing services were not changed.'
fi
exit "$result"
