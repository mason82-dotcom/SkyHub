#!/usr/bin/env bash
# Read-only TLS diagnostic for existing Caddy / DJI Pilot 2 development.
# No CA installation, no TLS bypass, no changes to Caddy or live services.
# Usage: bash scripts/pi-tls-audit.sh [hostname] [pi-ip] [port]
set -euo pipefail

hostname="${1:-rpi5.fritz.box}"
ip="${2:-192.168.178.63}"
port="${3:-443}"

if [[ ! "$hostname" =~ ^[A-Za-z0-9.-]+$ ]] ||
   [[ ! "$ip" =~ ^[0-9a-fA-F:.]+$ ]] ||
   [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1 || port > 65535 )); then
  printf '%s\n' 'Invalid host/IP/port input' >&2
  exit 2
fi
for cmd in openssl curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    printf 'Missing command: %s\n' "$cmd" >&2
    exit 2
  fi
done

printf '%s\n' '=== Presented Caddy certificate (public metadata) ==='
printf 'Hostname: %s | Pi address: %s | Port: %s\n' "$hostname" "$ip" "$port"
if ! openssl s_client -connect "$ip:$port" -servername "$hostname" -showcerts </dev/null 2>/dev/null |
     openssl x509 -noout -subject -issuer -dates -ext subjectAltName; then
  printf '%s\n' 'ERROR: Cannot inspect the presented TLS certificate.' >&2
  exit 1
fi

args=(--noproxy '*' --silent --show-error --head --output /dev/null --max-time 12
      --resolve "$hostname:$port:$ip" --write-out '%{http_code}')
url="https://$hostname:$port/"

printf '\n%s\n' '=== Pi system CA trust (no --insecure) ==='
if code="$(curl "${args[@]}" "$url")"; then
  printf 'PASS: Pi system CA trusts this HTTPS endpoint (HTTP %s).\n' "$code"
  system_ok=true
else
  printf '%s\n' 'FAIL: Pi system CA does not verify the endpoint or HTTPS is unreachable.'
  system_ok=false
fi

printf '\n%s\n' '=== Explicit public Caddy root CA verification (no installation) ==='
root="/data/caddy/pki/authorities/local/root.crt"
if command -v docker >/dev/null 2>&1 &&
   docker exec caddy test -r "$root" 2>/dev/null; then
  tmp="$(mktemp)"
  chmod 600 "$tmp"
  trap 'rm -f "$tmp"' EXIT
  if docker exec caddy cat "$root" >"$tmp"; then
    if code="$(curl "${args[@]}" --cacert "$tmp" "$url")"; then
      printf 'PASS: HTTPS validates using the public Caddy root certificate (HTTP %s).\n' "$code"
      printf '%s\n' 'Interpretation: the certificate chain/hostname can be verified when Caddy CA is explicitly trusted.'
    else
      printf '%s\n' 'FAIL: Even explicit Caddy root CA verification failed. Check presented intermediate and hostname.'
      exit 1
    fi
  else
    printf '%s\n' 'WARNING: Unable to retrieve the public root.crt from Caddy.'
  fi
else
  printf '%s\n' 'INFO: Caddy root.crt not accessible; explicit CA verification skipped.'
fi
printf '\n'
if [[ "$system_ok" == true ]]; then
  printf '%s\n' 'RESULT: Pi HTTPS trust passed. DJI Pilot 2 trust remains untested.'
else
  printf '%s\n' 'RESULT: Pi system trust failed. Explicit root verification above does not alter system or DJI trust.'
fi
printf '%s\n' 'No Caddy changes made, no secrets or private keys read. Do not use curl -k for DJI bootstrap.'
