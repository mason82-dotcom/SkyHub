#!/bin/sh
set -eu

valid_secret() {
  value=$1
  [ "${#value}" -ge 24 ] && printf '%s' "$value" | grep -Eq '^[A-Za-z0-9._~!@%+=:-]+$'
}

if ! valid_secret "${MQTT_CORE_PASSWORD:-}"; then
  echo "MQTT_CORE_PASSWORD must be at least 24 URL-safe characters" >&2
  exit 1
fi
if ! valid_secret "${MQTT_GATEWAY_PASSWORD:-}"; then
  echo "MQTT_GATEWAY_PASSWORD must be at least 24 URL-safe characters" >&2
  exit 1
fi

umask 077
target=/opt/emqx/data/auth-built-in-db-bootstrap.csv
{
  printf '%s\n' 'user_id,password,is_superuser'
  printf 'skyhub-core,%s,false\n' "$MQTT_CORE_PASSWORD"
  printf 'dji-gateway,%s,false\n' "$MQTT_GATEWAY_PASSWORD"
} > "$target"
chown 1000:1000 "$target"
chmod 600 "$target"
