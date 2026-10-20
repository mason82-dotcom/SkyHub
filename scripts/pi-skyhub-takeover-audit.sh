#!/usr/bin/env bash
# Read-only audit before transferring the legacy SkyHub HTTP endpoint to SkyHub Next.
# NEVER stops, renames, updates or restarts containers; never prints environment values.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=== Takeover audit: Git checkout ==="
git branch --show-current
git log -1 --format='%h %s'
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "WARNING: tracked local changes found; do not run an automated cutover."
fi

echo
echo "=== Existing SkyHub runtime (metadata only, no secrets) ==="
for name in skyhub_backend skyhub_emqx skyhub_postgres skyhub_redis; do
  if docker inspect "$name" >/dev/null 2>&1; then
    docker inspect --format \
      '{{.Name}} | state={{.State.Status}} | restart={{.HostConfig.RestartPolicy.Name}} | image={{.Config.Image}}' "$name"
    docker inspect --format \
      '{{range .Mounts}}  mount: {{.Type}} -> {{.Destination}}{{println}}{{end}}' "$name"
  else
    printf 'MISSING: %s\n' "$name"
  fi
done

echo
echo "=== HTTP ports and listening addresses ==="
ss -ltnH | awk '$4 ~ /:(1883|1884|4000|4001|443)$/ {print $4}' | sort -u

echo
echo "=== Legacy SkyHub response codes (GET only) ==="
for endpoint in / /pilot-login /api/health; do
  code="$(curl --noproxy '*' --silent --max-time 4 -o /dev/null \
    -w '%{http_code}' "http://127.0.0.1:4000$endpoint" || true)"
  printf '%-17s HTTP %s\n' "$endpoint" "$code"
done

echo
echo "=== Next Compose project status (read-only) ==="
docker compose ps --all --format 'table {{.Name}}\t{{.State}}\t{{.Ports}}' || true

echo
echo "=== New secrets file (names/flags only; never values) ==="
if [[ -f .env ]]; then
  stat -c 'permissions=%a owner=%U' .env
  python3 - <<'PY'
from pathlib import Path
lines=Path('.env').read_text().splitlines()
d={}
for line in lines:
    line=line.strip()
    if not line or line.startswith('#') or '=' not in line: continue
    name,value=line.split('=',1)
    d[name.strip()]=value.strip()
required=('SKYHUB_VIEW_TOKEN','SKYHUB_DB_PASSWORD','MQTT_BROKER_URL','MQTT_USER','MQTT_PASSWORD')
for k in required:
    v=d.get(k,'')
    state='missing' if not v else ('placeholder' if v.startswith('REPLACE_') else 'set')
    print(f'{k}: {state}')
for k in ('SKYHUB_DJI_APP_ID','SKYHUB_DJI_APP_KEY','SKYHUB_DJI_APP_LICENSE'):
    v=d.get(k,'')
    print(f'{k}: {"set" if v and not v.startswith("REPLACE_") else "not ready"}')
print('Pilot 2 bootstrap enabled:',d.get('SKYHUB_PILOT_ENABLED','false').lower()=='true')
print('SkyHub HTTP bind configured:', 'yes' if 'SKYHUB_BIND_ADDRESS' in d else 'default')
print('SkyHub HTTP port configured:', 'yes' if 'SKYHUB_HTTP_PORT' in d else 'default')
PY
else
  echo 'ERROR: .env is missing. Do not start Next.'
fi

echo
echo "=== Configuration validation (no deployment) ==="
docker compose config --quiet && echo 'OK: Compose configuration syntactically valid.'
echo 'AUDIT COMPLETE: No live service modified. Do not cut over before backup and staging validation.'
