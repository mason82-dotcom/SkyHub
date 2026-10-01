#!/bin/sh
# Einmalig ausfuehren: erzeugt Mosquitto-Passwortdatei + Datenordner
set -e
cd "$(dirname "$0")/.."
[ -f .env ] || { echo ".env fehlt (cp .env.example .env)"; exit 1; }
set -a; . ./.env; set +a
mkdir -p data/postgres data/mosquitto data/minio
docker run --rm -v "$(pwd)/mosquitto/config:/mosquitto/config" eclipse-mosquitto:2.0.20 sh -c \
  "mosquitto_passwd -b -c /mosquitto/config/passwd '$MQTT_BACKEND_USER' '$MQTT_BACKEND_PASSWORD' && \
   mosquitto_passwd -b /mosquitto/config/passwd '$MQTT_PILOT_USER' '$MQTT_PILOT_PASSWORD' && \
   chmod 0700 /mosquitto/config/passwd"
echo "OK - jetzt: docker compose up -d --build"
