# Betrieb, Diagnose und Entwicklung – SkyHub Next

**Wichtig:** Die folgenden Pi-Zustände und Portbelegungen wurden am 20.10.2026 dokumentiert; sie ersetzen keine erneute Prüfung am Zielsystem. Dieser Text unterscheidet zwischen lesenden Diagnosebefehlen und Befehlen, die Container/Dateien verändern. Ein Git-Checkout oder ein Merge nimmt **keinen** automatischen Cutover vor.

**Betriebsgrenzen:** Das Root-Compose ist `skyhub-next` mit Backend-Hostport `127.0.0.1:4001`; der vorhandene Broker ist auf Hostport `1884`. Der bisherige produktive Backend-Hostport `4000` darf nicht ungeprüft übernommen werden. Das Compose im Legacy-Snapshot darf nicht gestartet werden.

**Querverweise:** [Sicherheit](security.md), [Architektur](architecture.md), [MQTT/OSD](mqtt-osd-integration.md), [kontrollierte Migration](legacy-migration.md).

## Entwicklung auf dem Pi (nicht die produktive Python-Installation überschreiben!)

    git clone --branch develop/skyhub-next-mqtt-integrity-v3 https://github.com/mason82-dotcom/SkyHub.git ~/Projekte/SkyHub-Next
    cd ~/Projekte/SkyHub-Next
    cp .env.example .env

Die Datei .env bearbeiten. Alle REPLACE_* Platzhalter ersetzen. Zufallstokens/Passwörter mit openssl rand -hex 32 erzeugen. **Für den Raspberry Pi ist MQTT-Port 1884 verbindlich**: `MQTT_BROKER_URL=mqtt://host.docker.internal:1884`. Nutzername und Passwort des vorhandenen Pi-Brokers in MQTT_USER und MQTT_PASSWORD eintragen. SkyHub Next startet keinen eigenen MQTT-Broker und belegt weder Host-Port 1883 noch 1884. `SKYHUB_MQTT_REQUIRED_PORT=1884` im Pi-Compose verhindert den versehentlichen Betrieb mit einem anderen Port. MinIO wird erst mit docker compose --profile media up -d minio gestartet, da die Medien-API noch aussteht. Das separate System benötigt keinen eigenen EMQX-Broker und belegt keine bestehenden DJI-Dienstports. Auf dem Pi läuft das bestehende `skyhub_backend` bereits auf **4000**. Deshalb verwendet SkyHub Next standardmäßig den Host-Port **4001** (intern weiterhin 4000) und lauscht nur auf `127.0.0.1`. Vor jedem Start mit dem beigefügten Preflight-Skript kontrollieren, dass auch 4001 frei ist. Eine bereits vorhandene lokale `.env` mit `SKYHUB_HTTP_PORT=4000` muss manuell angepasst werden; sie wird nicht automatisch überschrieben.

Nach Behebung der bekannten NVMe-Störung und nach Prüfung der Compose-Konfiguration:

    docker compose config --quiet
    docker compose up -d --build
    curl -s http://127.0.0.1:4001/api/health
    docker compose logs --tail=60 backend

Der Gesundheitsendpunkt meldet unter anderem `mqttBrokerPort: 1884`, `mqtt`,
`subscribed`, `mqttLastMessageAt`, `mqttAcceptedMessages` und
`mqttRejectedMessages`, `mqttChannelCounts`, `mqttLastOsdAt`,
`mqttLastTelemetryAt` und `mqttValidTelemetryUpdates`. `mqtt: true` belegt nur
die MQTT-Verbindung, `subscribed: true` bestätigte Abonnements. Erst
`mqttLastMessageAt` zeigt empfangene, erkannte DJI-Topic-Nachrichten;
`mqttLastOsdAt` zeigt OSD-Pakete; `mqttLastTelemetryAt` zeigt den letzten
verwertbaren, vom Registry übernommenen OSD-Messwert. Diese drei Zustände
sind ausdrücklich **nicht** gleichzusetzen. Die Zähler der Health-API
enthalten keine Seriennummern, Nutzdaten oder Anmeldedaten.

### Bestehende Raspberry-Pi-Broker- und Porttopologie (20.10.2026)

Die lesend ermittelte Host-Konfiguration:

- `skyhub_emqx`: Host-TCP **1884** → EMQX-Container-TCP **1883**.
- `mosquitto`: eigenständiger Host-Broker auf TCP **1883**. Nicht mit EMQX gleichsetzen; ohne Bridge werden keine Topics synchronisiert.
- `skyhub_backend`: bestehende produktive HTTP-Portfreigabe **4000**.
- `skyhub-next`: bewusst eigener Compose-Projektname; geplanter **4001** am Host (Loopback), **4000** nur innerhalb des neuen Backend-Containers.

Nur die EMQX-Verbindung auf Port 1884 konfigurieren; den alten Mosquitto weder stoppen noch umkonfigurieren. Dass der Port lauscht, beweist **nicht**, dass sich DJI Pilot 2 korrekt anmeldet oder dass OSD-Nachrichten ankommen.

Vor der Inbetriebnahme ohne Änderungen an laufenden Diensten:

    bash scripts/pi-preflight.sh

### EMQX-Istzustand aus der Pi-Diagnose

Am 20.10.2026 wurden 2 aktive Clients, 6 Subscriptions mit
`thing/product/`-Muster und 0 `sys/product/`-Subscriptions gemeldet.
Das beweist weder, dass die verbundenen Clients DJI-Fernsteuerungen
sind, noch den Eingang von Telemetrie. Da SkyHub Next noch nicht läuft,
ist sein zusätzliches `sys/product/+/status`-Abo noch nicht vorhanden.
Das bisherige Backend auf Host-Port 4000 liefert für
`GET /api/health` die HTML-Antwort `Cannot GET /api/health`,
weil die ältere Implementierung diesen Endpunkt nicht definiert;
das ist kein Nachweis eines Ausfalls.

