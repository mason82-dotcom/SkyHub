# Architektur & Roadmap

```
 RC Pro Enterprise / RC Plus 2  (DJI Pilot 2, Cloud-Service -> Offene Plattform)
   |  H5-Seite /pilot  -> JSBridge: license, api, thing, ws, map, tsa, media, mission, liveshare
   |  MQTT tcp:1883    -> sys/product/{gw}/status, thing/product/{sn}/osd|state|events|requests
   |  HTTP :8080       -> /media, /wayline, /map, /storage, /manage
   |  S3 :9000         -> Medien/KMZ direkt in MinIO (STS-Credentials)
   |  RTMP :1935       -> Livestream in MediaMTX
   v
 [Mosquitto] [FastAPI-Backend] [PostgreSQL] [MinIO] [MediaMTX]
                    |
               Web-Leitstand (Leaflet, WebSocket, WebRTC-Player)
```

## Rolle der drei DJI-SDKs

| SDK | Rolle in diesem Projekt |
|---|---|
| **Cloud API** | Kern. Pilot 2 spricht MQTT/HTTP mit unserem Server. Kein eigener App-Code nötig. |
| **MSDK v5** | Nur Fallback, falls Mavic 3M über Pilot 2 Cloud nicht oder nur eingeschränkt läuft, oder für Funktionen, die Pilot 2 nicht bietet. Eigene Android-App auf der RC, die dieselben MQTT-Topics bedient – Backend bleibt unverändert. Während die MSDK-App fliegt, läuft Pilot 2 nicht. |
| **FlightHub 2 OpenAPI** | Schnittstelle *zu DJIs eigenem* FlightHub 2 (Cloud oder offizielle On-Prem-Version). Nicht verwendbar, um einen eigenen Server zu bauen. Nur relevant, falls später Daten mit einer offiziellen FH2-Instanz synchronisiert werden sollen. |

## Geräte-Keys (Cloud API v1.14)

| Gerät | domain-type-sub_type | Haupt-Kamera payload_index |
|---|---|---|
| Mavic 3E | 0-77-0 | 66-0-0 |
| Mavic 3T | 0-77-1 | 67-0-0 |
| Mavic 3M | 0-77-2 (UNVERIFIZIERT) | 68-0-0 (UNVERIFIZIERT) |
| Matrice 4E | 0-99-0 | 88-0-0 |
| Matrice 4T | 0-99-1 | 89-0-0 |
| RC Pro Enterprise | 2-144-0 | – |
| RC Plus 2 | 2-174-0 | – |

Livestream video_id: `{aircraft_sn}/{payload_index}/normal-0`.
Bei der M4T ist neben 89-0-0 die Wärmebild-/Zoom-Auswahl über `live_lens_change` möglich (Phase 2).

## Roadmap

**Phase 1 (dieser Stand):** Topologie, Telemetrie, Flugspur, Livestream, Medien, Routen, Kartenebene.

**Phase 2:**
- Mosquitto-ACL (Pilot-User nur eigene Topics), TLS via Reverse Proxy (Caddy) + MQTT über TLS
- HMS-Fehlermeldungen im Web mit Klartext (hms.json von DJI)
- Linsenwechsel/Qualität im Livestream (`live_lens_change`, `live_set_quality`), Wärmebild der 3T/4T
- Mehrere Benutzer + Workspaces, Rollen
- Medien-Galerie mit Thumbnails und Georeferenz auf der Karte
- Flugprotokoll pro Flug (Start/Landung aus mode_code), Export als KML/GPX

**Phase 3:**
- MSDK-v5-App für Mavic 3M, falls nötig (Kotlin, MQTT-Client Paho, gleiche Thing-Topics)
- Multispektral-Pipeline (M3M): NDVI-Kacheln aus den Upload-Daten
- Optional Anbindung an offizielles FlightHub 2 per OpenAPI

## Debug-Hilfen

```sh
# Alle MQTT-Nachrichten mitschneiden
docker compose exec mosquitto mosquitto_sub -u "$MQTT_BACKEND_USER" -P "$MQTT_BACKEND_PASSWORD" -v -t '#'
# Swagger-UI des Backends
http://<PUBLIC_HOST>:8080/docs
```
