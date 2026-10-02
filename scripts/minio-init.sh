#!/bin/sh
set -e
until mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1; do
  echo "warte auf MinIO..."; sleep 2
done
mc mb --ignore-existing "local/$MINIO_BUCKET"
if mc admin user info local "$MINIO_STS_USER" >/dev/null 2>&1; then
  echo "MinIO user $MINIO_STS_USER existiert bereits"
else
  mc admin user add local "$MINIO_STS_USER" "$MINIO_STS_PASSWORD"
fi
mc admin policy attach local readwrite --user "$MINIO_STS_USER" 2>/dev/null || true
echo "MinIO init fertig"
