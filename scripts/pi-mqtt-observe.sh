#!/usr/bin/env bash
# Read-only EMQX MQTT observation; never connects, subscribes or publishes.
# Usage: bash scripts/pi-mqtt-observe.sh [seconds] (default: 20, max: 120)
set -euo pipefail

seconds="${1:-20}"
if [[ ! "$seconds" =~ ^[0-9]+$ ]] || (( seconds < 1 || seconds > 120 )); then
  printf '%s\n' 'Usage: bash scripts/pi-mqtt-observe.sh [seconds: 1..120]' >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'ERROR: docker CLI is required.' >&2
  exit 2
fi

read_counters() {
  local metrics stats
  metrics="$(docker exec skyhub_emqx emqx ctl broker metrics)" || return 1
  stats="$(docker exec skyhub_emqx emqx ctl broker stats)" || return 1
  printf '%s\n' "$metrics" "$stats" | awk -F ':' '
    {
      key=$1; value=$2
      gsub(/[[:space:]]/, "", key)
      gsub(/[[:space:]]/, "", value)
      if (key=="messages.received" || key=="messages.delivered" ||
          key=="packets.publish.received" || key=="connections.count" ||
          key=="subscriptions.count") {
        if (value ~ /^[0-9]+$/) numbers[key]=value
      }
    }
    END {
      needed[1]="messages.received"
      needed[2]="messages.delivered"
      needed[3]="packets.publish.received"
      needed[4]="connections.count"
      needed[5]="subscriptions.count"
      for (i=1;i<=5;i++) {
        k=needed[i]
        if (!(k in numbers)) { print "Missing broker metric: " k > "/dev/stderr"; exit 1 }
      }
      printf "%s %s %s %s %s\n",
        numbers["messages.received"],numbers["messages.delivered"],
        numbers["packets.publish.received"],numbers["connections.count"],
        numbers["subscriptions.count"]
    }'
}

printf '%s\n' '=== EMQX 1884 observation (read-only, aggregate counters only) ==='
printf '%s\n' 'Checking counters at start...'
read -r recv0 delivered0 publish0 connections0 subs0 < <(read_counters)
printf 'Start: received=%s delivered=%s publish=%s connections=%s subscriptions=%s\n' \
  "$recv0" "$delivered0" "$publish0" "$connections0" "$subs0"
printf 'Observing for %s seconds; connect DJI Pilot 2 during the observation if ready.\n' "$seconds"
sleep "$seconds"
read -r recv1 delivered1 publish1 connections1 subs1 < <(read_counters)
printf 'End:   received=%s delivered=%s publish=%s connections=%s subscriptions=%s\n' \
  "$recv1" "$delivered1" "$publish1" "$connections1" "$subs1"

if (( recv1 < recv0 || delivered1 < delivered0 || publish1 < publish0 )); then
  printf '%s\n' 'NOTE: broker counters decreased; a broker restart/reset occurred or counters wrapped.'
  exit 1
fi
printf 'Delta: received=%s delivered=%s publish=%s\n' \
  "$((recv1-recv0))" "$((delivered1-delivered0))" "$((publish1-publish0))"

if (( publish1 > publish0 )); then
  printf '%s\n' 'RESULT: EMQX received MQTT PUBLISH packets. Source and DJI payload validity remain unverified.'
else
  printf '%s\n' 'RESULT: No MQTT PUBLISH packets observed. Broker subscriptions alone are not telemetry.'
fi
