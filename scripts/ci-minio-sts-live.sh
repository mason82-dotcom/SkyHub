#!/usr/bin/env bash
set -euo pipefail

# Isolated CI only. Never reads SkyHub/Pi MinIO credentials or touches their volumes.
if [[ "${CI:-}" != "true" || "${SKYHUB_STS_CI_ISOLATED:-}" != "true" ]]; then
  echo 'Isolated CI guard required' >&2
  exit 2
fi
TEMP="$(mktemp -d)"
NETWORK="skyhub-sts-ci-${GITHUB_RUN_ID:-local}"
SERVER="skyhub-sts-minio-${GITHUB_RUN_ID:-local}"
cleanup(){
  docker rm -f "$SERVER" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
  rm -rf -- "$TEMP"
}
trap cleanup EXIT
mkdir -p "$TEMP/certs"
openssl req -x509 -newkey rsa:2048 -sha256 -days 1 -nodes \
  -subj '/CN=skyhub-sts-minio' \
  -addext "subjectAltName=IP:127.0.0.1,DNS:$SERVER" \
  -keyout "$TEMP/certs/private.key" \
  -out "$TEMP/certs/public.crt" >/dev/null 2>&1
chmod 644 "$TEMP/certs/"{private.key,public.crt}

docker network create "$NETWORK" >/dev/null
docker run -d --name "$SERVER" --network "$NETWORK" \
  -p 127.0.0.1:19010:9000 \
  -v "$TEMP/certs:/certs:ro" \
  -e MINIO_ROOT_USER=ci_sts_root \
  -e MINIO_ROOT_PASSWORD=ci_sts_root_only_not_production_2026 \
  minio/minio:RELEASE.2023-09-04T19-57-37Z \
  server --certs-dir /certs /data >/dev/null

healthy=false
for _ in $(seq 1 45); do
  if curl --silent --fail --cacert "$TEMP/certs/public.crt" \
    https://127.0.0.1:19010/minio/health/live >/dev/null; then
    healthy=true
    break
  fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  echo 'Disposable MinIO failed TLS health check' >&2
  exit 1
fi

mc(){
  docker run --rm --network "$NETWORK" \
    -e "MC_HOST_ci=https://ci_sts_root:ci_sts_root_only_not_production_2026@$SERVER:9000" \
    -v "$PWD/scripts/ci-minio-sts-parent-policy.json:/policy.json:ro" \
    minio/mc:latest --insecure "$@"
}
mc mb ci/dji-cloud >/dev/null
mc admin user add ci skyhub_sts_ci_upload ci_sts_upload_only_not_production_2026 >/dev/null
mc admin policy create ci ci-sts-put-only /policy.json >/dev/null
mc admin policy attach ci ci-sts-put-only --user skyhub_sts_ci_upload >/dev/null

export NODE_EXTRA_CA_CERTS="$TEMP/certs/public.crt"
export SKYHUB_STS_CI_UPLOAD_SECRET=ci_sts_upload_only_not_production_2026
node scripts/ci-minio-sts-live.js
