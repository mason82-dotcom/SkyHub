#!/bin/sh
# Einmalig ausfuehren: erzeugt Mosquitto-Passwort/ACL + Datenordner.
# .env wird absichtlich NICHT als Shell-Code gesourct.
set -eu
cd "$(dirname "$0")/.."

[ -f .env ] || { echo ".env fehlt (cp .env.example .env)"; exit 1; }

mkdir -p data/postgres data/mosquitto data/minio

docker run --rm \
  --env-file .env \
  -v "$(pwd)/mosquitto/config:/mosquitto/config" \
  eclipse-mosquitto:2.0.20 sh -eu -c '
    validate_mqtt_user() {
      name="$1"
      value="$2"
      case "$value" in
        ""|*[!A-Za-z0-9._-]*)
          echo "$name enthaelt unzulaessige Zeichen; erlaubt: A-Z a-z 0-9 . _ -"
          exit 1
          ;;
      esac
    }

    validate_mqtt_user MQTT_BACKEND_USER "${MQTT_BACKEND_USER:-}"
    validate_mqtt_user MQTT_PILOT_USER "${MQTT_PILOT_USER:-}"
    [ "$MQTT_BACKEND_USER" != "$MQTT_PILOT_USER" ] || {
      echo "MQTT_BACKEND_USER und MQTT_PILOT_USER muessen verschieden sein"
      exit 1
    }
    [ -n "${MQTT_BACKEND_PASSWORD:-}" ] || {
      echo "MQTT_BACKEND_PASSWORD fehlt"
      exit 1
    }
    [ -n "${MQTT_PILOT_PASSWORD:-}" ] || {
      echo "MQTT_PILOT_PASSWORD fehlt"
      exit 1
    }

    mosquitto_passwd -b -c /mosquitto/config/passwd       "$MQTT_BACKEND_USER" "$MQTT_BACKEND_PASSWORD"
    mosquitto_passwd -b /mosquitto/config/passwd       "$MQTT_PILOT_USER" "$MQTT_PILOT_PASSWORD"
    chown 1883:1883 /mosquitto/config/passwd
    chmod 0640 /mosquitto/config/passwd

    sed       -e "s/__BACKEND_USER__/$MQTT_BACKEND_USER/g"       -e "s/__PILOT_USER__/$MQTT_PILOT_USER/g"       /mosquitto/config/acl.template > /mosquitto/config/acl.tmp
    chown 1883:1883 /mosquitto/config/acl.tmp
    chmod 0640 /mosquitto/config/acl.tmp
    mv /mosquitto/config/acl.tmp /mosquitto/config/acl
  '

echo "OK - Mosquitto Passwortdatei und ACL erzeugt"
echo "Jetzt: docker compose up -d --build"
