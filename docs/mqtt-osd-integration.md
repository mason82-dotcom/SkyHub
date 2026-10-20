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

## Device-side JSBridge diagnostics

The DJI Pilot 2 login page now includes **DJI-Status prüfen**.
It queries three read-only JSBridge APIs independently:

- `platformIsVerified()`: did DJI itself confirm Cloud API license verification?
- `platformIsComponentLoaded('thing')`: did Pilot 2 load the MQTT/thing module?
- `thingGetConnectState()`: does Pilot 2 currently report an MQTT session?

A return with a nonzero `code` is shown only as a bounded numeric DJI error code; the vendor `message` and all raw return objects are never displayed. The page does not call `thingGetConfigs()`, because that can contain MQTT credentials. A clean HTTPS page hides the generic yellow HTTPS requirement advisory.

The presence of an active EMQX client with a matching username does not by itself identify the remote controller; it could be a separate test client. Correlate Pilot 2's reported status with broker client evidence before enabling topic publishing. The three diagnostic statuses are intentionally distinct and do not imply verified OSD delivery.

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
| `topologyReplySent` / `topologyReplySkipped` / `topologyReplyLastAt` | `status_reply` publications, skipped replies (validation failed or publisher offline), last successful reply |

Counters are in-memory and reset on backend restart. A raw OSD delivery **does not** imply authenticated DJI origin, a fresh aircraft position, valid GPS, or a current device session.

Diagnostic interpretation:
- `mqttObservedOsdPackets=0` with `mqttObservedChannelCounts.status>0`: the subscriber receives some status topics, but no OSD topic matching the allowed pattern. Check Pilot-to-broker MQTT publishing, routing and broker ACL.
- Observed OSD above zero but accepted OSD zero: examine `mqttDroppedByReason`, timestamp validation and JSON shape.
- Accepted OSD above zero but telemetry updates zero: compare against the DJI Cloud API 1.18 OSD field layout; never infer missing values as zero.
- Positive telemetry updates: then check the time and age; old packets are not a live flight feed.

The separate, optional `update_topo` acknowledgment publisher remains **off by default** (`SKYHUB_TOPOLOGY_ACK_ENABLED=false`). Enable it only after verifying the dedicated EMQX write ACL on `sys/product/+/status_reply`; do not reuse Pilot credentials as a server publisher.

## Hardware finding 2026-10-20: RC Pro Enterprise online, no OSD

Observed live on the Pi with a DJI RC Pro Enterprise (topology `domain 2 / type 144 / sub_type 0`, thing version 1.2.0) logged in through `/pilot-login`:

- EMQX lists a client whose client ID is the RC serial number; it subscribes to `sys/product/{sn}/status_reply`, `thing/product/{sn}/services`, `property/set`, `events_reply`, `requests_reply`, `state_reply` and `sys/product/{sn}/network/probe`. This is the RC itself, not a test client.
- SkyHub received `update_topo` six times within ~100 s and 25 `state` messages, but **zero OSD topic deliveries**. `sub_devices` was empty (no aircraft in the topology).
- EMQX had delivered **0 messages** to the RC: no `status_reply` was ever sent, because `SKYHUB_TOPOLOGY_ACK_ENABLED` was off.

Per DJI Cloud API, the cloud acknowledges `update_topo` on `sys/product/{gateway_sn}/status_reply` with `data.result=0`; until then Pilot 2 repeats `update_topo` and does not treat the device as online. The missing reply is therefore the leading explanation for absent OSD. It is a hypothesis until a reply is sent and OSD is observed.

Consequences in code:
- `pi-mqtt-osd-check.js` now reports this case explicitly (status present, OSD absent, reply disabled).
- Health adds `topologyReplySkipped` and `topologyReplyLastAt`; a reply that fails validation or has no connected publisher is logged (without payload) instead of being silent.
- `GET /api/diagnostics/mqtt-shapes` (view token required) lists channel, method, `need_reply` count and top-level **field names** of received messages. No values, coordinates or serial numbers. Use it to align the parser with the real firmware instead of ad-hoc sniffing.

### EMQX access control (not changed by SkyHub)

The existing `skyhub_emqx` (5.3.0) has no authenticator configured and `acl.conf` ends with `{allow, all}`, while TCP 1884 is published on all interfaces. Consequently any LAN client can connect anonymously and publish to any topic, including `thing/product/+/services` and `property/set`. The "publish-only on `status_reply`" restriction for the topology publisher is **not enforced** by the broker today; the separate account only keeps the roles distinguishable for when ACLs are introduced.

Recommended, separate change (affects the RC login and the legacy stack, so plan and test it on its own):
1. Enable the built-in database authenticator; create distinct users for Pilot 2, the SkyHub read-only subscriber and the topology publisher.
2. ACL: Pilot user may publish its own `thing/product/{sn}/#` / `sys/product/{sn}/status` and subscribe to the reply/service topics; SkyHub subscriber subscribe-only on the five allowlisted patterns; topology publisher publish-only on `sys/product/+/status_reply`; final rule `{deny, all}`.
3. Then re-verify with `emqx ctl clients list` and the health counters.

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
