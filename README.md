# SkyHub OnPrem

Selbst gehosteter Leitstand im Stil von FlightHub 2 auf Basis der **DJI Cloud API v1.16.1** (Pilot-2-Anbindung).
Läuft komplett im LAN (ODROID-HC4 oder Raspberry Pi 5, ARM64, Docker).

| Hardware | Anbindung | Status |
|---|---|---|
| DJI RC Pro Enterprise + Mavic 3E / 3T | Pilot 2 → Cloud API | offiziell unterstützt |
| DJI RC Pro Enterprise + Mavic 3M | Pilot 2 → Cloud API | reale FH-Clone MQTT-Topologie `0-77-2` + Payload `68-0-0` belegt; offizielle DJI-Support-Matrix separat bewerten |
| DJI RC Plus 2 + Matrice 4T | Pilot 2 → Cloud API | offiziell unterstützt (ab Cloud API 1.12) |

## Funktionen (Phase 1)

- Geräte-Topologie (RC ↔ Fluggerät), Online/Offline, Live-Telemetrie auf der Karte
- Flugspur-Aufzeichnung (PostgreSQL, 1 Hz) und Anzeige der letzten 60 min
- Livestream: Pilot 2 → RTMP → MediaMTX → WebRTC im Browser
- Medien-Upload aus Pilot 2 direkt in MinIO (STS), Liste mit Download-Links
- Routen (KMZ/WPML): Upload im Web, Download/Favoriten in Pilot 2
- Gemeinsame Kartenebene (Pins/Flächen aus Pilot 2) + TSA (andere Teilnehmer)

## Inbetriebnahme

1. **DJI-Entwicklerkonto**: developer.dji.com → Apps → neue App vom Typ *Cloud API* anlegen → App ID, App Key, App License notieren.
2. `cp .env.example .env` und alle Werte setzen (`PUBLIC_HOST` = LAN-IP des Servers).
3. `./scripts/init.sh` (erzeugt Mosquitto-Passwörter und Datenordner)
4. `docker compose up -d --build`
5. Web-Leitstand: `http://<PUBLIC_HOST>:8080`
6. Auf der Fernsteuerung: **Pilot 2 → Cloud-Service → Offene Plattform** (Third-Party Cloud) → URL `http://<PUBLIC_HOST>:8080/pilot` → anmelden. Alle Komponenten müssen „OK" zeigen.
7. Logs prüfen: `docker compose logs -f backend` – beim ersten Verbinden erscheint `Neues Geraet <SN> (<Modell>, <key>)`.

### Ports (Firewall im LAN freigeben)

| Port | Dienst |
|---|---|
| 8080/tcp | Backend (Web, Pilot-H5, REST, WebSocket) |
| 1883/tcp | MQTT (Pilot 2 ↔ Backend) |
| 9000/tcp | MinIO S3 (Uploads von Pilot 2, Downloads) |
| 9001/tcp | MinIO-Konsole (optional, nur Admin) |
| 1935/tcp | RTMP-Ingest Livestream |
| 8889/tcp, 8189/udp | WebRTC-Player |

## Wichtige Hinweise

- **SkyHub selbst ist noch nicht als kompletter Stack gegen echte Hardware validiert.** Fuer M3M werden jedoch reale, redigierte FH-Clone-MQTT-Evidenzen vom 01.10.2026 als Referenz verwendet. Runtime-Verhalten in SkyHub muss weiterhin separat belegt werden.
- DJI hat die Pflege der offiziellen Cloud-API-Demo am 10.04.2025 eingestellt. SkyHub uebernimmt daraus keinen Server-Stack; ausgewaehlte Protokollvertraege werden nach Security-Review als Kompatibilitaetsreferenz in eigener Python-Implementierung genutzt.
- Nur im LAN/VPN betreiben, solange TLS noch nicht aktiviert ist. Die oeffentliche Pilot-Bootstrap-Konfiguration enthaelt keine DJI-App-Lizenzdaten; diese werden erst nach erfolgreichem Login ausgegeben.
- Datenordner `./data` gehört auf die HDD/SSD, nicht auf die SD-Karte.

## Wiederverwendung aus FH-Clone

Die DJI-Topologie-, Telemetrie- und RTK-Semantik wird gezielt aus dem verifizierten FH-Clone-Stand portiert. Herkunft und Abweichungen sind in `docs/FH_CLONE_REUSE.md` festgehalten.

## DJI-Demo als Referenz

Aus dem eingestellten offiziellen DJI Cloud API Demo werden nur klar abgegrenzte
Wire-Protocol-Vertraege herangezogen, z.B. MQTT-Topic-Formen, Livestream-Enums
und `video_id`/`payload_index`-Formate. Authentifizierung, Sessions, Storage,
Controller und Flugsteuerungslogik der Demo werden nicht uebernommen.

Details: `docs/DJI_DEMO_REFERENCE.md` und `THIRD_PARTY_NOTICES.md`.

## DJI Cloud API Zielversion

Normative Protokollbasis ist **DJI Cloud API v1.16.1** (Release 2025-12-17).
FH-Clone dient als Real-Hardware-Evidence, die eingestellte DJI-Demo nur als
historische Referenzimplementierung. Bei Widerspruechen hat die aktuelle
offizielle DJI-Dokumentation Vorrang.

Details: `docs/DJI_CLOUD_API_VERSION.md`.
