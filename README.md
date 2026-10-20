# SkyHub Next – 0.1.0 (Entwicklungsstand)

**Produktversion:** 0.1.0 (Prototyp). Die historischen Branch-Suffixe v1/v2/v3/v4 sind keine Produktversionen.

**Neue Entwicklungsbasis:** Node.js/Express, Socket.IO, MQTT 5, Redis, PostGIS, MinIO und eine kompakte, statische Live-Karten-WebUI ohne Frontend-Buildprozess. Vollständig getrennt vom alten Python-SkyHub.

**Pi-Iststand am 20.10.2026:** Das eigene Compose-Projekt `skyhub-next` läuft bereits auf `127.0.0.1:4001` mit separatem Postgres und Redis. Der lesend abgefragte Health-Endpunkt meldete MQTT auf Port 1884 verbunden und abonniert sowie verwertbare OSD-Nachrichten. `skyhub_backend` erschien nicht in der laufenden Containerliste. Das ist eine Momentaufnahme; vor Betriebsänderungen den Zustand erneut prüfen. [Bestandsaufnahme und Entwicklungsplan](docs/entwicklungsplan-2026-10-20.md).

## Sicherheitsmodell

- SKYHUB_VIEW_TOKEN ist für Telemetrie-API und Socket.IO erforderlich. Die optionale, eng begrenzte Heimnetz-Ausnahme erlaubt lesende GET-Abfragen und den Live-Socket ohne Token; Admin-Routen bleiben ausgeschlossen.
- Web-Frontend standardmäßig nur auf 127.0.0.1:4001 des Hostsystems; für entfernten Zugriff SSH-Tunnel oder vertrauenswürdigen HTTPS-Reverse-Proxy einsetzen.
- Keine standardmäßig veröffentlichten Postgres-, Redis- oder MinIO-Ports.
- Kein DISABLE_AUTH; keine im Code hinterlegten Datenbank-, MQTT- oder MinIO-Kennwörter.
- MQTT-Subscriber bleibt read-only. Eine optionale, standardmäßig deaktivierte Topologie-Bestätigung nutzt einen separaten ACL-eingeschränkten Publisher.
- Keine DJI-Flug- oder Missionssteuerung. POST /api/mission/create antwortet absichtlich mit HTTP 501.
- Kein Vortäuschen von Telemetrie: unbekannte Werte null, aktualisierte Werte nur aus echten osd-Meldungen, Frischegrenze 15 Sekunden.

## Entwicklung auf dem Pi (nicht die produktive Python-Installation überschreiben!)

    cd ~/Projekte/SkyHub-Next

Die bestehende lokale `.env` und `docker-compose.override.yml` sind Pi-Konfiguration und dürfen nicht durch Beispielwerte ersetzt werden. Für eine **neue, isolierte Installation** liefert `.env.example` die Vorlage; alle `REPLACE_*`-Platzhalter müssen vor einem Start ersetzt werden. **Für diesen Pi ist MQTT-Port 1884 verbindlich**: `MQTT_BROKER_URL=mqtt://host.docker.internal:1884`. SkyHub Next startet keinen MQTT-Broker. MinIO ist nur für eine künftige Medien-API vorgesehen und läuft nicht im Standardprofil. Der Root-Compose-Stack veröffentlicht das Backend standardmäßig auf `127.0.0.1:4001` (Container-Port 4000). Vor jeder Änderung die tatsächliche Portbelegung und den laufenden Compose-Zustand prüfen.

Lesende Prüfungen des bereits laufenden Stacks:

    docker compose config --quiet
    docker compose ps
    curl -fsS http://127.0.0.1:4001/api/health

Ein Build oder `docker compose up` verändert den laufenden Dienst und gehört zu einem separat freigegebenen Deployment.

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

### ARM64-PostGIS auf dem Raspberry Pi

Der Pi benötigt das lokale PostGIS-Image aus
[`docker/postgis/Dockerfile.arm64`](docker/postgis/Dockerfile.arm64). Die
versionierte Datei [`docker-compose.arm64.yml`](docker-compose.arm64.yml)
stellt dafür Build, PostGIS-Initialisierung und das bestehende Volume
`skyhub-next_pgdata_arm64` bereit. Die lokale, ignorierte
`docker-compose.override.yml` enthält derzeit dieselben Pi-Anpassungen und
bleibt unangetastet. Für eine explizite, reproduzierbare Prüfung ohne
automatisches lokales Override:

    docker compose -f docker-compose.yml -f docker-compose.arm64.yml --env-file .env.example config --quiet