Nächste **lesende** Überprüfung (vor Start der neuen Umgebung):

    docker exec skyhub_emqx emqx ctl broker metrics | grep -E 'messages\\.(received|delivered)|packets\\.publish\\.received'
    docker exec skyhub_emqx emqx ctl clients list

Die Client-Liste kann Gerätekennungen, Benutzernamen und Netzwerkadressen
enthalten; vor dem Teilen bereinigen. Diese Broker-Zähler sind
aggregiert und können auch Nicht-DJI-MQTT-Verkehr enthalten. Nur eine
separate Prüfung der Zeitdifferenz bzw. der SkyHub-Next-Live-Zähler kann
neue Nachrichten belegen.

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

    ssh -L 4001:127.0.0.1:4001 mason@rpi5.local

Dann http://127.0.0.1:4001 öffnen, SKYHUB_VIEW_TOKEN aus .env eingeben. Token verbleibt nur im Speicher des Browsers bis zum Neuladen.

## Tests

    node --check backend/server.js
    node --check backend/dji.js
    node --check backend/mqtt-metrics.js
    node --test backend/test/*.test.js

## MQTT/OSD-Adapter (Version 0.1.0)

Der vorhandene EMQX-Broker auf Host-Port **1884** bleibt bestehen. Der Open-Source-Referenzclient von Ömer Mersin wurde ausgewertet; übernommen wurden das Konzept des expliziten DJI-`thingConnect()`-Wiederholungsversuchs und die getrennte OSD-Eingangsdiagnose – **nicht** dessen separater EMQX-Container, breiten Topic-Subscriptions oder ungeschützte Konfigurations-API.

Bei getrennt gemeldetem MQTT-Status bietet DJI Pilot 2 den Button **„MQTT erneut verbinden“**. Kein automatisches Reconnect-Spamming und keine Geheimnisse in Statusmeldungen. Der Backend-Health-Endpunkt unterscheidet `mqttObservedOsdPackets` (roh empfangene Topics), `mqttOsdMessages` (übernommene OSD) und `mqttValidTelemetryUpdates` (verwertbare Daten). Die Diagnose liest keine Rohdaten aus.

Nach einem kontrollierten Deployment auf dem Pi: `node scripts/pi-mqtt-osd-check.js` (Standardport 4001). Für Konfiguration, Grenzen, Quellennachweis und Prüfablauf siehe [MQTT/OSD-Integration](mqtt-osd-integration.md).

## Hardware-Befund 20.10.2026: RC Pro verbunden, kein OSD

Die DJI RC Pro Enterprise ist als Gateway an EMQX angemeldet und sendet
`update_topo` sowie `state`, aber **kein OSD**. SkyHub hatte nie ein
`status_reply` gesendet (Topologie-Bestätigung war aus); Pilot 2 wiederholt
`update_topo` dann und sendet kein OSD. Das Diagnoseskript erkennt diesen Fall
jetzt ausdrücklich. Neu: `GET /api/diagnostics/mqtt-shapes` (Token nötig)
zeigt pro Kanal/Methode nur die empfangenen Feldnamen, keine Werte oder
Seriennummern. Zusätzliche OSD-Felder: GNSS-/RTK-Satelliten und Fix-Status,
Lage, Home-Distanz, Restflugzeit, RC-Funkqualität.

**Sicherheitsbefund:** Der bestehende EMQX auf 1884 erlaubt anonyme Anmeldung
und hat `{allow, all}` als ACL. Die vorgesehene Publish-only-Beschränkung des
Topologie-Publishers wird dadurch noch nicht durchgesetzt. Details und
Vorgehen: [MQTT/OSD-Integration](mqtt-osd-integration.md).

**Ergebnis nach Aktivierung der Topologie-Bestätigung (22:07):** Die RC Pro
sendet OSD (Akku, Position, Ellipsoidhöhe, Funkqualität), frisch und zeitlich
verifiziert.

## Pilot 2 ohne manuelles Token

Die Seite `/pilot-login` koppelt jede RC einmalig: Sie zeigt einen 6-stelligen
Code, der auf dem Pi mit `node scripts/pi-pilot-pair.js <code>` bestätigt
wird. Danach verbindet sich die RC bei jedem Öffnen automatisch, lädt das
Cloud-Modul nur bei Bedarf und baut eine unbestätigte Sitzung selbst neu auf.
Übersicht und Widerruf: `node scripts/pi-pilot-pair.js` bzw. `--revoke <id>`.
Details: [MQTT/OSD-Integration](mqtt-osd-integration.md#pilot-2-connection-sequence-handshake).

## Neustart-Test (20.10.2026)

Nach einem Neustart von Pilot 2 und RC hat sich die gekoppelte RC ohne neuen
Kopplungscode und ohne Öffnen der Cloud-Seite selbst wieder mit EMQX verbunden
(Anmeldung mit Passwort, alle Abos genehmigt). Ihre Topologie wurde sofort
bestätigt, OSD von RC und Mavic 3M lief nach rund 70 s wieder. Pilot 2 behält
die Cloud-Verbindung samt Zugangsdaten über Neustarts; die Pilot-Seite ist nur
für die Ersteinrichtung nötig. Details:
[MQTT/OSD-Integration](mqtt-osd-integration.md#restart-test-2026-10-20-pilot-2-and-rc-restarted-after-pairing).
