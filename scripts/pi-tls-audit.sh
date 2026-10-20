#!/usr/bin/env bash
# Read-only TLS audit for the existing Caddy host. Does not print keys
# or access any privileged Caddy storage; does not change Caddy routing.
# Usage: bash scripts/pi-tls-audit.sh [hostname] [pi-ip] [https-port]
set -euo pipefail

host="${1:-rpi5.fritz.box}"
ip="${2:-192.168.178.63}"
port="${3:-443}"

if [[ ! "$host" =~ ^[A-Za-z0-9.-]+$ ]] ||
   [[ ! "$ip" =~ ^[0-9a-fA-F:.]+$ ]] ||
   [[ ! "$port" =~ ^[0-9]+$ ]] || (( port<1 || port>65535 )); then
  echo "Usage: bash scripts/pi-tls-audit.sh [valid-hostname] [numeric-ip] [port]" >&2
  exit 2
fi
if ! command -v openssl >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
  echo "ERROR: openssl and curl must be installed" >&2
  exit 2
fi

echo "=== Caddy TLS certificate (metadata only) ==="
echo "Host: $host"
echo "Pi address: $ip"
echo "HTTPS port: $port"
# No -k/-insecure flag. The extracted certificate is public metadata only.
if ! openssl s_client -connect "$ip:$port" -servername "$host" -showcerts </dev/null 2>/dev/null |
     openssl x509 -noout -subject -issuer -dates -ext subjectAltName; then
  echo "ERROR: could not read the presented HTTPS certificate" >&2
  exit 1
fi

echo
echo "=== Verify HTTPS hostname and CA trust on THIS Raspberry Pi ==="
if curl --noproxy '*' --silent --show-error --head --output /dev/null \
  --max-time 10 --resolve "$host:$port:$ip" \
  --write-out 'HTTP %{http_code} / TLS verification passed\n' \
  "https://$host:$port/"; then
  echo "INFO: Hostname and CA trust were accepted by curl on this Pi."
  echo "IMPORTANT: DJI Pilot 2 on its separate Android device may use a different trust store."
else
  echo "WARNING: Pi curl did not verify or reach the HTTPS endpoint."
  echo "         Check hostname, chain, local CA trust and listener."
  echo "         Never bypass TLS validation for DJI license or MQTT credentials."
  echo "         This does not prove or disprove DJI Pilot 2's own CA trust."
  exit 1
fi