Ein Wechsel der Compose-Dateien für den laufenden Stack ist ein Deployment und
erfordert eine separate Prüfung der effektiven Volumes und eine Freigabe.

### Raspberry-Pi-Broker- und Porttopologie (Momentaufnahme 20.10.2026)

Die lesend ermittelte Host-Konfiguration:

- `skyhub_emqx`: Host-TCP **1884** → EMQX-Container-TCP **1883**.
- `mosquitto`: eigenständiger Host-Broker auf TCP **1883**. Nicht mit EMQX gleichsetzen; ohne Bridge werden keine Topics synchronisiert.
- `skyhub_backend`: bei der letzten lesenden Containerliste **nicht laufend**; der frühere Betrieb auf Port 4000 ist historisch dokumentiert.
- `skyhub-next`: eigenes Compose-Projekt, **4001** am Host (Loopback), **4000** innerhalb des neuen Backend-Containers; bei der letzten Prüfung laufend.

Nur die EMQX-Verbindung auf Port 1884 konfigurieren; den alten Mosquitto weder stoppen noch umkonfigurieren. Dass der Port lauscht, beweist **nicht**, dass sich DJI Pilot 2 korrekt anmeldet oder dass OSD-Nachrichten ankommen.

Zur lesenden Port- und Uhrzeitprüfung:

    bash scripts/pi-preflight.sh

### Historischer EMQX-Befund vor dem SkyHub-Next-Start

Am 20.10.2026 wurden 2 aktive Clients, 6 Subscriptions mit
`thing/product/`-Muster und 0 `sys/product/`-Subscriptions gemeldet.
Das beweist weder, dass die verbundenen Clients DJI-Fernsteuerungen
sind, noch den Eingang von Telemetrie. Inzwischen läuft SkyHub Next; diese
damaligen Subscription-Zahlen sind kein aktueller Brokerstatus.
Das bisherige Backend auf Host-Port 4000 liefert für
`GET /api/health` die HTML-Antwort `Cannot GET /api/health`,
weil die ältere Implementierung diesen Endpunkt nicht definiert;
das ist kein Nachweis eines Ausfalls.

