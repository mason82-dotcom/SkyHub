# SkyHub Next – read-only DJI Operations v3.1

**Neue Entwicklungsbasis:** Node.js/Express, Socket.IO, MQTT 5, Redis, PostGIS, MinIO und eine kompakte, statische Live-Karten-WebUI ohne Frontend-Buildprozess. Vollständig getrennt vom alten Python-SkyHub.

## Sicherheitsmodell

- SKYHUB_VIEW_TOKEN ist für alle Telemetrie-API-Routen und für Socket.IO zwingend erforderlich.
- Web-Frontend standardmäßig nur auf 127.0.0.1:4000 des Hostsystems; für entfernten Zugriff SSH-Tunnel oder vertrauenswürdigen HTTPS-Reverse-Proxy einsetzen.
- Keine standardmäßig veröffentlichten Postgres-, Redis- oder MinIO-Ports.
- Kein DISABLE_AUTH; keine im Code hinterlegten Datenbank-, MQTT- oder MinIO-Kennwörter.
- MQTT ausschließlich als Subscriber. Brokerkonto sollte ACL-seitig auf SUBSCRIBE der dokumentierten DJI Topics beschränkt sein.
- Keine DJI-Flug- oder Missionssteuerung. POST /api/mission/create antwortet absichtlich mit HTTP 501.
- Kein Vortäuschen von Telemetrie: unbekannte Werte null, aktualisierte Werte nur aus echten osd-Meldungen, Frischegrenze 15 Sekunden.

## Entwicklung auf dem Pi (nicht die produktive Python-Installation überschreiben!)

    git clone --branch develop/skyhub-next-readonly-v1 https://github.com/mason82-dotcom/SkyHub.git ~/Projekte/SkyHub-Next
    cd ~/Projekte/SkyHub-Next
    cp .env.example .env

Die Datei .env bearbeiten. Alle REPLACE_* Platzhalter ersetzen. Zufallstokens/Passwörter mit openssl rand -hex 32 erzeugen. **Für den Raspberry Pi ist MQTT-Port 1884 verbindlich**: `MQTT_BROKER_URL=mqtt://host.docker.internal:1884`. Nutzername und Passwort des vorhandenen Pi-Brokers in MQTT_USER und MQTT_PASSWORD eintragen. SkyHub Next startet keinen eigenen MQTT-Broker und belegt weder Host-Port 1883 noch 1884. `SKYHUB_MQTT_REQUIRED_PORT=1884` im Pi-Compose verhindert den versehentlichen Betrieb mit einem anderen Port. MinIO wird erst mit docker compose --profile media up -d minio gestartet, da die Medien-API noch aussteht. Das separate System benötigt keinen eigenen EMQX-Broker und belegt keine bestehenden DJI-Dienstports.

Nach Behebung der bekannten NVMe-Störung und nach Prüfung der Compose-Konfiguration:

    docker compose config --quiet
    docker compose up -d --build
    curl -s http://127.0.0.1:4000/api/health
    docker compose logs --tail=60 backend

Der Gesundheitsendpunkt meldet unter anderem `mqttBrokerPort: 1884`, `mqtt`,
`subscribed`, `mqttLastMessageAt`, `mqttAcceptedMessages` und
`mqttRejectedMessages`. `mqtt: true` belegt nur die TCP/MQTT-Verbindung,
`subscribed: true` die bestätigten Abonnements – **nicht**, dass DJI-Geräte
Telemetrie gesendet haben. Erst ein gesetzter `mqttLastMessageAt` zeigt
tatsächlich empfangene DJI-Nachrichten.

### Diagnose bei MQTT-Verbindungsfehlern auf dem Raspberry Pi

    sudo ss -ltnp | grep ':1884'
    docker compose logs --tail=60 backend

Der MQTT-Broker muss TCP 1884 auf einer vom Container erreichbaren Host-Adresse
anbieten. Ein Dienst, der ausschließlich an `127.0.0.1:1884` lauscht, ist
über `host.docker.internal` aus einem Bridge-Container üblicherweise **nicht**
erreichbar. Prüfen Sie deshalb zuerst Bind-Adresse, Broker-ACL und Firewall.
Port 1883 muss weder umgebogen noch abgeschaltet werden. Bei einer anderen
Pi-Adresse darf der Hostname in `MQTT_BROKER_URL` angepasst werden, der Port
bleibt 1884. Die Portprüfung testet die **Konfiguration**, nicht die tatsächliche
Erreichbarkeit; die bestätigt erst der MQTT-Verbindungsstatus.


Remote-Tunnel vom PC:

    ssh -L 4000:127.0.0.1:4000 mason@rpi5.local

Dann http://127.0.0.1:4000 öffnen, SKYHUB_VIEW_TOKEN aus .env eingeben. Token verbleibt nur im Speicher des Browsers bis zum Neuladen.

## Tests

    node --check backend/server.js
    node --check backend/dji.js
    node --test backend/test/*.test.js

## Live-API

- GET /api/health – Brokerstatus ohne Token
- GET /api/devices – authentifiziert; aktuelle Geräte und Telemetrie
- GET /api/events – authentifiziert; letzte empfangene Status-/Event-Typen
- GET /api/drone/:sn/telemetry – authentifiziert; eine Gerätekennung
- Socket.IO: snapshot, device_update, device_event – authentifiziert mit auth.token

## Aktueller Funktionsumfang und Grenzen

OSD-Nachrichten lesen und geographische Punkte anzeigen; Status-/Event-Kanäle als beobachtete Quellen behandeln, ohne aktive Flüge zu steuern. Persistenz der GPS-Telemetrie in PostGIS sowie Redis-Cache. MQTT-Broker muss passend für DJI Pilot 2 konfiguriert sein. Produkt- und Gateway-Zuordnung ist noch nicht implementiert. Der Online-Status bezeichnet ausschließlich MQTT-Brokerkonnektivität, **nicht** den Gerätezustand.

Das Frontend benötigt Leaflet/OpenStreetMap über CDN und Internetzugang. MinIO ist eine isolierte Speichergrundlage für zukünftige Medien; eine Medien-API gibt es noch nicht. Die vorhandenen M3E-/M3T-/M3M-Python-Worker sind Demonstrationscode und dürfen nicht als reale Messergebnisse verwendet werden. WPML-Missionseditor, Radiometrie und Photogrammetrie stehen noch aus.

DJI Cloud API Dokumentation:
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-plus/properties.html
- https://github.com/dji-sdk/Cloud-API-Doc
