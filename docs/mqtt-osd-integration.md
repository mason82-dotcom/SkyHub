# MQTT / OSD integration – SkyHub Next 0.1.0

## Upstream reference

Functionality was reviewed against [OmerMersin/dji-cloud-platform-minimal](https://github.com/OmerMersin/dji-cloud-platform-minimal) (MIT License, © 2025 Ömer Mersin), particularly `mqtt_client.py` and `public/dashboard.html`.

The reference project **does not implement an MQTT broker**: it uses EMQX plus a Python/Paho MQTT subscriber. SkyHub Next keeps its existing EMQX instance and Node.js/MQTT.js backend. The implementation was adapted to SkyHub Next's security model, not copied wholesale.

Differences intentionally preserved:
- Existing Pi EMQX broker remains on TCP **1884**; do not launch a new EMQX instance on 1883.
- Keep the narrow subscriptions: `sys/product/+/status`, `thing/product/+/osd`, `thing/product/+/state`, `thing/product/+/events` and `thing/product/+/services_reply`. Do not subscribe to `sys/#` or `thing/#` with production credentials.
- Never print raw MQTT JSON, device serial numbers, licenses, authentication secrets or GPS coordinates into general application logs.
- Never expose MQTT credentials through a public `/api/config` endpoint.
- Pilot 2 is configured only through the existing authenticated HTTPS `POST /api/pilot/bootstrap`.
- DJI Cloud API message guards, topic allowlists, timestamp checks and GPS integrity tests continue to apply.

## Pilot 2 connection sequence

1. Authenticate the SkyHub Pilot page using the existing access token.
2. `platformVerifyLicense`, `platformSetWorkspaceId`, `platformSetInformation`.
3. `platformLoadComponent('thing', ...) ` asks DJI Pilot 2 to load/configure MQTT.
4. Evaluate the actual `thingGetConnectState()` result, including a JSON-string result of the form `{"code":0,"data":false}`.
5. When disconnected or indeterminate, the operator may select **MQTT erneut verbinden**, which explicitly invokes `thingConnect(username, password, callback)` once.
6. A successful Bridge return only means the request was accepted. **Only a positive subsequent state check** can confirm Pilot's self-reported connection; current broker observations and fresh OSD are separate evidence.

The retry button does not run an automatic reconnect loop. Pilot credentials are kept only in the active WebView memory for the explicit retry and discarded when a positive state is confirmed. Nothing is written to browser storage.

## OSD diagnostics

The read-only backend additionally counts allowlisted incoming MQTT **topic deliveries before parsing**, without storing raw messages:

| Health field | Meaning |
|---|---|
| `mqttObservedPackets` | Total deliveries for allowlisted DJI topic shapes, including subsequently rejected messages |
| `mqttObservedOsdPackets` | Raw deliveries on `thing/product/{sn}/osd`, before JSON, timestamp and registry checks |
| `mqttLastObservedOsdAt` | Last delivery time of an OSD topic; not proof of valid telemetry |
| `mqttObservedChannelCounts` | Per-channel observed deliveries without serial numbers |
| `mqttOsdMessages` | OSD messages accepted after validation and registry handling |
| `mqttValidTelemetryUpdates` | OSD updates with usable telemetry fields |
| `mqttLastTelemetryAt` | Last accepted usable OSD update (backend reception time) |

Counters are in-memory and reset on backend restart. A raw OSD delivery **does not** imply authenticated DJI origin, a fresh aircraft position, valid GPS, or a current device session.

Diagnostic interpretation:
- `mqttObservedOsdPackets=0` with `mqttObservedChannelCounts.status>0`: the subscriber receives some status topics, but no OSD topic matching the allowed pattern. Check Pilot-to-broker MQTT publishing, routing and broker ACL.
- Observed OSD above zero but accepted OSD zero: examine `mqttDroppedByReason`, timestamp validation and JSON shape.
- Accepted OSD above zero but telemetry updates zero: compare against the DJI Cloud API 1.18 OSD field layout; never infer missing values as zero.
- Positive telemetry updates: then check the time and age; old packets are not a live flight feed.

The separate, optional `update_topo` acknowledgment publisher remains **off by default** (`SKYHUB_TOPOLOGY_ACK_ENABLED=false`). Enable it only after verifying the dedicated EMQX write ACL on `sys/product/+/status_reply`; do not reuse Pilot credentials as a server publisher.

## Local validation on the Raspberry Pi

```bash
cd ~/Projekte/SkyHub-Next
git fetch origin
git status --short --branch

# Work on the isolated feature branch; existing untracked local Docker
# overrides and backups must not be overwritten.
git switch --track origin/feature/mqtt-osd-integration

node --check backend/server.js
node --check backend/mqtt-metrics.js
node --check frontend/public/pilot-login.js
node --test backend/test/*.test.js
docker compose -p skyhub-next config --quiet
```

None of these commands deploys, restarts or changes containers. Do **not** `git reset --hard`, `git clean -fd`, `docker compose down -v`, or blindly `git add .` on the Pi.

After those checks, a deployment of **only** the backend can be considered separately. Retain the current Compose override and Caddy routes. Do not switch broker ports, Docker project names, or start extra stacks.

## Validation boundary

The code change and deterministic unit tests cannot prove that a physical DJI RC Pro Enterprise publishes OSD. A real hardware acceptance test must establish: Pilot JSBridge reports connection, EMQX receives the device's OSD topic, SkyHub records a validated OSD packet, and telemetry freshness reflects actual DJI messages. Until then SkyHub Next stays at **0.1.0**, without an automatic release/version increment.