Bei Bedarf **lesend** erneut prüfen:

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

    npm ci --prefix backend --ignore-scripts --no-audit --no-fund
    node --check backend/server.js
    node --check backend/dji.js
    node --check backend/mqtt-metrics.js
    node --test backend/test/*.test.js

Der HTTP-/Socket.IO-Integrationstest in dieser Suite startet einen kurzlebigen
Testserver auf `127.0.0.1` mit zufälligem Port. MQTT und Redis zeigen dabei
nur auf den geschlossenen lokalen Port 1; produktive Dienste werden nicht
angesprochen.

## Live-API

- GET /api/health – Brokerstatus ohne Token
- GET /api/devices – authentifiziert; aktuelle Geräte und Telemetrie
- GET /api/events – authentifiziert; letzte empfangene Status-/Event-Typen
- GET /api/drone/:sn/telemetry – authentifiziert; eine Gerätekennung
- Socket.IO: snapshot, device_update, device_event – authentifiziert mit auth.token

## Positionsintegrität

Ein GPS-Punkt wird ausschließlich gebildet, wenn `latitude` und `longitude` im **selben** empfangenen DJI-OSD-Paket gültig vorliegen. Fehlende Koordinaten werden nicht aus späteren Paketen ergänzt; ein früheres gültiges Koordinatenpaar bleibt als zuletzt bekannte Position erhalten. `lastPositionAt` und `positionFresh` beziehen sich nur auf vollständige GPS-Paare und sind unabhängig von `lastTelemetryAt` und `fresh` für sonstige OSD-Telemetrie. Alte Positionsmarker werden in der Karte grau dargestellt, inklusive Altersanzeige; aus einem noch aktuellen Akkustand oder Flugmodus folgt keine aktuelle GPS-Position.

`positionFresh` besagt nur, dass beide numerisch plausiblen Koordinaten kürzlich zusammen empfangen wurden. Es ist **kein** Nachweis eines GNSS-/RTK-Fix, einer bestimmten Positionsgenauigkeit oder einer plausiblen Einsatzposition. Auch ein Paar `(0, 0)` bleibt daher als gemeldeter Gerätewert erhalten und wird nicht als bestätigter Standort interpretiert.

Die Änderung ist auf dem separaten Branch `develop/skyhub-next-position-integrity-v2` isoliert, ohne Port- oder Brokeränderung. Zusätzliche Tests: `node --test backend/test/position-integrity.test.js`.

## MQTT-Nachrichtenintegrität

Der rein lesende Empfangspfad prüft das DJI-Nachrichtenformat und den optionalen
Quellzeitstempel (Unix-Millisekunden). MQTT-Pakete mit `retain=true` werden
grundsätzlich verworfen. Bei **vorhandenem** Quellzeitstempel gelten folgende
Eingangsfenster: OSD höchstens 120 Sekunden alt, andere Kanäle höchstens
300 Sekunden alt; maximal 30 Sekunden Zukunftstoleranz. Ein verworfenes Paket
aktualisiert weder Telemetrie noch Geräte-Topologie.

Die bestehende Registry verwirft doppelte oder rückwärts laufende Quellzeitstempel
pro Gerät und Kanal. Nach einem zeitgestempelten Kanalpaket wird ein späteres
Paket desselben Kanals **ohne** Zeitstempel nicht mehr übernommen. Nachrichten,
die von Beginn an ohne Zeitstempel eintreffen, bleiben aus
Kompatibilitätsgründen zulässig, werden jedoch als zeitlich ungeprüft gekennzeichnet
(`telemetryTimeVerified=false`, `positionTimeVerified=false`).
Das ist **kein vollständiger Replay-Schutz** für zeitstempellose Pakete.

`lastTelemetryAt` und `lastPositionAt` beruhen bei verifizierbarem Quellzeitstempel
auf der DJI-Quellzeit (nicht auf der verspäteten Empfangszeit).
Die Kartenmarkierung wird nur bei frischer, zeitlich verifizierter GPS-Position
blau dargestellt; sonst grau. Die sichtbare Frische bedeutet weiterhin **nicht**
GNSS-/RTK-Genauigkeit oder eine bestätigte Flugposition.

Die Health-API enthält zusätzlich `mqttTimestampUnverifiedMessages` und
`mqttDroppedByReason` (z. B. `retained`, `stale`, `future`, `duplicate`).
Abweisungen werden ohne MQTT-Rohdaten und ohne Gerätekennungen protokolliert.
`mqttLastTelemetryAt` in den aggregierten MQTT-Metriken bezeichnet den
**Eingangszeitpunkt** eines verwertbaren OSD-Messwerts; die einzelne
`lastTelemetryAt`-Zeit der Registry den Quellzeitpunkt, sofern bekannt.

`lastTopologyAt` und `topologyTimeVerified` werden getrennt für
Fernsteuerung und Subgeräte geführt. `topologyOnline` bedeutet ausschließlich
**zuletzt in einer update_topo-Meldung als verbunden gemeldet**, nicht
"jetzt nachweislich online". Die Topologie wird durch die MQTT-Verbindung
oder fehlende Statusänderungen nicht automatisch aufgefrischt.

Voraussetzung für die Zeitfenster ist eine korrekt synchronisierte Pi-Systemuhr
(NTP). Replay-Schutz anhand von Zeitstempeln ersetzt weder authentifiziertes
MQTT, Broker-ACLs noch eine vollständige DJI-Protokollvalidierung. Keine
Produktivdienste werden durch Git-Branchwechsel oder Unit-Tests gestartet.

Neue Tests: `node --test backend/test/message-guard.test.js backend/test/topology-time.test.js`.
Für alle Regressionstests: `node --test backend/test/*.test.js`.

## Caddy HTTPS-Vertrauen auf dem Raspberry Pi (20.10.2026)

Der Pi betreibt Caddy 2.11.4 im `host`-Netzwerk. Für
`rpi5.fritz.box:443` ist ein Zertifikat mit dem Issuer
`Caddy Local Authority - ECC Intermediate` aktiv. Der erste
`curl`-Test auf dem Pi endete mit `curl: (60) unable to get local
issuer certificate`. Das bedeutet, dass `curl` die präsentierte
Zertifikatskette mit dem **Pi-System-Trust-Store** nicht prüfen konnte.
Ein separat geprüftes Caddy-CA-Root-Zertifikat ist noch kein Nachweis,
dass DJI Pilot 2 oder seine Android-WebView derselben CA vertraut.

Lesend und ohne `-k` prüfen:

    cd ~/Projekte/SkyHub-Next
    bash scripts/pi-tls-audit.sh rpi5.fritz.box 192.168.178.63 443

Der Test prüft zuerst den Pi-System-Trust-Store und versucht anschließend
den expliziten Nachweis mit `/data/caddy/pki/authorities/local/root.crt`
aus dem bestehenden Caddy-Container. Er installiert **keine** CA,
startet/stoppt keinen Dienst und liest keine privaten Schlüssel.

**Aktueller Prototypstand:** Pilot-2-H5-Anmeldung, MQTT-Integritätsprüfungen und Topologie-Antwortkanal sind vorhanden. Der dokumentierte RC-Neustarttest zeigte erneut OSD von RC und Mavic 3M; weitere Hardwarezustände und die Datenbank-Persistenz sind getrennt abzunehmen. Keine anderen Pi-Dienste oder Caddy-Routen durch Branchwechsel überschreiben.

## Übernahme des bisherigen SkyHub-Dienstes auf Port 4000

Der frühere Cutover-Plan wurde vor dem Start des separaten Next-Stacks erstellt.
Heute läuft Next auf Port 4001. Ob und in welchem Zustand das alte Backend
noch vorhanden ist, muss vor jedem Schritt neu geprüft werden; bei der letzten
Containerliste lief es nicht. Next nutzt eigene Datenvolumes und deaktiviert
Missionsveröffentlichungen. Eine Datenmigration ist nicht nachgewiesen.

**Vor jedem Cutover ausschließlich lesend prüfen:**

    bash scripts/pi-skyhub-takeover-audit.sh

Der historische Schrittplan mit Datensicherung und Rollback steht in
[SkyHub Legacy Takeover](docs/skyhub-legacy-takeover.md). Seine Betriebsbefehle
gelten erst nach neuer Bestandsaufnahme und ausdrücklicher Freigabe.

## Aktueller Funktionsumfang und Grenzen

OSD-Nachrichten lesen und geographische Punkte anzeigen; Status-/Event-Kanäle als beobachtete Quellen behandeln, ohne aktive Flüge zu steuern. Persistenz der GPS-Telemetrie in PostGIS sowie Redis-Cache. MQTT-Broker muss passend für DJI Pilot 2 konfiguriert sein. Grundlegende Gateway-/Subgerätezuordnung ist vorhanden; dauerhafter Geräte-Online-Status und zuverlässige Modellzuordnung aus allen Firmwarevarianten sind noch nicht abschließend validiert. Der Online-Status bezeichnet ausschließlich MQTT-Brokerkonnektivität, **nicht** den Gerätezustand.

Das Frontend benötigt Leaflet/OpenStreetMap über CDN und Internetzugang. MinIO ist eine isolierte Speichergrundlage für zukünftige Medien; eine Medien-API gibt es noch nicht. Die vorhandenen M3E-/M3T-/M3M-Python-Worker sind Demonstrationscode und dürfen nicht als reale Messergebnisse verwendet werden. WPML-Missionseditor, Radiometrie und Photogrammetrie stehen noch aus.

DJI Cloud API Dokumentation:
- https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/pilot-to-cloud/mqtt/rc-plus/properties.html
- https://github.com/dji-sdk/Cloud-API-Doc


## DJI Cloud API 1.18: optionale Topologie-Bestätigung

Dieser Branch ergänzt ausschließlich den DJI-Pilot-to-Cloud-Antwortkanal
`sys/product/{gateway_sn}/status_reply` für gültige `update_topo`-Nachrichten.
Er ist **standardmäßig deaktiviert** (`SKYHUB_TOPOLOGY_ACK_ENABLED=false`).
Der bisherige, schreibgeschützte DJI-MQTT-Subscriber und seine ACL bleiben unverändert.

Die Bestätigung wird ausschließlich nach erfolgreicher MQTT-Nachrichtenprüfung
und Übernahme in die Geräte-Registry erzeugt. `tid` und `bid` stammen aus
der geprüften Eingangsnachricht; `data.result` ist `0`.
Unbekannte Methoden, ungültige UUIDs, fehlende Zeitstempel, alte/retained
Pakete und verworfene Registry-Nachrichten lösen keine Bestätigung aus.
Die Antwort enthält keine Gerätegeheimnisse aus den Topologiedaten.

Für einen produktiven Hardwaretest separat in EMQX anlegen:
- einen **dedizierten MQTT-Publisher**, der ausschließlich auf
  `sys/product/+/status_reply` veröffentlichen darf,
- keine Subscriber-/Pilot-Benutzerdaten für dieses Konto wiederverwenden,
- keine Rechte für `services`, `drc/down` oder `property/set` vergeben.

Erst nach ACL-Prüfung `SKYHUB_TOPOLOGY_ACK_MQTT_USER`,
`SKYHUB_TOPOLOGY_ACK_MQTT_PASSWORD` und
`SKYHUB_TOPOLOGY_ACK_ENABLED=true` in der lokalen, nicht versionierten
`.env` setzen und ausschließlich den Backend-Container neu erstellen.
Die Health-API enthält `topologyReplyEnabled`, `topologyReplyConnected`,
`topologyReplySent` und `topologyReplyErrors`.

**Nicht behauptet:** Eine erfolgreiche Topologiebestätigung beweist keine
DJI-MQTT-Session und garantiert keinen OSD-Datenfluss. OSD-Veröffentlichung,
Pilot-2-JSBridge und die Broker-ACL sind getrennt zu validieren.

Tests: `node --test backend/test/*.test.js`.


## MQTT/OSD-Adapter (Version 0.1.0)

Der vorhandene EMQX-Broker auf Host-Port **1884** bleibt bestehen. Der Open-Source-Referenzclient von Ömer Mersin wurde ausgewertet; übernommen wurden das Konzept des expliziten DJI-`thingConnect()`-Wiederholungsversuchs und die getrennte OSD-Eingangsdiagnose – **nicht** dessen separater EMQX-Container, breiten Topic-Subscriptions oder ungeschützte Konfigurations-API.

Bei getrennt gemeldetem MQTT-Status bietet DJI Pilot 2 den Button **„MQTT erneut verbinden“**. Kein automatisches Reconnect-Spamming und keine Geheimnisse in Statusmeldungen. Der Backend-Health-Endpunkt unterscheidet `mqttObservedOsdPackets` (roh empfangene Topics), `mqttOsdMessages` (übernommene OSD) und `mqttValidTelemetryUpdates` (verwertbare Daten). Die Diagnose liest keine Rohdaten aus.

Nach einem kontrollierten Deployment auf dem Pi: `node scripts/pi-mqtt-osd-check.js` (Standardport 4001). Für Konfiguration, Grenzen, Quellennachweis und Prüfablauf siehe [MQTT/OSD-Integration](docs/mqtt-osd-integration.md).


## Historischer Hardware-Befund 20.10.2026: RC Pro zunächst ohne OSD

Die DJI RC Pro Enterprise ist als Gateway an EMQX angemeldet und sendet
`update_topo` sowie `state`, aber **kein OSD**. SkyHub hatte nie ein
`status_reply` gesendet (Topologie-Bestätigung war aus); Pilot 2 wiederholt
`update_topo` dann und sendet kein OSD. Das Diagnoseskript erkennt diesen Fall
jetzt ausdrücklich. Neu: `GET /api/diagnostics/mqtt-shapes` (Token nötig)
zeigt pro Kanal/Methode nur die empfangenen Feldnamen, keine Werte oder
Seriennummern. Zusätzliche OSD-Felder: GNSS-/RTK-Satelliten und Fix-Status,
Lage, Home-Distanz, Restflugzeit, RC-Funkqualität.

**Historischer Sicherheitsbefund:** EMQX auf 1884 erlaubte damals anonyme Anmeldung
und hatte `{allow, all}` als ACL. Später dokumentiert der Neustarttest eine
gehärtete Anmeldung und ACL; der aktuelle Brokerzustand muss vor einer Änderung
erneut lesend geprüft werden. Details: [MQTT/OSD-Integration](docs/mqtt-osd-integration.md).

**Ergebnis nach Aktivierung der Topologie-Bestätigung (22:07):** Die RC Pro
sendet OSD (Akku, Position, Ellipsoidhöhe, Funkqualität), frisch und zeitlich
verifiziert.

## Pilot 2 ohne manuelles Token

Die Seite `/pilot-login` koppelt jede RC einmalig: Sie zeigt einen 6-stelligen
Code, der auf dem Pi mit `node scripts/pi-pilot-pair.js <code>` bestätigt
wird. Danach verbindet sich die RC bei jedem Öffnen automatisch, lädt das
Cloud-Modul nur bei Bedarf und baut eine unbestätigte Sitzung selbst neu auf.
Übersicht und Widerruf: `node scripts/pi-pilot-pair.js` bzw. `--revoke <id>`.
Details: [MQTT/OSD-Integration](docs/mqtt-osd-integration.md#pilot-2-connection-sequence-handshake).

## Topologie über Neustarts

Rollen, Gateway-Zuordnung, Modelle und Kinder aus `update_topo` werden in Redis
(`skyhub:topology`, 7 Tage) vorgehalten und beim Start wiederhergestellt.
Telemetrie wird **nicht** gespeichert; nach einem Neustart ist nichts „frisch“,
bis echtes OSD eintrifft. Wiederhergestellte Einträge tragen
`topologyRestored: true` (Karte: „Topologie aus Speicher“) und werden von jedem
neueren `update_topo` ersetzt. Gespeicherte Daten werden vollständig validiert
und überschreiben nie eine neuere Live-Topologie. Der Replay-Schutz für
`update_topo` bleibt über Neustarts erhalten. Health: `topologyRestoredDevices`.

## HMS-Warnungen

SkyHub wertet DJI-HMS-Meldungen aus beiden Formaten aus: Pilot 2 sendet
`data:{event:"hms", method:"hms", output:{codes:[{id,level,component_index,sensor_index}]}}`
mit dezimaler ID (am 20.10.2026 an der Mavic 3M beobachtet), Docks
`method:"hms", data:{list:[{code:"0x…"}]}`. Jede Meldung ersetzt die Liste der
aktiven Warnungen des Geräts. Ohne neue Meldung gilt die Liste nach 30 s als
veraltet. Die Karte zeigt die Warnungen pro Gerät mit deutschem Text
(Fallback Englisch), die Kachel „Aktive HMS-Warnungen“ und einen roten bzw.
gelben Marker-Rand.

Texte: `backend/data/hms-texts.json`, erzeugt mit
`node scripts/build-hms-texts.js <hms.json>` aus der `hms.json` der DJI
Cloud-API-Demo (MIT, siehe `backend/data/HMS-LICENSE.txt`). Im Flug
(`mode_code` 3–12, 15–17) wird die `_in_the_sky`-Variante verwendet.

## Dashboard im Heimnetz (192.168.178.0/24)

    sudo bash scripts/pi-caddy-lan-dashboard.sh apply

Ergänzt im bestehenden Caddy eine Site auf **Port 4443**
(`https://rpi5.fritz.box:4443` bzw. `https://192.168.178.63:4443`, Caddy-interne CA).
Nur Absender aus `192.168.178.0/24` werden an `127.0.0.1:4001` weitergeleitet,
alle anderen (auch Tailscale) erhalten 403. `/api/pilot-admin/*` bleibt gesperrt:
Ein View-Token darf nicht reichen, um ein Gerät zu koppeln und so DJI-Lizenz und
Pilot-MQTT-Zugangsdaten zu erhalten. Das Backend bleibt auf Loopback gebunden.
Sicherung und Validierung vor dem Reload, automatischer Rückfall bei Fehlern;
`rollback` stellt den vorherigen Stand her, `check` testet ohne Änderungen.

### Ohne Token im Heimnetz

Mit `SKYHUB_LAN_VIEW_CIDR=192.168.178.0/24` in `.env` öffnet sich das Dashboard
über Caddy :4443 ohne Token. Erlaubt sind nur lesende GET-Abfragen und der
Live-Socket; schreibende Aufrufe brauchen weiter das Token, `/api/pilot-admin/*`
bleibt gesperrt. Ermittelt wird der Client aus Caddys letztem
`X-Forwarded-For`-Eintrag; SSH-Tunnel und lokale Aufrufe ohne diesen Header
brauchen das Token. Akzeptiert werden nur private Netze von /16 bis /32
außerhalb der Docker-Bereiche (172.16.0.0/12). Leer lassen, um das Token immer
zu verlangen. Die Kartenkacheln senden einen Referer
(`strict-origin-when-cross-origin`), wie es die OSM-Nutzungsregeln verlangen.

## Neustart-Test (20.10.2026)

Nach einem Neustart von Pilot 2 und RC hat sich die gekoppelte RC ohne neuen
Kopplungscode und ohne Öffnen der Cloud-Seite selbst wieder mit EMQX verbunden
(Anmeldung mit Passwort, alle Abos genehmigt). Ihre Topologie wurde sofort
bestätigt, OSD von RC und Mavic 3M lief nach rund 70 s wieder. Pilot 2 behält
die Cloud-Verbindung samt Zugangsdaten über Neustarts; die Pilot-Seite ist nur
für die Ersteinrichtung nötig. Details:
[MQTT/OSD-Integration](docs/mqtt-osd-integration.md#restart-test-2026-10-20-pilot-2-and-rc-restarted-after-pairing).

## Flugspur und Speicherung (PostGIS)

Validierte GPS-Punkte werden nur gespeichert, wenn sich das Gerät um ≥ 2 m
horizontal oder vertikal bewegt hat, sonst höchstens einmal pro Minute.
Punkte bei 0/0 (DJI ohne Positions-Fix) werden nie gespeichert; die
Live-Anzeige zeigt sie weiter wie gemeldet. Vorher wurde jedes OSD-Paket
geschrieben (am 20.10.2026 rund 170.000 Zeilen/Tag, die Hälfte bei 0/0).
Neue Spalten (`source_ts`, `time_verified`, Satelliten, RTK-Status) werden beim
Start ergänzt, ohne Daten zu löschen. Aufbewahrung: `SKYHUB_TRACK_RETENTION_DAYS`
(Standard 30), stündlich bereinigt. `GET /api/drone/:sn/track?minutes=60`
(1–1440, max. 5000 Punkte) liefert die Spur; die Karte zeigt sie (abschaltbar)
und zoomt ohne gültige Live-Position einmal darauf. Health:
`trackPointsStored` zählt erst **bestätigte** Datenbank-Schreibvorgänge.
`trackPointsSkipped` zählt Punkte, die der Bewegungsfilter zurückhält;
`trackPointsUnavailable` zählt Punkte vor erfolgreicher Migration.
`trackWritesPending`, `trackWriteErrors`, `trackLastWriteAt` und
`trackLastWriteErrorAt` trennen laufende, erfolgreiche und fehlgeschlagene
Writes. `postgresConfigured` und `postgresMigrationReady` zeigen Konfiguration
und erfolgreiche Schema-Migration, aber keine dauerhafte Verbindungszusage.
Eine fehlgeschlagene Migration wird im Hintergrund erneut versucht; ein
fehlgeschlagener Punkt blockiert den nächsten geeigneten Punkt nicht.
`trackRetentionDays` zeigt die Aufbewahrungsfrist.

## Ausgeschaltetes Fluggerät (mode_code 14)

Nach dem Ausschalten der Mavic 3M sendete Pilot 2 weiter sekündlich OSD für das
Fluggerät mit den zuletzt bekannten Werten und `mode_code = 14`
(„Not connected“). Solche Pakete aktualisieren weder Messwerte, Frische,
Position noch Flugspur; das Gerät erhält `aircraftConnected: false` und die
Karte zeigt „Fluggerät nicht verbunden“. Das nächste OSD mit anderem
`mode_code` hebt den Zustand auf.
